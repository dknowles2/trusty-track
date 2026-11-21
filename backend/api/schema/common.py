import asyncio
import json
import logging
import typing
from typing import Any

import pillow_heif
import strawberry
from pydantic import ValidationError
from sqlalchemy.orm import Session
from strawberry.types import Info

from backend.api import auth
from backend.api.loaders import RequestLoaders
from backend.db import crud, models
from backend.domain import audit
from backend.domain import name_display as domain_name_display
from backend.domain import terminology as domain_terminology
from backend.services.timer.devices.base import TimerProfile
from backend.services.timer.manager import TimerManager, device_for

if typing.TYPE_CHECKING:
    from .types_config import InitialConfigInput


logger = logging.getLogger(__name__)


pillow_heif.register_heif_opener()


def _session_factory(info: Info):
    """Session factory for TimerManagers created during a request.

    They persist results from a background task, so they cannot reuse the
    request's session. Falls back to the process-wide factory for contexts
    built outside the HTTP path.
    """
    from backend.db.database import SessionLocal

    return info.context.get("session_factory") or SessionLocal


def _loaders(info: Info) -> RequestLoaders:
    """Per-operation loader cache.

    Contexts built outside the HTTP path (tests, some tooling) may not carry
    one, so fall back to a fresh instance bound to this operation's session.
    """
    loaders = info.context.get("loaders")
    if loaders is None:
        loaders = RequestLoaders(info.context["db"])
        info.context["loaders"] = loaders
    return loaders


#: What a CSV column may say to mean "yes" for `car_passed_inspection`.
#: The import UI normalizes to `yes` before sending; this covers a file posted
#: to the mutation directly, and mirrors the same set in `csvMapping.ts`.
_TRUTHY_CSV_VALUES = frozenset({"y", "yes", "true", "1", "x", "passed", "pass"})


#: How many heats past the one on the track the audience display shows (#209).
#:
#: Two, because staging takes a heat's notice: the child in the bleachers is
#: not watching the screen, so a display that names only the next heat names
#: them at the moment the announcer is already calling for them. Three would be
#: a wall of names nobody reads.
ON_DECK_DEPTH = 2


#: `RacerInput`'s clear flags, by name — `createRacer`'s resolver pops every
#: one of them off unread (#747, see the field docstrings above).
_RACER_CLEAR_FLAGS = (
    "clear_racing_group",
    "clear_car_number",
    "clear_car_name",
    "clear_car_weight",
    "clear_racer_image",
    "clear_car_image",
    "clear_home_unit",
)


#: The demo allows `populateRace` (#1092), but at a stricter cap than the
#: global one `db.populate.MAX_POPULATE_COUNT` enforces for every caller —
#: enough for a real-looking roster without one visitor spending the whole
#: instance's row budget in a single call.
DEMO_POPULATE_MAX_COUNT = 40


RACES_LIST_CHANNEL = "races_list"


_TERMINOLOGY_FIELDS = (
    "racing_group_singular",
    "racing_group_plural",
    "organization_singular",
    "organization_plural",
    "vehicle_singular",
    "vehicle_plural",
    "vehicle_artwork_key",
)


#: A GPRM database is a roster, not a photo library — GPRM keeps pictures as
#: separate files it never puts in the database (see `domain.gprm`'s own
#: docstring) — so even years of history stays a few megabytes. This is
#: headroom for an operator who hands over the wrong file, not a real budget;
#: `MAX_UPLOAD_BYTES` in `api/main.py` is the same idea for `POST /upload/`.
MAX_GPRM_IMPORT_BYTES = 64 * 1024 * 1024


#: The largest image or CSV upload this app accepts (16 MB), matching
#: `POST /upload/`'s cap in `api/main.py` (#744).
MAX_UPLOAD_BYTES: int = 16 * 1024 * 1024


#: DerbyNet's own database is the same table family GPRM's is (see
#: `domain.derbynet`'s docstring), and keeps photographs as separate files
#: the same way GPRM does — so the same headroom applies for the same
#: reason `MAX_GPRM_IMPORT_BYTES` gives above.
MAX_DERBYNET_IMPORT_BYTES = MAX_GPRM_IMPORT_BYTES


