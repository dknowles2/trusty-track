import json
import typing
from collections.abc import Iterable, Mapping
from typing import Any

import strawberry
from sqlalchemy.orm import Session
from strawberry.types import Info

from backend.api import auth
from backend.db import models
from backend.domain import audit
from backend.domain import heat_session as domain_heat_session
from backend.domain import name_display as domain_name_display
from backend.domain import terminology as domain_terminology

from .common import Terminology, _audit_entry, _require_operator_role, _terminology_type
from .types_race import LaneResult, Track, TrackInput, _stored_lanes


@strawberry.type
class TimerModel:
    """One timer the app knows how to talk to, for the operator to pick from.

    The frontend has no copy of the profiles and should not get one — the
    backend owns every piece of protocol state, and the browser is a wire even
    when it is holding the port. What it needs is a list to show and a key to
    send back.

    ``provenance`` is here because "we have a profile for your timer" and "your
    timer is known to work" are different claims, and for most of these only
    the first is true. An operator choosing a model deserves to see which.
    """

    key: str
    name: str
    provenance: str
    #: Whether a probe can find this model on its own. False means choosing it
    #: by hand is the *only* way to reach it — which is what #143 was about.
    detectable: bool
    #: The port framing, so the picker can warn that a hand-entered port will
    #: be opened at something other than the usual 9600 8-N-1.
    baud_rate: int
    data_bits: int
    stop_bits: float
    parity: str


@strawberry.type
class SchedulingAlgorithmOption:
    """One registered `GENERAL`-round scheduling algorithm, for the round
    wizard's "How heats are built" choice (#1090, part D).

    `value`/`label`/`absorbsLatecomer` mirror the registry entry directly;
    `guarantee` is the one-line sentence the wizard shows beside each radio,
    also from the registry so it cannot drift from `.claude/rules/
    scheduling.md`'s own account of what each algorithm actually promises.
    `unavailableReason` and `heatCount` are the two answers that genuinely
    depend on *this* field/lane shape rather than being fixed per algorithm
    — see `Query.schedulingAlgorithms`.
    """

    value: str
    label: str
    guarantee: str
    #: Why this algorithm cannot schedule `racerCount`/`laneCount`, or null
    #: when it can. Null for PPC and ROTATION at every shape
    #: `Scheduler.available_for` is ever asked about; Perfect-N's is a real
    #: refusal outside the ~41 shapes its directory covers.
    unavailable_reason: str | None
    absorbs_latecomer: bool
    #: Heats *one run* produces at this exact shape, when not simply
    #: `racerCount` — see `Scheduler.heat_count`'s own docstring. Null for
    #: PPC/ROTATION (always one heat per racer) and for an unavailable
    #: Perfect-N shape (nothing to count).
    heat_count: int | None