def _require_operator_role(info: Info) -> None:
    """Refuse anything but an operator.

    `RolePolicyExtension` guards *mutations*, and this is a query — the same
    gap `/api/backup` and `/ws/timer/{track_id}` each close for themselves.
    Shared by every operator-only query: the activity log, its `sourceIp`
    field, and the display-name reroll each matter for their own reason, but
    the check and its refusal are the same one.
    """
    if auth.resolve_role(info.context) is not auth.Role.OPERATOR:
        raise auth.PermissionDeniedError("This is operator-only")


def _audit_entry(row: models.AuditEntry) -> audit.Entry:
    """The domain `Entry` a stored audit row describes.

    `summary` and `noteworthy` each need one built from the row; sharing the
    construction is what keeps them in step if `Entry` grows a field — two
    independent copies is how one of them would quietly stop getting it.
    `noteworthy` reads neither `race_id` nor `details`, but there is no
    cheaper `Entry` to hand it than the real one.

    A free function rather than a method on `AuditLogEntry`: `self` inside a
    field resolver is the duck-typed ORM row, not this Strawberry type, so a
    method reached through `self.` is looked up on `models.AuditEntry` and
    fails there.
    """
    return audit.Entry(
        action=row.action,
        role=audit.ActorRole(row.role),
        at=row.at,
        outcome=audit.Outcome(row.outcome),
        race_id=row.race_id,
        details=json.loads(row.details) if row.details else {},
    )


def _validation_sentence(exc: ValidationError) -> str:
    """Turn Pydantic's own wall of text into the sentence a validator wrote.

    Every ``field_validator`` in ``schemas.py`` raises a plain ``ValueError``
    with a sentence a volunteer can read (see, e.g., ``TrackBase``'s
    ``lane_count`` and ``scale_ratio`` checks); Pydantic wraps that in
    ``"1 validation error for <Model>\\n<field>\\n  Value error, <msg>
    [type=value_error, input_value=..., ...]"``, which is what the operator
    saw before ([#1023](https://github.com/dknowles2/trusty-track/issues/1023)).
    This is the one place that unwrapping happens — every resolver that
    builds a schema from operator-typed input and can raise
    ``ValidationError`` routes through it, rather than repeating the
    strip-and-capitalise dance `_historical_record_input` (below) originally
    grew it for.

    Only the first error is used, deliberately — not because Pydantic ever
    stops at one: two independently bad fields on the same model (say,
    ``TrackBase(lane_count=0, scale_ratio=-1.0)``) produce two entries in
    ``exc.errors()``, and this reports only the first. A single sentence is
    enough for the operator to fix and resubmit, and the field the schema
    happens to declare first is as good a pick as any other — the point is
    never to print more than one problem at a time, not that there could
    only ever be one.

    Capitalises only the first character (``msg[0].upper() + msg[1:]``)
    rather than calling ``str.capitalize()``, which lower-cases every other
    character too — wrong the moment a message carries something that is
    not plain lowercase prose. `RacerBase`'s photo-URL validator and
    `TrackBase`'s lane-colour one both learned this the hard way
    ([#1023](https://github.com/dknowles2/trusty-track/issues/1023)):
    `str.capitalize()` turned "uploadImage"/"URL" into "uploadimage"/"url"
    in the first, and a hex example like ``#E53935`` into ``#e53935`` in
    the second — both shipped, and the first was even pinned as correct by
    this issue's own first-draft test. Every *other* message here is plain
    lowercase prose with no embedded proper nouns, so only-first-character
    capitalisation changes nothing for those and fixes the two that were
    already wrong.
    """
    first = exc.errors()[0]["msg"].removeprefix("Value error, ")
    if not first:
        return "Invalid value."
    return first[0].upper() + first[1:].rstrip(".") + "."


@strawberry.type
class Terminology:
    """The words a screen should use, fully resolved (#496 stage 3).

    Never null — `domain.terminology.resolve_terminology` always falls back
    to the built-in Scouting words. Served on `Race` (organization default
    layered under a race override) and on `InitialConfigStatus` (organization
    default alone, for the screens with no race — Home, System Settings). The
    frontend reads it through `TerminologyContext`/`useTerminology`: race
    pages get the race's own resolved terms, and screens with no race in view
    get the organization default off `initialConfig`.
    """

    racing_group_singular: str
    racing_group_plural: str
    organization_singular: str
    organization_plural: str
    vehicle_singular: str
    vehicle_plural: str
    #: Which line-art glyph the vehicle word draws with (#551, stage 4) —
    #: one of `domain_terminology.VEHICLE_ARTWORK_KEYS`. Never null, like
    #: every field above: `resolve_terminology` always falls back to `"car"`.
    vehicle_artwork_key: str


def _terminology_overrides(row: Any) -> domain_terminology.TerminologyOverrides:
    """Read one layer's seven override columns off an ORM row.

    Works for both `models.Organization` and `models.Race` — they carry the
    same seven column names for exactly this reason. `crud.default_general_round_name`
    reads the same way, through `domain_terminology.overrides_from_row`
    directly, since `db.crud` has no business importing from `api.schema`.
    """
    return domain_terminology.overrides_from_row(row)


def _terminology_type(t: domain_terminology.Terminology) -> Terminology:
    return Terminology(
        racing_group_singular=t.racing_group_singular,
        racing_group_plural=t.racing_group_plural,
        organization_singular=t.organization_singular,
        organization_plural=t.organization_plural,
        vehicle_singular=t.vehicle_singular,
        vehicle_plural=t.vehicle_plural,
        vehicle_artwork_key=t.vehicle_artwork_key,
    )


def _terminology_status_kwargs(organization: Any) -> dict[str, Any]:
    """The raw override fields plus the resolved `terminology`, for building
    an `InitialConfigStatus`.

    Four call sites build one of these (create, update, the query, and the
    unconfigured branch), and #48 is the standing reminder of what happens
    when a rule like this lands on only some of them.
    """
    overrides = _terminology_overrides(organization) if organization else None
    return {
        "racing_group_singular": organization.racing_group_singular
        if organization
        else None,
        "racing_group_plural": organization.racing_group_plural
        if organization
        else None,
        "organization_singular": organization.organization_singular
        if organization
        else None,
        "organization_plural": organization.organization_plural
        if organization
        else None,
        "vehicle_singular": organization.vehicle_singular if organization else None,
        "vehicle_plural": organization.vehicle_plural if organization else None,
        "vehicle_artwork_key": organization.vehicle_artwork_key
        if organization
        else None,
        "terminology": _terminology_type(
            domain_terminology.resolve_terminology(organization=overrides)
        ),
    }


def _name_display_status_kwargs(organization: Any) -> dict[str, Any]:
    """The raw override plus the resolved name-display setting, for building
    an `InitialConfigStatus` (#552).

    Three call sites build one of these (create, update, the query), the
    same #48 shape `_terminology_status_kwargs` follows.
    """
    raw = organization.name_display if organization else None
    return {
        "name_display": raw,
        "resolved_name_display": domain_name_display.resolve_name_display(
            organization=raw
        ),
    }


def _replay_status_kwargs(organization: Any) -> dict[str, Any]:
    """The stored-replay setting and its two bounds, for building an
    `InitialConfigStatus` (#177 stage 2).

    No layering to resolve — unlike terminology or name-display, this is an
    install-wide setting with no per-race override — so unlike those two
    helpers this is just three raw columns, defaulted for the unconfigured
    branch the same way every other field here is.
    """
    return {
        "keep_replays": bool(organization and organization.keep_replays),
        "replay_retention_heats": organization.replay_retention_heats
        if organization
        else None,
        "replay_retention_mb": organization.replay_retention_mb
        if organization
        else None,
    }