@strawberry.type
class InitialConfigStatus:
    """
    Represents the system initialization state.
    """

    initialized: bool
    version: str
    organization_name: str | None = None
    debug_mode: bool = False
    tracks: list["Track"] = strawberry.field(default_factory=list)
    current_race_id: int | None = None
    #: Whether this process is serving the public demo
    #: (:mod:`backend.demo_mode`). The client needs it for the same reason the
    #: PIN flags below are here: it is a fact about the *install* that changes
    #: what the UI should do, and there is no other way for a page served by
    #: this server to find out. It drives the idle disconnect — a parked demo
    #: tab holds a subscription socket open, and an instance with a socket open
    #: never scales to zero.
    demo_mode: bool = False
    #: Which mutations `DemoPolicyExtension` refuses on this instance —
    #: `demo_policy.REFUSED_MUTATIONS` itself, sorted, or empty off the demo
    #: (#1092/#1095). The frontend disables a control *before* the click by
    #: checking this list rather than keeping its own hand-written copy of
    #: `demo_policy.py`'s table, which is exactly the kind of second copy
    #: this codebase's own rule (#48) warns drifts from the original.
    demo_refused_mutations: list[str] = strawberry.field(default_factory=list)
    #: Whether an operator PIN is set — i.e. whether roles are enforced at all
    #: (#15). Never the PIN or its hash: this says only that a lock exists, so
    #: the settings page can tell the operator which state they are in.
    pin_required: bool = False
    #: The same fact about the optional check-in PIN. Both are needed because
    #: the settings page can only offer to *remove* a PIN that exists, and a
    #: blank field means "leave it alone" rather than "there isn't one" (#192).
    checkin_pin_set: bool = False
    #: Whether the *caller* currently holds the operator role. Lets the UI ask
    #: for the PIN before an action fails rather than after.
    is_operator: bool = True
    #: The caller's full resolved role — `VIEWER`, `CHECKIN` or `OPERATOR`
    #: (#892). `is_operator` above only ever answers "operator or not", which
    #: cannot tell a wall display apart from the check-in desk; a screen that
    #: wants to hide or disable a check-in-level control (Add Racer, Check
    #: In) rather than only an operator-only one needs the third value. Read
    #: through `auth.resolve_role`, the exact function `RolePolicyExtension`
    #: itself asks — never a second copy of that decision.
    role: auth.Role = auth.Role.OPERATOR
    #: Which theme the Display and Printables surfaces render, install-wide
    #: (#498). A `ThemeKey` or `"MATCH_APP"` — see `models.Organization.display_theme`
    #: for why this is a plain string rather than a GraphQL enum. There is
    #: deliberately no `appTheme` field here: the App theme lives only in each
    #: device's own `localStorage` and never reaches the server.
    display_theme: str = "MATCH_APP"
    printables_theme: str = "MATCH_APP"
    #: The organization's raw terminology overrides, null where it has not
    #: renamed that word (#496 stage 3) — what the settings form reads back
    #: to populate its inputs, distinct from `terminology` below which is
    #: always filled in.
    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    #: The organization's raw vehicle-word override (#551), null where it
    #: has not renamed "Car" — same distinction as the four fields above.
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    #: The organization's raw vehicle-artwork override (#551, stage 4), null
    #: where it has not chosen one — same distinction as the fields above.
    vehicle_artwork_key: str | None = None
    #: The resolved words — organization default over the built-in Scouting
    #: ones, with no race in play here. Defaulted so the unconfigured branch
    #: (no organization yet) still returns something rather than nothing.
    terminology: Terminology = strawberry.field(
        default_factory=lambda: _terminology_type(
            domain_terminology.DEFAULT_TERMINOLOGY
        )
    )
    #: The organization's raw name-display override, null where it has not
    #: changed it from `FULL` (#552) — what the settings form reads back to
    #: populate its picker, distinct from `resolvedNameDisplay` below.
    name_display: str | None = None
    #: The resolved name-display setting for screens with no race in view
    #: (Home, System Settings) — organization default over `FULL`. See
    #: `Race.resolvedNameDisplay` for the layer a race adds on top.
    resolved_name_display: str = domain_name_display.DEFAULT_NAME_DISPLAY
    #: Whether a stored replay clip (#177 stage 2) survives longer than
    #: delete-after-next-heat. Off by default — see
    #: `models.Organization.keep_replays`.
    keep_replays: bool = False
    #: The two independent, optional retention bounds — null means
    #: unbounded at that dimension. Meaningful only once `keepReplays` is
    #: on, but served regardless so the settings form can show whatever an
    #: operator typed before turning the setting back on.
    replay_retention_heats: int | None = None
    replay_retention_mb: int | None = None