def _photo_field_updates(
    prefix: str, url: str | None, original: str | None, edit: str | None
) -> dict[str, str | None]:
    """Which of `<prefix>_image_url`/`_original_url`/`_edit` an
    `updateRacer` payload actually means to change (#1241).

    A first version of this feature popped the original/edit pair out and
    reapplied them unconditionally, bypassing `RacerInput`'s ordinary
    "absent means leave alone" convention (#747) for every field but the
    six explicit `clear_*` flags. A reviewer proved that was a real hole:
    `updateRacer` is a public mutation, not a function this PR's one
    well-behaved caller (`RaceDetails.tsx`, which always resends the whole
    form) can be trusted to always call correctly — a payload naming only
    `carWeight`, say, silently nulled a racer's entire crop history, with
    no test protecting the invariant `test_an_absent_field_still_leaves_
    the_stored_value_alone` exists to guard everywhere else on this input.

    This restores that convention rather than departing from it, and
    folds in the one real behaviour a fresh, uncropped photo still needs
    — invalidating a *stale* original/edit without a `clear*` flag, since
    an ordinary file-upload payload sets the url alone:

    - `url` absent: the operator is not touching this photo at all.
      Nothing is returned — `original`/`edit` are left exactly as they
      are, whatever else the payload carries for them (meaningless
      without a `url` alongside, so not worth a special case of their
      own).
    - `url` given, `original` and `edit` both absent: a fresh, uncropped
      file is replacing whatever was there — the old original and edit
      belong to a photo that no longer exists, so both are nulled. The
      same rule `bulk_assign_racer_photos` already applies to an assigned
      photo, for the identical reason.
    - `url` given, and `original` or `edit` given: a recrop or a camera
      capture, which always send both together — store all three exactly
      as sent.

    `clear_racer_image`/`clear_car_image` are unaffected by any of this;
    the resolver applies them afterward, and they null all three
    unconditionally regardless of what this returns.
    """
    if url is None:
        return {}
    updates: dict[str, str | None] = {f"{prefix}_image_url": url}
    if original is None and edit is None:
        updates[f"{prefix}_image_original_url"] = None
        updates[f"{prefix}_image_edit"] = None
    else:
        updates[f"{prefix}_image_original_url"] = original
        updates[f"{prefix}_image_edit"] = edit
    return updates


async def _revalidate_timers(info: Info) -> None:
    """Disarm any timer whose heat has just been rewritten underneath it (#50).

    Call after anything that regenerates, deletes or re-fields heats. Recording
    already refuses a stale heat, but only after the cars have run — this moves
    the discovery to the moment it happens, while the track is still empty and
    the operator can simply re-arm.

    Every track is checked rather than the one that owns the changed race: a
    manager knows which heat it armed, and asking it is cheaper than working
    out which races each track could be running.
    """
    db = info.context["db"]
    for mgr in info.context.get("timer_managers", {}).values():
        reason = await mgr.revalidate_armed_heat(db)
        if reason is not None:
            logger.warning("Track %d disarmed: %s", mgr.track_id, reason)


async def _admit_late_racers(info: Info, race_id: int) -> None:
    """Bring the schedule into line with who is checked in (#172, #228).

    Call after anything that changes a round's field — check-in is the gate,
    since ``car_passed_inspection`` is what the generator draws from, so
    creating a racer is not enough on its own. Both directions run from the
    one hook: withdrawal first, so a regeneration fields from the roster as
    it now stands, then admission. Each is idempotent, which is what lets an
    un-check-and-recheck heal itself.

    Timers are revalidated afterwards for the same reason ``regenerateRound``
    does it: either direction can rebuild an unraced round's heats, and an
    armed heat must not be swapped underneath the operator (#50).
    """
    db = info.context["db"]
    crud.withdraw_absent_racers(db, race_id)
    crud.admit_late_racers(db, race_id)
    await _revalidate_timers(info)


def _race_id_for_racers(db: Session, racer_ids: list[int]) -> int | None:
    """The one race every id in a bulk mutation's `racer_ids` belongs to, or
    ``None`` if none of them exist.

    Five bulk resolvers each used to re-derive this from ``racer_ids[0]`` —
    to know which race's state to publish — with three different null-guard
    styles for the same lookup, and none of them checked that the *rest* of
    the list agreed (#743). `RaceLockExtension` resolves a bulk mutation's
    lock from that same first-id shortcut, so a mixed list dodged it, and
    each of these five then wrote to (or deleted) whichever racers it was
    actually given with no per-racer race check of its own — a locked
    race's racer was editable by anyone who put one of their own unlocked
    racers first.

    Raises ``ValueError`` when the ids that do exist span more than one
    race — nothing legitimate ever sends a mixed list; the roster screen
    that builds one is itself scoped to a single race. Raising here, before
    any of the five callers below does anything else, is what makes this
    the one place the check has to live rather than a copy in each.
    """
    if not racer_ids:
        return None
    race_ids = {
        row[0]
        for row in db.query(models.Racer.race_id)
        .filter(models.Racer.id.in_(racer_ids))
        .distinct()
    }
    if len(race_ids) > 1:
        raise ValueError("racerIds must all belong to the same race")
    return race_ids.pop() if race_ids else None