@strawberry.input
class InitialConfigInput:
    """
    Input for initial system configuration.
    """

    organization_name: str
    tracks: list["TrackInput"]
    #: Four digits, or empty/None to leave unchanged. Setting the operator PIN
    #: is what turns enforcement on; clearing it turns it off again, which is
    #: the escape hatch for an operator who has locked themselves out and can
    #: reach the machine (#15).
    operator_pin: str | None = None
    checkin_pin: str | None = None
    #: The install-wide default words for a racing group and for the
    #: organization itself (#496 stage 3). Absent means leave alone, the same
    #: shape as the PINs above — but unlike them (and unlike the themes,
    #: which have a non-null "off" sentinel), there is no value that already
    #: means "reset to Den and Pack", so `clearTerminology` is the explicit
    #: way back to null, following `RaceUpdateInput.clearWeightLimit` (#205).
    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    #: The install-wide default word for a racer's vehicle (#551) — "Car" by
    #: default, wrong for a Space Derby or a Raingutter Regatta. Same
    #: absent-means-leave-alone shape as the racing-group/organization words
    #: above, and covered by the same `clearTerminology` flag.
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    #: The install-wide default vehicle artwork (#551, stage 4) — one of
    #: `domain_terminology.VEHICLE_ARTWORK_KEYS`. Same shape as the six
    #: fields above.
    vehicle_artwork_key: str | None = None
    clear_terminology: bool = False
    #: The install-wide default for how much of a racer's name a public
    #: screen may show (#552) — one of `domain_name_display.NAME_DISPLAY_VALUES`.
    #: Absent leaves the current setting alone; any other value — including
    #: `"FULL"` — is the new setting, the same `display_theme` shape: `FULL`
    #: is itself the non-null "off" state, so there is no clear flag here.
    name_display: str | None = None
    #: Whether a stored replay clip (#177 stage 2) survives longer than
    #: delete-after-next-heat. Absent leaves the column alone — the same
    #: shape as the PINs above: the settings page resends the whole config
    #: on every save, and a bare `false` it never meant would silently turn
    #: stored clips back off on the next unrelated save.
    #:
    #: Deliberately **not** split into its own `setDebugMode`/`setThemes`
    #: -style dedicated mutation (#1079, #1080), even though this is the
    #: same `updateInitialConfig` bundle those two were split *out* of for
    #: the demo's sake. Their reason for splitting was letting a demo
    #: visitor reach a harmless field despite the bundle's own wholesale
    #: refusal; this field needs the opposite — turning stored clips on
    #: means a caller-supplied file lands on disk on every future upload —
    #: so staying inside the bundle that is already wholesale refused on
    #: the demo is what keeps it refused, with no new entry needed in
    #: `demo_policy.REFUSED_MUTATIONS`.
    keep_replays: bool | None = None
    #: Last-N-heats bound; `None` on this input means leave alone, the same
    #: absent-means-leave-alone shape as everywhere else on this input — so
    #: getting back to *unbounded* needs the explicit `clearReplayRetention
    #: Heats` flag below, following `clearWeightLimit` (#205) and
    #: `clearTerminology` (#496).
    replay_retention_heats: int | None = None
    replay_retention_mb: int | None = None
    clear_replay_retention_heats: bool = False
    clear_replay_retention_mb: bool = False


@strawberry.type
class AuditLogEntry:
    """One line of the timeline (#219).

    Everything a screen needs to render the entry is on the entry. Nothing here
    is looked up against the race, deliberately: a round deleted in March
    cannot be named by asking what round 4 is called today, and an entry whose
    story changed as the data moved would be a second view of the present
    rather than a record of the past.
    """

    id: int
    #: ISO 8601 UTC.
    at: str
    action: str
    role: str
    outcome: str
    race_id: int | None
    #: The redacted details, as a JSON object. A string because the shape
    #: differs per action and a typed field per action would be forty of them.
    details: str | None

    @strawberry.field
    def source_ip(self, info: Info) -> str | None:
        """Where the request came from.

        Operator-only, like the query that reaches it — but named as its own
        field so a screen can choose not to ask. The timeline does not, by
        default: an address against every line is noise until the one evening
        somebody needs to know which device did something.
        """
        _require_operator_role(info)
        # `self` is the ORM row, not this class — Strawberry types here are
        # duck-typed shells. So this reads the column rather than recursing.
        return typing.cast(models.AuditEntry, self).source_ip

    @strawberry.field
    def summary(self) -> str:
        """The sentence to show, rendered from this entry alone."""
        return audit.describe(_audit_entry(typing.cast(models.AuditEntry, self)))

    @strawberry.field
    def noteworthy(self) -> bool:
        """Whether this one deserves attention rather than merely a line."""
        return audit.is_noteworthy(_audit_entry(typing.cast(models.AuditEntry, self)))

    @strawberry.field
    def category(self) -> audit.AuditCategory | None:
        """Which of the six subjects this entry is about (#1253), or `None`
        for an action `ACTIONS_BY_CATEGORY` has not caught up with yet.

        Resolved from `action` alone via `domain.audit.category_of`, the same
        table the server-side `categories` filter on `Query.auditLog` builds
        its `WHERE` clause from — so the chip the client renders next to a
        row can never disagree with which chip would have filtered it in.
        """
        return audit.category_of(self.action)