def _device_for(track: Any) -> TimerProfile:
    """The profile a track should run on."""
    return device_for(track.timer_type, track.timer_profile)


def _manager_for(track: Any, info: Info) -> TimerManager:
    """A ``TimerManager`` configured from a track row.

    Three mutations create one, and every setting a manager reads off a track
    has to reach all three. Same reason as ``_start_backend_direct`` below,
    same standing reminder: #48.
    """
    device = _device_for(track)
    return TimerManager(
        track.id,
        device,
        session_factory=_session_factory(info),
        remote_start_installed=track.remote_start_installed,
        lane_count=track.lane_count,
        reverse_lanes=track.reverse_lanes,
    )


def _start_backend_direct(
    mgr: TimerManager, serial_port: str | None, profile: TimerProfile | None = None
) -> None:
    """Bring a backend-direct timer up, in the background.

    A port entered by hand is honoured exactly as given — the operator may know
    something the probe does not, and a probe writes to every port it tries.
    With no port configured, go and find the timer, which is what
    ``AUTO_DETECT_BACKEND`` has always been named for (#89).

    ``profile`` is the model the operator named, if they named one. It narrows
    the port search to that model rather than walking all seven: they are
    asking *which port*, not *which timer*, and the probe's writes land on
    their hardware either way (#143).

    One helper rather than the branch written out at each call site: there are
    four, and #48 is the standing reminder of what happens when a rule like
    this ends up on only some of them.
    """
    if serial_port:
        asyncio.create_task(mgr.connect_direct(serial_port))
    else:
        asyncio.create_task(mgr.autodetect([profile] if profile else None))


def _apply_pins(organization: Any, config: "InitialConfigInput") -> None:
    """Store whichever PINs the wizard sent, hashed (#15).

    Absent means *leave alone* and an explicit empty string means *clear*. The
    two have to differ: the settings page re-submits the whole config on every
    save, and it cannot send back a PIN it is never given — so treating "not
    supplied" as "clear it" would switch enforcement off every time the operator
    changed a track name.
    """
    for field, column in (
        ("operator_pin", "operator_pin_hash"),
        ("checkin_pin", "checkin_pin_hash"),
    ):
        value = getattr(config, field, None)
        if value is None:
            continue
        setattr(organization, column, auth.hash_pin(value) if value else None)


def _apply_themes(organization: Any, display_theme: str, printables_theme: str) -> None:
    """Store the Display/Printables theme (#498), written by `setThemes` (#1080).

    Used to be one of `updateInitialConfig`'s many fields, absent-means-leave-
    alone like `_apply_pins`; `setThemes` is a dedicated mutation with no
    other field to leave alone, so both arguments are always the caller's
    explicit choice — there is no bare-null "leave alone versus clear"
    ambiguity to resolve here either way, since the column's own "off" state
    is the literal string `"MATCH_APP"`, not `None`.
    """
    organization.display_theme = display_theme
    organization.printables_theme = printables_theme


def _apply_name_display(organization: Any, config: "InitialConfigInput") -> None:
    """Store whichever install-wide name-display default the settings page
    sent (#552).

    Absent means *leave alone*, the same shape as `_apply_themes` — `FULL`
    is itself the non-null "off" state, so there is no clear flag here the
    way `_apply_terminology` needs one.
    """
    if config.name_display is not None:
        organization.name_display = config.name_display