@strawberry.type
class SerialLogEntry:
    """A single serial command logged by the timer."""

    direction: str  # "RX" or "TX"
    data: str
    timestamp: str


@strawberry.type
class TimerTransitionEntry:
    """One state-machine transition, for the debug panel (#1079).

    Populated for every timer type, fake included — unlike `SerialLogEntry`
    above, which only a real device's wire produces, so it is the one debug
    view the demo's `FAKE` track can show anything on.
    """

    at: str
    from_state: str
    to_state: str


@strawberry.type
class TimerStatus:
    """Current state of the timer for a track."""

    state: str
    device_name: str | None
    #: Where the device's description came from, and whether it has ever been
    #: run against the hardware. Most profiles are adapted from DerbyNet and
    #: have not been, which the operator deserves to know before trusting one.
    device_provenance: str | None = None
    lane_count: int | None = None
    active_heat_id: int | None = None
    last_error: str | None = None
    #: The serial port in use, if any. In backend-direct mode this is usually
    #: found rather than configured (#89), so it is the only way for an
    #: operator to see which port the timer was detected on.
    port: str | None = None
    #: Whether to offer the operator a "release the gate" control. True needs
    #: both halves: the connected device has a command for it, and the track is
    #: marked as having the solenoid it drives. Reported here rather than
    #: derived on the client, because the client has no copy of the profiles.
    can_remote_start: bool = False
    #: Three plain claims about the connected model, straight off the profile
    #: (#553) — GPRM's "Indicate Timing Started", "Count Down Clock" and
    #: "Photo Finish Trigger" columns. Unlike `can_remote_start` these need no
    #: track-side setting: there is no accessory to install, either the model
    #: has it or it does not. Datasheet claims, most of them never checked
    #: against real hardware — read them next to `device_provenance`.
    indicates_timing_started: bool = False
    has_countdown_clock: bool = False
    has_photo_finish_trigger: bool = False
    pending_results: list[LaneResult] = strawberry.field(default_factory=list)
    serial_log: list[SerialLogEntry] = strawberry.field(default_factory=list)
    #: The state machine's own recent history (#1079) — shown under the same
    #: `debugMode` gate as `serial_log`, but for every timer type, since a
    #: `FAKE` track (the demo's own) has no bytes to tail.
    transitions: list[TimerTransitionEntry] = strawberry.field(default_factory=list)
    racer_by_lane: str | None = None  # JSON mapping of lane -> racer_id
    #: The armed (or just-finished) run is a bench exercise, not a heat
    #: (#235) — the diagnostics page shows its results as a test's.
    test_run: bool = False


@strawberry.type
class LiveLane:
    """One lane of the heat on the track right now (#7).

    The same shape as :class:`HeatLane`, plus ``pending``. The extra field is
    the point: a time that came from the timer and is not in the database yet
    can still be lost to an abort, and the operator screen has to be able to
    say so rather than presenting it as final.
    """

    lane: int
    racer_id: int | None
    placeholder_slot: int | None
    time: float | None
    place: int | None
    skipped: bool
    pending: bool


@strawberry.type
class HeatSession:
    """What is happening on a track right now — issue #7.

    Three things knew part of this and nothing owned assembling it: the heat row
    holds the schedule and any saved results, the ``TimerManager`` holds lane
    times that have arrived but not landed, and ``RaceExecution.tsx`` merged the
    two in its render function. The rule now lives in
    :mod:`backend.domain.heat_session`; this is where it is served from.
    """

    track_id: int
    heat_id: int | None
    phase: domain_heat_session.Phase
    #: The device's own state (``IDLE``, ``ARMED``, ``FAULT``…), which is a
    #: different question from :attr:`phase` and still worth showing.
    timer_state: str
    lanes: list[LiveLane]