def _apply_replay_retention(organization: Any, config: "InitialConfigInput") -> None:
    """Store the stored-replay-clips setting and its two bounds (#177 stage 2).

    `keepReplays` follows `_apply_pins`' shape: absent means leave alone.
    `replayRetentionHeats`/`replayRetentionMb` are each `int | None`, so an
    absent value on the input already means "leave alone" — getting back to
    *unbounded* needs the explicit `clearReplayRetentionHeats`/
    `clearReplayRetentionMb` flags, the same trap `clearWeightLimit` (#205)
    and `clearTerminology` (#496) already solved.

    Never reached on the demo: `updateInitialConfig` is refused there
    wholesale (it can also set both PINs and reconfigure tracks), which is
    exactly the property this setting needs — turning stored clips on
    writes a caller-supplied file to disk on every future upload, unlike
    Debugging Mode and the two themes (#1079, #1080), so this was
    deliberately *not* split into its own demo-reachable mutation. See
    `InitialConfigInput.keep_replays`'s own docstring.
    """
    if config.keep_replays is not None:
        organization.keep_replays = config.keep_replays

    if config.clear_replay_retention_heats:
        organization.replay_retention_heats = None
    elif config.replay_retention_heats is not None:
        organization.replay_retention_heats = config.replay_retention_heats

    if config.clear_replay_retention_mb:
        organization.replay_retention_mb = None
    elif config.replay_retention_mb is not None:
        organization.replay_retention_mb = config.replay_retention_mb


def _apply_terminology(organization: Any, config: "InitialConfigInput") -> None:
    """Store whichever custom terminology the settings page sent (#496 stage 3).

    Absent means *leave alone*, same shape as `_apply_pins` — but unlike
    `_apply_themes`, there is no non-null sentinel meaning "off": the built-in
    Scouting words *are* the null state, so `clearTerminology` is the explicit
    way back to it, the same trap `clear_weight_limit` (#205) and the PIN's
    removal control (#192) already solved.

    This is the one door the organization-level words go through —
    `InitialConfigInput` is a plain strawberry input with no validation of
    its own (unlike the per-race override, built through the pydantic
    `schemas.RaceUpdate`), so a blank word is checked right here rather than
    left to reach the database. `domain_terminology.reject_blank_word` is
    the same rule `schemas.py`'s validators call, shared so the two layers
    cannot silently disagree about what counts as blank (#704). Checked
    before anything is written, not field by field as it goes, so a blank
    fourth word does not leave the first three set on an `organization` this
    function's caller may still be about to abandon.
    """
    if config.clear_terminology:
        for field in _TERMINOLOGY_FIELDS:
            setattr(organization, field, None)
        return
    for field in domain_terminology.TERMINOLOGY_WORD_FIELDS:
        value = getattr(config, field, None)
        if value is not None:
            domain_terminology.reject_blank_word(field, value)
    for field in _TERMINOLOGY_FIELDS:
        value = getattr(config, field, None)
        if value is None:
            continue
        setattr(organization, field, value)


def _get_pubsub() -> Any:
    """Resolve `pubsub` through `backend.api.schema` so test patches apply."""
    import backend.api.schema as schema_pkg

    return schema_pkg.pubsub


async def _publish_race_state_pkg(
    race_id: int,
    kind: Any = None,
    heat: Any = None,
    racer: Any = None,
    round_id: int | None = None,
    intermission_race: Any = None,
) -> None:
    """Dispatch `_publish_race_state` via `backend.api.schema` for test patches."""
    import backend.api.schema as schema_pkg

    if kind is None:
        from .enums import RaceChangeKind

        kind = RaceChangeKind.OTHER
    await schema_pkg._publish_race_state(
        race_id,
        kind=kind,
        heat=heat,
        racer=racer,
        round_id=round_id,
        intermission_race=intermission_race,
    )


def _start_backend_direct_pkg(
    mgr: TimerManager, serial_port: str | None, profile: TimerProfile | None = None
) -> None:
    """Dispatch `_start_backend_direct` via `backend.api.schema` for test patches."""
    import backend.api.schema as schema_pkg

    if profile is not None:
        schema_pkg._start_backend_direct(mgr, serial_port, profile)
    else:
        schema_pkg._start_backend_direct(mgr, serial_port)


def _get_max_upload_bytes() -> int:
    """Resolve `MAX_UPLOAD_BYTES` via `backend.api.schema` so test patches apply."""
    import backend.api.schema as schema_pkg

    return schema_pkg.MAX_UPLOAD_BYTES