def _live_lanes(merged: Iterable[domain_heat_session.LiveLane]) -> list[LiveLane]:
    return [
        LiveLane(
            lane=lane.lane,
            racer_id=lane.racer_id,
            placeholder_slot=lane.placeholder_slot,
            time=lane.time_seconds,
            place=lane.place,
            skipped=lane.skipped,
            pending=lane.pending,
        )
        for lane in merged
    ]


def _pending_lanes(status) -> list[domain_heat_session.PendingLane]:
    """The timer's unsaved reports, as the domain layer takes them.

    ``racerId`` is left unset deliberately. Our devices report a lane and a
    time, not a car — the racer comes from the mapping the timer was armed with,
    which is passed to ``merge`` separately. Filling it in from that same
    mapping here would make two of the domain's three sources one source wearing
    a hat, which is what the frontend did.
    """
    if status is None:
        return []
    return [
        domain_heat_session.PendingLane(
            lane=result["lane"],
            time_seconds=result["time"],
            place=result["place"],
        )
        for result in status.pending_results
    ]


def _build_heat_session(
    db: Session,
    timer_managers: Mapping[int, Any],
    track_id: int,
    heat_id: int | None = None,
) -> HeatSession:
    """Assemble the live view of a track from the heat and the timer.

    A plain function rather than a method so the query and the subscription
    answer identically — the subscription's whole job is to re-emit this, and
    two copies of the assembly is how they would drift.
    """
    manager = timer_managers.get(track_id)
    status = manager.status() if manager else None

    if heat_id is None and status is not None:
        heat_id = status.active_heat_id

    heat = (
        db.query(models.Heat).filter(models.Heat.id == heat_id).first()
        if heat_id is not None
        else None
    )
    # A heat id that names nothing is NO_HEAT, not an error: the operator can
    # delete a round while its heat is still armed.
    stored = _stored_lanes(db, heat) if heat is not None else None

    return HeatSession(
        track_id=track_id,
        heat_id=heat.id if heat is not None else None,
        phase=domain_heat_session.phase(stored, status.state if status else None),
        timer_state=status.state if status else "DISCONNECTED",
        lanes=(
            _live_lanes(
                domain_heat_session.merge(
                    stored,
                    _pending_lanes(status),
                    racer_by_lane=status.racer_by_lane if status else None,
                )
            )
            if stored is not None
            else []
        ),
    )


@strawberry.type
class TimerStateChangedEvent:
    """Event emitted whenever the timer state changes for a track."""

    track_id: int
    status: TimerStatus
    changed_at: str  # ISO 8601 UTC timestamp


def _timer_status(s) -> TimerStatus:
    """Convert the ``TimerStatus`` dataclass to the Strawberry type.

    One copy, deliberately. The query built this from a manager and the
    subscription built it inline from the dataclass the pub/sub channel
    carries, which is the arrangement where a field added to one is silently
    missing from the other — and with a normalized cache on the client, a
    subscription payload lacking a field the query supplied is how a value
    disappears from a screen mid-event.
    """
    return TimerStatus(
        state=s.state,
        device_name=s.device_name,
        device_provenance=s.device_provenance,
        port=s.port,
        can_remote_start=s.can_remote_start,
        indicates_timing_started=s.indicates_timing_started,
        has_countdown_clock=s.has_countdown_clock,
        has_photo_finish_trigger=s.has_photo_finish_trigger,
        lane_count=s.lane_count,
        active_heat_id=s.active_heat_id,
        last_error=s.last_error,
        pending_results=[
            LaneResult(
                lane=r["lane"],
                time=r["time"],
                place=r["place"],
                racer_id=s.racer_by_lane.get(r["lane"]),
            )
            for r in s.pending_results
        ],
        serial_log=[
            SerialLogEntry(
                direction=e.direction,
                data=e.data,
                timestamp=e.timestamp,
            )
            for e in s.serial_log
        ],
        transitions=[
            TimerTransitionEntry(
                at=t.at,
                from_state=t.from_state,
                to_state=t.to_state,
            )
            for t in s.transitions
        ],
        racer_by_lane=json.dumps(s.racer_by_lane) if s.racer_by_lane else None,
        test_run=s.test_run,
    )


def _timer_status_from_manager(mgr) -> TimerStatus:
    return _timer_status(mgr.status())
