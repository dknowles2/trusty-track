from __future__ import annotations

import json
import random
from collections.abc import Sequence
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import demo_seed
from backend.domain import (
    advancement,
    audit,
    awards,
    balanced,
    elimination,
    intermission,
    lanes,
    latecomers,
    practice,
    roster_import,
    running_order,
    scheduling,
    terminology,
)
from backend.domain.displays import Assignment

from . import lane_sync, models, schemas


def stamp_recorded(heat: models.Heat, heat_lanes: Sequence[lanes.Lane]) -> None:
    """Keep ``recorded_at`` in step with whether the heat holds a result.

    Called from the two functions that record results, so a heat that is
    re-recorded moves to the front of the running order and one whose result is
    cleared (a re-run) leaves it. Nothing else touches the column: editing a
    schedule is not running a heat, and #59 wants the order things happened in.

    Kept next to the write rather than hooked onto the session like
    ``lane_sync``: the projection there has to mirror every write, and this one
    deliberately does not.
    """
    if lanes.has_results(heat_lanes):
        heat.recorded_at = datetime.now(timezone.utc).isoformat()
    else:
        heat.recorded_at = None


def get_organization(db: Session, organization_id: int) -> models.Organization | None:
    return (
        db.query(models.Organization)
        .filter(models.Organization.id == organization_id)
        .first()
    )


def get_organization_by_name(db: Session, name: str) -> models.Organization | None:
    return (
        db.query(models.Organization).filter(models.Organization.name == name).first()
    )


def create_organization(
    db: Session, organization: schemas.OrganizationCreate
) -> models.Organization:
    db_organization = models.Organization(name=organization.name)
    db.add(db_organization)
    db.commit()
    db.refresh(db_organization)
    return db_organization


def get_racing_groups(
    db: Session, race_id: int, skip: int = 0, limit: int = 100
) -> list[models.RacingGroup]:
    # Ordered: an unordered query with offset/limit pages arbitrarily, and
    # `populate` deals seeded racing group assignments from this list (`demo_seed`).
    return (
        db.query(models.RacingGroup)
        .filter(models.RacingGroup.race_id == race_id)
        .order_by(models.RacingGroup.id)
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_racing_group(db: Session, racing_group_id: int) -> models.RacingGroup | None:
    return (
        db.query(models.RacingGroup)
        .filter(models.RacingGroup.id == racing_group_id)
        .first()
    )


def get_racing_group_by_name(
    db: Session, name: str, race_id: int
) -> models.RacingGroup | None:
    # Example: Case insensitive search could be done here if DB supports it easily,
    # or just do exact match for simplicity first
    return (
        db.query(models.RacingGroup)
        .filter(models.RacingGroup.name == name, models.RacingGroup.race_id == race_id)
        .first()
    )


def create_racing_group(
    db: Session, racing_group: schemas.RacingGroupCreate, race_id: int
) -> models.RacingGroup:
    db_racing_group = models.RacingGroup(**racing_group.model_dump(), race_id=race_id)
    db.add(db_racing_group)
    db.commit()
    db.refresh(db_racing_group)
    return db_racing_group


def delete_racing_group(db: Session, racing_group_id: int) -> models.RacingGroup | None:
    db_racing_group = (
        db.query(models.RacingGroup)
        .filter(models.RacingGroup.id == racing_group_id)
        .first()
    )
    if db_racing_group:
        # A per-racing group general round (`Round.racing_group_id`, from the
        # wizard's "EACH_GROUP" option) would otherwise fail that column's
        # foreign key (#125) with an unhandled IntegrityError. Unlike a
        # racer's racing_group_id, nulling it
        # would silently change what the round means — which racers it draws
        # from — rather than merely losing an assignment, so this refuses
        # instead, the same shape `delete_track` uses when races exist.
        round_scoped = (
            db.query(models.Round)
            .filter(models.Round.racing_group_id == racing_group_id)
            .first()
        )
        if round_scoped:
            raise ValueError("Cannot delete racing_group: a round is scoped to it.")

        racers = (
            db.query(models.Racer)
            .filter(models.Racer.racing_group_id == racing_group_id)
            .all()
        )
        for racer in racers:
            racer.racing_group_id = None

        db.delete(db_racing_group)
        db.commit()
    return db_racing_group


def update_racing_group(
    db: Session, racing_group_id: int, racing_group_update: schemas.RacingGroupUpdate
) -> models.RacingGroup | None:
    db_racing_group = (
        db.query(models.RacingGroup)
        .filter(models.RacingGroup.id == racing_group_id)
        .first()
    )
    if not db_racing_group:
        return None

    update_data = racing_group_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_racing_group, key, value)

    db.commit()
    db.refresh(db_racing_group)
    return db_racing_group


def get_races(db: Session, skip: int = 0, limit: int = 100) -> list[models.Race]:
    """Get all races with computed registered and checked-in racer counts."""
    races = db.query(models.Race).offset(skip).limit(limit).all()
    for race in races:
        race.registered_count = (
            db.query(models.Racer).filter(models.Racer.race_id == race.id).count()
        )
        race.checked_in_count = (
            db.query(models.Racer)
            .filter(
                models.Racer.race_id == race.id,
                models.Racer.car_passed_inspection,
            )
            .count()
        )
    return races


def create_race(db: Session, race: schemas.RaceCreate) -> models.Race:
    """Create a race, and any racing groups sent along with it (#662).

    The groups go in the same commit as the race, in the order they were
    given — the setup wizard scaffolds a pack's dens in rank order, and
    `get_racing_groups` orders by id, so creation order is display order.
    One transaction rather than a race followed by N group inserts is #201's
    reasoning: a setup that fails half way must not leave a half-built race.
    """
    race_data = race.model_dump()
    racing_groups = race_data.pop("racing_groups", [])
    db_race = models.Race(**race_data)
    db.add(db_race)
    db.flush()
    for racing_group in racing_groups:
        db.add(models.RacingGroup(**racing_group, race_id=db_race.id))
    db.commit()
    db.refresh(db_race)
    return db_race


def update_race(
    db: Session, race_id: int, race_update: schemas.RaceUpdate
) -> models.Race | None:
    db_race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not db_race:
        return None

    update_data = race_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_race, key, value)

    db.commit()
    db.refresh(db_race)
    return db_race


def get_race(db: Session, race_id: int) -> models.Race | None:
    """Get a specific race by ID with computed racer counts."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race:
        race.registered_count = (
            db.query(models.Racer).filter(models.Racer.race_id == race.id).count()
        )
        race.checked_in_count = (
            db.query(models.Racer)
            .filter(
                models.Racer.race_id == race.id,
                models.Racer.car_passed_inspection,
            )
            .count()
        )
    return race


def delete_race(db: Session, race_id: int) -> bool:
    """Remove a race and everything that hangs off it.

    Two of the three children need doing by hand. ``Race.racing_groups`` and
    ``Race.rounds`` carry ``cascade="all, delete-orphan"``, so deleting the race
    takes them; ``Race.racers`` and ``Race.heats`` do not, and a heat belongs to
    the race directly as well as to a round — a free race heat has no round at
    all (#6), so leaving heats to the round cascade would strand every one of
    them.

    Heats go before racers, so the lane rows are cascade-deleted while their
    racers are still there. The other order also works — ``heat_lanes.racer_id``
    is ``ON DELETE SET NULL`` (#125) — but it means every lane in the race gets
    nulled on the way to being deleted a statement later, and it leaves the
    function quietly depending on a clause it does not mention.
    """
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        return False

    # Deliberately not `official_heats`: this takes both kinds.
    db.query(models.Heat).filter(models.Heat.race_id == race_id).delete()
    db.query(models.Racer).filter(models.Racer.race_id == race_id).delete()

    db.delete(race)
    db.commit()
    return True


# --------------------------------------------------------------------------- #
# Intermission (#592)                                                         #
# --------------------------------------------------------------------------- #
#
# Five thin wrappers around `domain/intermission.py`'s pure functions: read
# the race's three columns into an `intermission.State`, call the rule, write
# the result back. All the actual decisions — what counts as active, what a
# pause freezes, what "extend" adds to — live in the domain module and are
# tested there with no database; this is only the I/O half of that split.


def _intermission_state(race: models.Race) -> intermission.State:
    return intermission.State(
        ends_at=race.intermission_ends_at,
        paused_remaining_seconds=race.intermission_paused_remaining_seconds,
        label=race.intermission_label,
    )


def _write_intermission_state(race: models.Race, state: intermission.State) -> None:
    race.intermission_ends_at = state.ends_at
    race.intermission_paused_remaining_seconds = state.paused_remaining_seconds
    race.intermission_label = state.label


def start_intermission(
    db: Session, race_id: int, duration_seconds: int, label: str | None
) -> models.Race:
    """Begin (or restart) a break. See `domain.intermission.start`."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None:
        raise ValueError("Race not found")
    _write_intermission_state(
        race,
        intermission.start(duration_seconds, label, datetime.now(timezone.utc)),
    )
    db.commit()
    db.refresh(race)
    return race


def extend_intermission(db: Session, race_id: int, seconds: int) -> models.Race:
    """Add time to the break under way. See `domain.intermission.extend`."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None:
        raise ValueError("Race not found")
    _write_intermission_state(
        race,
        intermission.extend(
            _intermission_state(race), seconds, datetime.now(timezone.utc)
        ),
    )
    db.commit()
    db.refresh(race)
    return race


def pause_intermission(db: Session, race_id: int) -> models.Race:
    """Freeze the countdown. See `domain.intermission.pause`."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None:
        raise ValueError("Race not found")
    _write_intermission_state(
        race, intermission.pause(_intermission_state(race), datetime.now(timezone.utc))
    )
    db.commit()
    db.refresh(race)
    return race


def resume_intermission(db: Session, race_id: int) -> models.Race:
    """Start the countdown again. See `domain.intermission.resume`."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None:
        raise ValueError("Race not found")
    _write_intermission_state(
        race,
        intermission.resume(_intermission_state(race), datetime.now(timezone.utc)),
    )
    db.commit()
    db.refresh(race)
    return race


def end_intermission(db: Session, race_id: int) -> models.Race:
    """Clear the break, idempotently. See `domain.intermission.end`."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None:
        raise ValueError("Race not found")
    _write_intermission_state(race, intermission.end())
    db.commit()
    db.refresh(race)
    return race


def get_tracks(db: Session) -> list[models.Track]:
    return db.query(models.Track).all()


def get_track(db: Session, track_id: int) -> models.Track | None:
    return db.query(models.Track).filter(models.Track.id == track_id).first()


def create_track(db: Session, track: schemas.TrackCreate) -> models.Track:
    db_track = models.Track(**track.model_dump())
    db.add(db_track)
    db.commit()
    db.refresh(db_track)
    return db_track


def create_initial_config(
    db: Session, config: schemas.InitialConfigCreate
) -> tuple[models.Organization, list[models.Track]]:
    # Create Organization
    organization = models.Organization(
        name=config.organization_name, debug_mode=config.debug_mode
    )
    # Only set when given, so a caller that omits them gets the column's own
    # default (`"MATCH_APP"`) rather than an explicit `None` fighting the
    # `NOT NULL` constraint — the same "absent means unset" the ORM already
    # gives every other Python-side `default=`.
    if config.display_theme is not None:
        organization.display_theme = config.display_theme
    if config.printables_theme is not None:
        organization.printables_theme = config.printables_theme
    # Same shape as the themes above: `"FULL"` is itself the reachable "off"
    # state (#552), so there is no clear flag to carry here.
    if config.name_display is not None:
        organization.name_display = config.name_display
    db.add(organization)

    # Create Tracks
    created_tracks = []
    for track_data in config.tracks:
        track = models.Track(**track_data.model_dump())
        db.add(track)
        created_tracks.append(track)

    db.commit()
    db.refresh(organization)
    for t in created_tracks:
        db.refresh(t)
    return organization, created_tracks


def update_organization(
    db: Session, organization: models.Organization, name: str, debug_mode: bool = False
) -> models.Organization:
    organization.name = name
    organization.debug_mode = debug_mode
    db.commit()
    db.refresh(organization)
    return organization


def update_track(
    db: Session, track: models.Track, track_update: schemas.TrackBase
) -> models.Track:
    update_data = track_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(track, key, value)
    db.commit()
    db.refresh(track)
    return track


def delete_track(db: Session, track_id: int) -> bool:
    track = db.query(models.Track).filter(models.Track.id == track_id).first()
    if track:
        # Check if any races are associated
        if track.races:
            raise ValueError(
                "Cannot delete track: it is associated with one or more races."
            )
        db.delete(track)
        db.commit()
        return True
    return False


def get_racers(
    db: Session, skip: int = 0, limit: int = 100, race_id: int | None = None
) -> list[models.Racer]:
    # Ordered: an unordered query with offset/limit pages arbitrarily.
    query = db.query(models.Racer)
    if race_id:
        query = query.filter(models.Racer.race_id == race_id)
    return query.order_by(models.Racer.id).offset(skip).limit(limit).all()


def create_racer(db: Session, racer: schemas.RacerCreate) -> models.Racer | None:
    # Ensure a race exists.
    race: models.Race | None = None
    if racer.race_id:
        race = db.query(models.Race).filter(models.Race.id == racer.race_id).first()
    else:
        race = db.query(models.Race).first()

    if not race:
        organization = db.query(models.Organization).first()
        if not organization:
            return None
        race = models.Race(name="Main Event", organization_id=organization.id)
        db.add(race)
        db.commit()
        db.refresh(race)

    assert race is not None

    racer_data = racer.model_dump()
    if "race_id" in racer_data:
        del racer_data["race_id"]

    db_racer = models.Racer(**racer_data, race_id=race.id)
    db.add(db_racer)
    db.commit()
    db.refresh(db_racer)
    return db_racer


def existing_car_number_holders(db: Session, race_id: int) -> dict[int, str]:
    """`{car_number: "First Last"}` for every racer already in this race who
    has one. The I/O half of `domain.roster_import.existing_number_problems`
    (#618) — that rule needs no database, and this is the query that feeds it.
    """
    holders = (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race_id, models.Racer.car_number.isnot(None))
        .all()
    )
    return {
        holder.car_number: f"{holder.first_name} {holder.last_name}".strip()
        for holder in holders
        if holder.car_number is not None
    }


def write_imported_roster(
    db: Session, race_id: int, roster: roster_import.ParsedRoster
) -> int:
    """Write a `ParsedRoster` (#618) into this race's roster.

    The one door every future importer's confirm step writes through —
    `roster_from_tables` (GPRM today, DerbyNet at #661) and anything upstream
    of it stays program-specific; this only knows the shared vocabulary. A
    group already on the roster by name is reused rather than duplicated,
    the same match `import_racers`'s CSV loop already makes; a new one is
    created grey (`#808080`), same as that loop's own auto-created groups,
    since neither import has a colour to offer. Returns the number of racers
    created — late-racer admission and publishing race state are the
    caller's job, once for the whole batch (#343), not once per racer here.
    """
    group_ids: dict[str, int] = {}
    for group in roster.groups:
        existing_group = (
            db.query(models.RacingGroup)
            .filter(
                models.RacingGroup.race_id == race_id,
                models.RacingGroup.name == group.name,
            )
            .first()
        )
        if existing_group is not None:
            group_ids[group.name] = existing_group.id
            continue
        created_group = create_racing_group(
            db,
            schemas.RacingGroupCreate(
                name=group.name, color="#808080", division=group.division
            ),
            race_id,
        )
        group_ids[group.name] = created_group.id

    count = 0
    for imported in roster.racers:
        create_racer(
            db,
            schemas.RacerCreate(
                first_name=imported.first_name,
                last_name=imported.last_name,
                car_number=imported.car_number,
                car_name=imported.car_name,
                car_weight=imported.car_weight,
                car_passed_inspection=imported.passed_inspection,
                racing_group_id=(
                    group_ids.get(imported.group) if imported.group else None
                ),
                excluded_from_standings=imported.excluded_from_standings,
                race_id=race_id,
            ),
        )
        count += 1
    return count


def update_racer(
    db: Session, racer_id: int, racer_update: schemas.RacerUpdate
) -> models.Racer | None:
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if not db_racer:
        return None

    update_data = racer_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_racer, key, value)

    db.commit()
    db.refresh(db_racer)
    return db_racer


def bulk_assign_racer_photos(
    db: Session,
    assignments: list[dict],
) -> int:
    """Apply photo URLs to racers in bulk. Returns count of updated racers."""
    count = 0
    for a in assignments:
        racer_id = a.get("racer_id")
        url = a.get("url")
        photo_type = a.get("photo_type", "racer")
        if not racer_id or not url:
            continue
        if photo_type == "racer":
            update = schemas.RacerUpdate(racer_image_url=url)
        elif photo_type == "car":
            update = schemas.RacerUpdate(car_image_url=url)
        else:
            continue
        if update_racer(db, racer_id, update):
            count += 1
    return count


def _vacate_lanes(db: Session, racer_ids: set[int], race_id: int) -> None:
    """Empty every lane in a race that holds one of these racers.

    Called *before* the racers are deleted, which is what lets it read the
    lanes off ``heat_lanes`` (#72 step 4). ``ON DELETE SET NULL`` has already
    nulled ``racer_id`` by the time a post-delete pass runs, so a helper
    reading the table afterwards has nothing left to match on — the two
    predecessors of this function got away with it only by parsing the blob,
    which still named the racer.

    The clause covers the column; this covers the rest. A lane vacated by a
    deletion also loses its time and place — a recorded result belongs to a car
    that is no longer in the race — and the ``lane_results`` blob has to be
    rewritten, since it is still written alongside as a derived column.

    One function rather than the two it replaces: they differed only in which
    heats they selected, and both kinds are in one table since #6.
    """
    heats = db.query(models.Heat).filter(models.Heat.race_id == race_id).all()
    for heat, heat_lanes in zip(heats, lanes_for_heats(db, heats), strict=True):
        modified = False
        for lane in heat_lanes:
            if lane.racer_id in racer_ids:
                lane.racer_id = None
                lane.time = None
                lane.place = None
                modified = True
        if modified:
            set_heat_lanes(heat, heat_lanes)


def delete_racer(db: Session, racer_id: int) -> models.Racer | None:
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if db_racer:
        bulk_delete_racers(db, [racer_id])
    return db_racer


def get_heats(
    db: Session, race_id: int, round_id: int | None = None
) -> list[models.Heat]:
    """Get all heats for a specific race, ordered by round and heat number.

    Official heats only — free race heats share the table (#6) and belong to no
    round, so they have no place in a schedule.
    """
    query = models.official_heats(
        db.query(models.Heat).filter(models.Heat.race_id == race_id)
    )
    if round_id:
        return (
            query.filter(models.Heat.round_id == round_id)
            .order_by(models.Heat.heat_number)
            .all()
        )
    return (
        # Explicit `onclause`: `heats` now has two foreign keys into
        # `rounds` (#550's `settles_round_id`, alongside `round_id`), so a
        # bare `.join(models.Round)` can no longer infer which one this
        # join is about.
        query.join(models.Round, models.Heat.round_id == models.Round.id)
        .order_by(models.Round.round_number, models.Heat.heat_number)
        .all()
    )


#: A run-off heat has no `round_id`, so it has no natural position in
#: `(round_number, heat_number)` order. Sorting it after every real heat
#: everywhere it could plausibly land — the round it settles, or the whole
#: race when it settles the overall standings — is what lets it slot into
#: `execution_sort_key`'s scheme without that function knowing run-offs
#: exist: nothing generated ever reaches a heat_number this large.
_RUN_OFF_HEAT_NUMBER = 10_000_000
#: Sorts after every real round when a run-off settles the overall standings
#: (`settles_round_id is None`) rather than one specific round's.
_RUN_OFF_NO_ROUND_NUMBER = 1_000_000


def heats_in_running_order(db: Session, race_id: int) -> list[models.Heat]:
    """A race's official heats, plus any run-off heats, in the order they are
    meant to be *run*.

    The one door for "which heat is next" (#549): the `currentlyRacing` and
    `onDeck` subscriptions both read through it, so the wall displays cannot
    disagree with each other about where the race is up to. The rule itself
    is `domain.running_order.execution_sort_key` — `(round_number,
    heat_number)` for every race with `master_running_order` off, and the
    interleaved `heat_number` sequence (championship rounds after every
    general round) once it is on.

    Not a change to :func:`get_heats`, deliberately: that function feeds the
    schedule readers — the heat sheet, `applyMasterRunningOrder` itself, the
    stats — where round-then-heat is the shape a *schedule* has, and only the
    execution surfaces ask about the running order.

    A run-off heat (#550) is included here — not through
    `models.official_heats`, which excludes it along with every other
    non-`OFFICIAL` kind, but by name — because the audience is meant to see
    it: `onDeck`/`currentlyRacing` are what tell the wall displays a run-off
    is what is happening right now. It sorts immediately after every heat of
    the round it settles (or after every round, if it settles the race's
    overall standings) via the two sentinels above; `heat.round` is `None`
    for it, so it cannot use `heat.round.round_number` the way an official
    heat's key does below.
    """
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    master = bool(race is not None and race.master_running_order)
    heats = models.scheduled_or_run_off_heats(
        db.query(models.Heat).filter(models.Heat.race_id == race_id)
    ).all()

    def _key(heat: models.Heat) -> tuple[int, int, int]:
        if heat.kind == models.HeatKind.RUN_OFF:
            settles = heat.settles_round
            return running_order.execution_sort_key(
                round_number=settles.round_number
                if settles
                else _RUN_OFF_NO_ROUND_NUMBER,
                heat_number=_RUN_OFF_HEAT_NUMBER + heat.id,
                is_championship=(settles.advancement_source is not None)
                if settles
                else True,
                master_order=master,
            )
        round_obj = heat.round
        assert round_obj is not None  # official heats always belong to a round (#6)
        return running_order.execution_sort_key(
            round_number=round_obj.round_number,
            heat_number=heat.heat_number,
            is_championship=round_obj.advancement_source is not None,
            master_order=master,
        )

    return sorted(heats, key=_key)


def get_rounds(db: Session, race_id: int) -> list[models.Round]:
    """Get all rounds for a specific race, ordered by round number."""
    return (
        db.query(models.Round)
        .filter(models.Round.race_id == race_id)
        .order_by(models.Round.round_number)
        .all()
    )


def default_general_round_name(db: Session, race: models.Race) -> str:
    """The default title for a general round — not elimination, not balanced
    (#533).

    Derived from the resolved terminology at *creation* time: "All " plus the
    organization's own singular word, layered race-over-organization-over-the
    built-in Scouting words exactly as `Race.terminology` resolves it for
    display elsewhere. A default install's organization word is "Pack", so
    this reads exactly "All Pack" — unchanged from the literal it replaces,
    and what every existing row, the functional suite and the doc screenshots
    already assume.

    `Round.name` stays a plain stored column: an operator's rename must
    survive, so this only supplies what goes in it when nobody typed one.
    Renaming the vocabulary afterwards does not retitle a round already
    created — weaker than the standings/awards/track-records "computed on
    every read" rule, and deliberately so: a round's name is something a
    person types over, not a number that has to keep agreeing with a
    correction made after the fact.
    """
    organization = get_organization(db, race.organization_id)
    resolved = terminology.resolve_terminology(
        organization=terminology.overrides_from_row(organization)
        if organization is not None
        else None,
        race=terminology.overrides_from_row(race),
    )
    return f"All {resolved.organization_singular}"


def create_round(
    db: Session,
    race_id: int,
    round_number: int,
    scheduling_strategy: models.SchedulingStrategy = models.SchedulingStrategy.PPC,
    name: str | None = None,
    advancement_source: str | None = None,
    advancement_num_racers: int | None = None,
    racing_group_id: int | None = None,
    advancement_from_bottom: bool = False,
    elimination_losses: int | None = None,
    balanced_phases: int | None = None,
) -> models.Round:
    """Create a new round for a race."""
    round_obj = models.Round(
        race_id=race_id,
        round_number=round_number,
        scheduling_strategy=scheduling_strategy,
        name=name,
        advancement_source=advancement_source,
        advancement_num_racers=advancement_num_racers,
        racing_group_id=racing_group_id,
        advancement_from_bottom=advancement_from_bottom,
        elimination_losses=elimination_losses,
        balanced_phases=balanced_phases,
    )
    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    return round_obj


def delete_round(db: Session, round_id: int) -> bool:
    """Delete a round and all its heats. Only if no heats have results."""
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if round_obj:
        for heat_lanes in lanes_for_heats(db, round_obj.heats):
            if lanes.has_results(heat_lanes):
                raise ValueError("Cannot delete round: it has heats with results.")

        # Rule 2: Cannot delete general round if championship rounds are scheduled
        if not round_obj.advancement_source:
            champ_rounds = (
                db.query(models.Round)
                .filter(
                    models.Round.race_id == round_obj.race_id,
                    models.Round.advancement_source.is_not(None),
                    models.Round.advancement_source != "",
                )
                .first()
            )
            if champ_rounds:
                raise ValueError("Cannot delete round: championship rounds scheduled.")
        db.delete(round_obj)
        db.commit()
        return True
    return False


def delete_heat(db: Session, heat_id: int) -> bool:
    """Delete a heat. Only if it hasn't been run."""
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if heat:
        if lanes.has_results(heat_lanes_of(db, heat)):
            raise ValueError("Cannot delete heat: it has results.")

        round_id = heat.round_id
        db.delete(heat)
        db.flush()

        # Renumber remaining heats in the same round
        remaining_heats = (
            db.query(models.Heat)
            .filter(models.Heat.round_id == round_id)
            .order_by(models.Heat.heat_number)
            .all()
        )
        for i, h in enumerate(remaining_heats):
            h.heat_number = i + 1

        db.commit()
        return True
    return False


def delete_free_race_heat(db: Session, heat_id: int) -> bool:
    """Delete a free race heat. Only if it hasn't been run."""
    heat = get_free_race_heat(db, heat_id)
    if heat:
        if lanes.has_results(heat_lanes_of(db, heat)):
            raise ValueError("Cannot delete free race heat: it has results.")
        db.delete(heat)
        db.commit()
        return True
    return False


def _schedule_rng(
    db: Session, race_id: int, round_id: int, run: int = 0
) -> random.Random | None:
    """Where the shuffle comes from — ordinarily nowhere, so PPC makes its own.

    `domain.scheduling` takes an injectable generator and stays pure; reading
    the environment is I/O and belongs here. The key is the race's *name* and
    the round's number rather than their ids, which depend on how much was
    created before them. See `backend.demo_seed`.

    ``run`` distinguishes the runs of a multi-run round; without it a seeded
    two-run final would schedule the identical heats twice. Zero adds nothing
    to the key, so single-run rounds — every documentation screenshot — keep
    the schedules they already have.
    """
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    name = race.name if race else race_id
    number = round_obj.round_number if round_obj else round_id
    suffix = f":{run}" if run else ""
    return demo_seed.rng(f"schedule:{name}:{number}{suffix}")


def _generate_ppc(
    db: Session,
    race_id: int,
    round_id: int,
    p_ids: list[int],
    usable_lanes: Sequence[int],
    start_heat_num: int = 1,
    run: int = 0,
) -> list[models.Heat]:
    """Persist a PPC schedule for the given racers.

    The algorithm itself is :func:`backend.domain.scheduling.generate_ppc`; this
    is only the part that turns heat plans into rows.

    ``usable_lanes`` is which lanes, not how many (#171). ``run`` is which run
    of a multi-run round this is — it only varies the seeded shuffle.
    """
    plans = scheduling.generate_ppc(
        p_ids,
        usable_lanes,
        start_heat_number=start_heat_num,
        rng=_schedule_rng(db, race_id, round_id, run=run),
    )

    generated_heats: list[models.Heat] = []
    for plan in plans:
        # `plan.assignments`, never `enumerate(plan.lanes)`: the position of a
        # racer in the schedule is not their lane number once a lane is out of
        # service, and pairing them by index writes lane 4's racer into lane 3.
        lane_assignment = [
            lanes.from_participant(lane_number, participant_id)
            for lane_number, participant_id in plan.assignments
        ]
        heat = models.Heat(
            race_id=race_id,
            round_id=round_id,
            heat_number=plan.heat_number,
        )
        set_heat_lanes(heat, lane_assignment)
        db.add(heat)
        generated_heats.append(heat)
    return generated_heats


def _write_elimination_wave(
    db: Session,
    round_obj: models.Round,
    wave: list[list[int]],
    usable_lanes: Sequence[int],
    start_heat_num: int,
) -> list[models.Heat]:
    """Persist one wave of an elimination round as heat rows."""
    heats: list[models.Heat] = []
    for offset, group in enumerate(wave):
        heat = models.Heat(
            race_id=round_obj.race_id,
            round_id=round_obj.id,
            heat_number=start_heat_num + offset,
        )
        set_heat_lanes(
            heat,
            [
                lanes.Lane(lane=usable_lanes[position], racer_id=racer_id)
                for position, racer_id in enumerate(group)
            ],
        )
        db.add(heat)
        heats.append(heat)
    return heats


def extend_elimination_round(db: Session, round_id: int) -> list[models.Heat]:
    """Grow an elimination round by one wave, if its schedule has run out.

    Called from the recorded-result cascade, the same as advancement — and
    like advancement since #248, it asks about the state of the round *now*:
    losses are recomputed from every finished heat, so a corrected earlier
    result simply changes who the next wave holds. Nothing happens while any
    scheduled heat is still to be run, so an armed heat is never disturbed
    (#50) — waves are append-only.

    A racer who is no longer checked in is left out of the next wave, the
    same rule as advancement (#228): their recorded losses stand, but a lane
    in a heat yet to run never goes to a car that has left the building.
    """
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if (
        not round_obj
        or round_obj.scheduling_strategy != models.SchedulingStrategy.ELIMINATION
    ):
        return []

    heats = (
        db.query(models.Heat)
        .filter(models.Heat.round_id == round_id)
        .order_by(models.Heat.heat_number)
        .all()
    )
    if not heats:
        return []
    heat_lanes = lanes_for_heats(db, heats)
    if not all(lanes.is_finished(hl) for hl in heat_lanes):
        return []

    losses = elimination.losses_by_racer(heat_lanes)
    threshold = round_obj.elimination_losses or 1
    eligible = set(eligible_racer_ids(db, round_obj.race_id, round_obj.racing_group_id))
    losses = {r: c for r, c in losses.items() if r in eligible}
    if not elimination.is_decided(losses, threshold):
        # A latecomer joins the next wave at zero losses (#172's rule, in
        # this format's own terms) — but never a race that is already won:
        # checking in after the final heat must not restart it.
        for racer_id in eligible:
            losses.setdefault(racer_id, 0)

    usable = usable_lanes_for_race(db, round_obj.race_id)
    # `run` keys the seeded shuffle to the wave, so regenerating wave three
    # alone draws the same heats wave three drew beside the others.
    wave = elimination.next_wave(
        losses,
        threshold,
        len(usable),
        rng=_schedule_rng(db, round_obj.race_id, round_id, run=len(heats)),
    )
    if not wave:
        return []

    start = max(heat.heat_number for heat in heats) + 1
    new_heats = _write_elimination_wave(db, round_obj, wave, usable, start)
    db.commit()
    return new_heats


def _write_assignments(
    db: Session,
    round_obj: models.Round,
    phase: list[list[tuple[int, int]]],
    start_heat_num: int,
) -> list[models.Heat]:
    """Persist one phase of explicit ``(lane, racer)`` assignments."""
    heats: list[models.Heat] = []
    for offset, assignment in enumerate(phase):
        heat = models.Heat(
            race_id=round_obj.race_id,
            round_id=round_obj.id,
            heat_number=start_heat_num + offset,
        )
        set_heat_lanes(
            heat,
            [
                lanes.Lane(lane=lane_number, racer_id=racer_id)
                for lane_number, racer_id in assignment
            ],
        )
        db.add(heat)
        heats.append(heat)
    return heats


def extend_balanced_round(db: Session, round_id: int) -> list[models.Heat]:
    """Grow a balanced round by one phase, if its schedule has run out.

    The same cascade seam as `extend_elimination_round`, and the same
    state-not-event reasoning (#248): the next phase's matchmaking is drawn
    from the records as they stand, so a corrected result changes who races
    whom next rather than stranding anything. Phases are append-only (#50).

    A latecomer is fielded in the next phase — at the bottom of the order,
    since an unknown record is not a leading one — and their arrival marks
    the round ``disrupted`` (#172): they have raced fewer heats than
    everyone else, which a POINTS sum mistakes for a better score. The round
    stops growing once anyone has raced ``Round.balanced_phases`` phases.
    """
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if (
        not round_obj
        or round_obj.scheduling_strategy != models.SchedulingStrategy.BALANCED
    ):
        return []

    heats = (
        db.query(models.Heat)
        .filter(models.Heat.round_id == round_id)
        .order_by(models.Heat.heat_number)
        .all()
    )
    if not heats:
        return []
    heat_lanes = lanes_for_heats(db, heats)
    if not all(lanes.is_finished(hl) for hl in heat_lanes):
        return []

    usable = usable_lanes_for_race(db, round_obj.race_id)
    target = round_obj.balanced_phases or len(usable) or 1
    apps = balanced.appearances(heat_lanes)
    if apps and max(apps.values()) >= target:
        return []

    eligible = set(eligible_racer_ids(db, round_obj.race_id, round_obj.racing_group_id))
    if len(eligible) < 2:
        return []
    recs = balanced.records(heat_lanes)
    ordered = balanced.performance_order(
        recs.get(racer_id, balanced.Record(racer_id=racer_id)) for racer_id in eligible
    )

    rng = (
        _schedule_rng(db, round_obj.race_id, round_id, run=len(heats))
        or random.Random()
    )
    phase = balanced.next_phase(
        ordered, balanced.lane_uses_of(heat_lanes), usable, rng=rng
    )
    if not phase:
        return []

    # Somebody in this phase missed earlier ones — a latecomer. Their heat
    # count will stay short of everyone else's, which is #172's unevenness.
    most = max(apps.values()) if apps else 0
    if most and any(apps.get(racer_id, 0) < most for racer_id in ordered):
        round_obj.disrupted = True

    start = max(heat.heat_number for heat in heats) + 1
    new_heats = _write_assignments(db, round_obj, phase, start)
    db.commit()
    return new_heats


def _participant_ids_for_round(
    db: Session,
    round_obj: models.Round,
    num_placeholders: int,
    racer_ids: list[int] | None,
) -> list[int]:
    """Decide who is in the field for a round about to be scheduled.

    Four cases, in priority order: explicit placeholders, an explicit racer
    list, a championship round falling back to its already-advanced racers or
    fresh placeholders, and otherwise the checked-in roster (the whole race,
    or one racing group). Reads nothing but its own arguments, so it says nothing about
    *when* it runs relative to clearing existing heats — that ordering is
    ``generate_heats_for_round``'s to keep.
    """
    if num_placeholders > 0:
        return scheduling.placeholder_ids(num_placeholders)
    if racer_ids is not None:
        return racer_ids
    if round_obj.advancement_source:
        # Championship round without explicit racer_ids/placeholders:
        # Use existing racers if advanced, otherwise use placeholders.
        current_racers = set()
        for h_lanes in lanes_for_heats(db, round_obj.heats):
            current_racers.update(lanes.real_racer_ids(h_lanes))
        if current_racers:
            # Sorted because set iteration order is not a promise, and the
            # PPC shuffle downstream may be seeded (`demo_seed`).
            return sorted(current_racers)
        return scheduling.placeholder_ids(round_obj.total_participants)

    query = db.query(models.Racer).filter(
        models.Racer.race_id == round_obj.race_id, models.Racer.car_passed_inspection
    )
    if round_obj.racing_group_id:
        query = query.filter(models.Racer.racing_group_id == round_obj.racing_group_id)
    # Ordered because the PPC shuffle downstream may be seeded (`demo_seed`),
    # and it is only as repeatable as its input order.
    racers = query.order_by(models.Racer.id).all()
    if not racers or len(racers) < 2:
        raise ValueError(
            "Not enough racers to generate a schedule (minimum 2 required)"
        )
    return [r.id for r in racers]


def generate_heats_for_round(
    db: Session,
    round_id: int,
    num_placeholders: int = 0,
    racer_ids: list[int] | None = None,
    clear_existing: bool = True,
    runs: int | None = None,
) -> list[models.Heat]:
    """
    Generate heats for a specific round based on its scheduling strategy.
    Supports regeneration if no heats in the round have started.

    If num_placeholders is > 0, it generates heats for that many "placeholder"
    racers (using negative IDs -1, -2, etc.).

    If racer_ids is provided, it uses those specific racers instead of all
    racers in the race.

    If clear_existing is True, it will delete existing heats in the round.

    ``runs`` is how many runs per lane to schedule. ``None`` — the default and
    what every rebuild path passes — means **preserve what the round had**,
    derived from the heats about to be cleared: PPC makes one heat per
    participant per run, so the run count is the heat count over the field
    size (#230). The derivation lives here rather than in callers because it
    used to live in exactly one of them (``regenerateRound``, from #143) while
    ``invalidate_future_rounds`` and ``populate_round_field`` had nothing —
    so a two-run final quietly became a one-run final the moment any prelim
    result was recorded. A fresh round derives 1.
    """
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        raise ValueError(f"Round {round_id} not found")

    race_id = round_obj.race_id
    usable_lanes = usable_lanes_for_race(db, race_id)

    # Check for existing heats
    existing_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    )
    if runs is None:
        # Derived before anything is deleted, and from the heats themselves
        # rather than `Round.total_participants` — that property is the
        # round's *requested* field size, and for a championship round whose
        # field came up short of the request (#48) the two disagree: the
        # heats were generated for the actual field, not the request, and
        # dividing by the request is how a short-field multi-run final
        # collapsed to one run on the next prelim correction (#311). Floor
        # division, so a round that was never a clean multiple (a lane
        # outage mid-round, say) errs toward fewer runs rather than inventing
        # heats nobody scheduled.
        participants = advancement.scheduled_participant_count(
            lanes_for_heats(db, existing_heats)
        )
        if clear_existing and existing_heats and participants > 0:
            runs = max(1, len(existing_heats) // participants)
        else:
            runs = 1
    cleared = False
    if existing_heats and clear_existing:
        if not advancement.may_rebuild(lanes_for_heats(db, existing_heats)):
            raise ValueError(
                "Cannot regenerate round: some heats already have results."
            )

        # Safe to delete
        for h in existing_heats:
            db.delete(h)
        db.flush()  # Ensure deletions are reflected before new generation
        cleared = True

    p_ids = _participant_ids_for_round(db, round_obj, num_placeholders, racer_ids)

    # Continue numbering after heats that are still there ("stacking"), but
    # start again at 1 for heats we just deleted. `existing_heats` is the list
    # from *before* the delete, so testing it alone renumbered a regenerated
    # round to 5..8 instead of 1..4 — and left a gap in the race's numbering.
    start_heat_num = len(existing_heats) + 1 if existing_heats and not cleared else 1

    if round_obj.scheduling_strategy == models.SchedulingStrategy.ELIMINATION:
        # Only the first wave is scheduled here — everyone on zero losses.
        # The rest of the schedule does not exist yet by design: each later
        # wave is drawn from the losses as they stand, by
        # `extend_elimination_round` on the recorded-result cascade.
        wave = elimination.next_wave(
            dict.fromkeys(p_ids, 0),
            round_obj.elimination_losses or 1,
            len(usable_lanes),
            rng=_schedule_rng(db, race_id, round_id),
        )
        wave_heats = _write_elimination_wave(
            db, round_obj, wave, usable_lanes, start_heat_num
        )
        db.commit()
        return wave_heats

    if round_obj.scheduling_strategy == models.SchedulingStrategy.BALANCED:
        # Only the first phase, and the first phase is random — there are no
        # records yet to match on. Later phases come from
        # `extend_balanced_round` on the recorded-result cascade.
        rng = _schedule_rng(db, race_id, round_id) or random.Random()
        shuffled = list(p_ids)
        rng.shuffle(shuffled)
        phase = balanced.next_phase(shuffled, {}, usable_lanes, rng=rng)
        phase_heats = _write_assignments(db, round_obj, phase, start_heat_num)
        db.commit()
        return phase_heats

    # Generate heats using PPC strategy, once per run. Each run gets its own
    # schedule — `run` varies the shuffle — and the numbering continues.
    new_heats: list[models.Heat] = []
    for run in range(runs):
        new_heats += _generate_ppc(
            db,
            race_id,
            round_id,
            p_ids,
            usable_lanes,
            start_heat_num=start_heat_num + len(new_heats),
            run=run,
        )

    db.commit()
    return new_heats


def resolve_round_placeholders(db: Session, round_id: int, racer_ids: list[int]):
    """Fill a championship round's placeholder slots with the racers who advanced.

    Slot ``-1`` becomes ``racer_ids[0]``, ``-2`` becomes ``racer_ids[1]``, and
    so on; see :func:`backend.domain.lanes.resolve_placeholders`.
    """
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()

    for heat, heat_lanes in zip(heats, lanes_for_heats(db, heats), strict=True):
        if lanes.resolve_placeholders(heat_lanes, racer_ids):
            set_heat_lanes(heat, heat_lanes)

    db.commit()


def populate_round_field(db: Session, round_id: int, racer_ids: list[int]) -> None:
    """Put the racers who qualified into a championship round.

    Usually that means filling the placeholder slots in place. But
    ``advancement_num_racers`` is a *request* — "top four" — and a racing group of three
    cannot supply it, so a round can hold more slots than the race can ever
    fill. Those surplus slots are not untidy, they are fatal: ``phase`` reports
    ``NOT_READY`` while any placeholder remains and the operator screen has no
    controls in that state (#48). So when the field is short, the round is
    rebuilt for the racers that actually qualified.

    A round that has **already been raced** is filled in place regardless. A
    stale field the operator can see and fix beats silently wiping heats people
    ran — the same rule ``invalidate_future_rounds`` follows.
    """
    if not racer_ids:
        return

    round_lanes = _round_heat_lanes(db, round_id)
    short = advancement.field_is_short(round_lanes, len(racer_ids))
    if short and advancement.may_rebuild(round_lanes):
        generate_heats_for_round(db, round_id, racer_ids=racer_ids, clear_existing=True)
    else:
        resolve_round_placeholders(db, round_id, racer_ids)


def _round_heat_lanes(db: Session, round_id: int) -> list[list[lanes.Lane]]:
    """Lanes for every heat in a round, read from ``heat_lanes`` (#72).

    The choke point for three domain rules — ``is_round_complete``,
    ``field_is_short`` and ``may_rebuild`` — so moving it moves all three.

    Two queries rather than one join, deliberately. A join from ``heat_lanes``
    would drop any heat with no lane rows; parsing gave it ``[]`` and kept it
    in the list. ``is_round_complete`` reaches the same answer either way, but
    the other two reason about the *number* of heats, so a heat quietly
    dropping out changes what they decide.
    """
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    return lanes_for_heats(db, heats)


def lanes_for_heats(
    db: Session, heats: Sequence[models.Heat]
) -> list[list[lanes.Lane]]:
    """Lanes for each of ``heats``, in the order given, from ``heat_lanes``.

    One query for all of them, so a caller that already has the heats does not
    pay per heat — which is what `test_query_counts.py` is there to hold.

    A heat with no lane rows comes back as ``[]`` rather than disappearing. See
    :func:`_round_heat_lanes` for why that matters.
    """
    if not heats:
        return []

    rows = (
        db.query(models.HeatLane)
        .filter(models.HeatLane.heat_id.in_([h.id for h in heats]))
        .order_by(models.HeatLane.heat_id, models.HeatLane.lane)
        .all()
    )

    by_heat: dict[int, list[lanes.Lane]] = {h.id: [] for h in heats}
    for row in rows:
        by_heat[row.heat_id].append(lane_from_row(row))
    return [by_heat[h.id] for h in heats]


def heat_lanes_of(db: Session, heat: models.Heat) -> list[lanes.Lane]:
    """One heat's lanes. For callers that hold exactly one and cannot N+1."""
    return lanes_for_heats(db, [heat])[0]


def lane_from_row(row: models.HeatLane) -> lanes.Lane:
    return lanes.from_parts(
        lane=row.lane,
        racer_id=row.racer_id,
        placeholder_slot=row.placeholder_slot,
        time_seconds=row.time_seconds,
        place=row.place,
        skipped=row.skipped,
    )


def round_field_size(db: Session, round_obj: models.Round) -> int:
    """How many placeholder slots this championship round needs (#52).

    The rule is :func:`backend.domain.advancement.field_size`; this is the I/O
    around it — a ``EACH_GROUP`` round needs its racer count multiplied by the number
    of racing groups, so somebody has to count the racing groups.

    A round with no ``advancement_source`` is a preliminary round: its field is
    the roster rather than a number of slots, so it needs none. Every caller
    passes a championship round, and the answer was already 0 for a prelim by
    way of ``num_racers`` being null — this says so rather than arriving there.
    """
    source = round_obj.advancement_source
    if source is None:
        return 0

    rule = advancement.AdvancementRule(
        source=source,
        num_racers=round_obj.advancement_num_racers,
    )
    racing_group_count = 0
    if source == advancement.EACH_GROUP:
        racing_group_count = (
            db.query(models.RacingGroup)
            .filter(models.RacingGroup.race_id == round_obj.race_id)
            .count()
        )
    return advancement.field_size(rule, racing_group_count)


def lane_count_for_race(db: Session, race_id: int) -> int:
    """Lanes on the race's track, or four if it has none."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    return race.track.lane_count if race and race.track else 4


def lane_outages_for_track(db: Session, track_id: int) -> list[int]:
    """Lanes of this track that are out of service, in order (#171)."""
    rows = (
        db.query(models.LaneOutage)
        .filter(models.LaneOutage.track_id == track_id)
        .order_by(models.LaneOutage.lane)
        .all()
    )
    return [row.lane for row in rows]


def set_lane_outages(db: Session, track_id: int, lanes: Sequence[int]) -> list[int]:
    """Record exactly which of a track's lanes are out of service.

    Takes the whole set rather than one lane at a time, because that is what the
    operator screen has: a row of checkboxes, submitted together. A lane that
    has come back is simply absent from the list.

    Lanes outside ``1..lane_count`` are dropped rather than stored. A stale
    outage on lane 6 of a track that has been reconfigured to four lanes would
    never be visible to un-set, and would silently shrink nothing.
    """
    track = db.query(models.Track).filter(models.Track.id == track_id).first()
    if track is None:
        return []

    wanted = {lane for lane in lanes if 1 <= lane <= track.lane_count}

    existing = (
        db.query(models.LaneOutage).filter(models.LaneOutage.track_id == track_id).all()
    )
    for row in existing:
        if row.lane not in wanted:
            db.delete(row)
    already = {row.lane for row in existing}
    for lane in sorted(wanted - already):
        db.add(models.LaneOutage(track_id=track_id, lane=lane))

    db.commit()
    return sorted(wanted)


def historical_track_records(
    db: Session, track_id: int
) -> list[models.HistoricalTrackRecord]:
    """A track's hand-entered records, best first — the management view."""
    return (
        db.query(models.HistoricalTrackRecord)
        .filter(models.HistoricalTrackRecord.track_id == track_id)
        .order_by(
            models.HistoricalTrackRecord.time_seconds,
            models.HistoricalTrackRecord.id,
        )
        .all()
    )


def create_historical_track_record(
    db: Session, track_id: int, record: schemas.HistoricalTrackRecordCreate
) -> models.HistoricalTrackRecord | None:
    """Store a record from before Trusty Track was keeping them.

    Returns None for a track that does not exist — the enforced foreign key
    would refuse the row anyway (#125), but a None the resolver can turn
    into a sentence beats an IntegrityError.
    """
    track = db.query(models.Track).filter(models.Track.id == track_id).first()
    if track is None:
        return None
    row = models.HistoricalTrackRecord(track_id=track_id, **record.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_historical_track_record(
    db: Session, record_id: int, record: schemas.HistoricalTrackRecordCreate
) -> models.HistoricalTrackRecord | None:
    """Correct a hand-entered record — a typo in a time or a name."""
    row = (
        db.query(models.HistoricalTrackRecord)
        .filter(models.HistoricalTrackRecord.id == record_id)
        .first()
    )
    if row is None:
        return None
    for field, value in record.model_dump().items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


def delete_historical_track_record(db: Session, record_id: int) -> bool:
    """Remove a hand-entered record."""
    row = (
        db.query(models.HistoricalTrackRecord)
        .filter(models.HistoricalTrackRecord.id == record_id)
        .first()
    )
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def apply_outages_to_scheduled_heats(db: Session, track_id: int) -> list[int]:
    """Bring existing heats into line with a track's usable lanes shrinking.

    Two callers, one rule: a lane marked out of service (#171) and a track's
    `lane_count` being turned down (#325) both leave `usable_lanes_for_race`
    reporting fewer lanes than an existing schedule was built for. Reading
    *that* rather than the `LaneOutage` rows directly is what lets one
    function cover both — a shrunk `lane_count` adds no outage row for this
    to notice otherwise.

    Returns the ids of rounds that were disrupted — those already under way.

    Three cases, and the difference between them is what has already been run:

    **A round nobody has raced** is regenerated for the lanes that remain. It is
    the clean outcome: everybody gets an equal, valid schedule, and no result is
    at risk because there is none.

    **A round part-way through** keeps its recorded heats exactly as they are —
    those cars ran, on lanes that worked — and has the dead lane vacated from
    the heats still to come. The racers in those lanes lose an appearance,
    which is what `Round.disrupted` records and what stops it counting toward
    `POINTS` standings.

    **A round already finished** is untouched. Nothing in it is going to be run
    again, so nothing needs changing.

    Free race heats are skipped: an exhibition run is not scheduled, not scored,
    and the operator picks its lanes when they start it.
    """
    disrupted_round_ids: list[int] = []
    races = db.query(models.Race).filter(models.Race.track_id == track_id).all()
    # Heats a full regeneration below creates, by race and then by round —
    # repaired into each race's master running order (#549, stage 3) once
    # every race on this track has been brought into line. The vacate branch
    # never lands here: it keeps every heat's id and heat_number, so there is
    # nothing for a repair to fold in.
    new_heats_by_race: dict[int, dict[int, list[models.Heat]]] = {}

    for race in races:
        usable = set(usable_lanes_for_race(db, race.id))
        rounds = db.query(models.Round).filter(models.Round.race_id == race.id).all()

        for round_obj in rounds:
            heats = models.official_heats(
                db.query(models.Heat).filter(models.Heat.round_id == round_obj.id)
            ).all()
            if not heats:
                continue

            pending = [h for h in heats if not lanes.has_results(heat_lanes_of(db, h))]
            if not pending:
                # Every heat has been run; there is nothing left to re-lane.
                continue

            if len(pending) == len(heats):
                # Nothing raced yet, so rebuild it properly. `may_rebuild` is
                # satisfied by definition here — no heat holds a result.
                if usable:
                    rebuilt = generate_heats_for_round(
                        db, round_obj.id, clear_existing=True
                    )
                    new_heats_by_race.setdefault(race.id, {})[round_obj.id] = rebuilt
                continue

            vacated = False
            for heat in pending:
                current = heat_lanes_of(db, heat)
                if all(lane.lane in usable for lane in current):
                    continue
                set_heat_lanes(
                    heat,
                    [lane for lane in current if lane.lane in usable],
                )
                vacated = True

            if vacated and not round_obj.disrupted:
                round_obj.disrupted = True
                disrupted_round_ids.append(round_obj.id)

    db.commit()
    for race_id, new_heats_by_round in new_heats_by_race.items():
        repair_master_running_order(db, race_id, new_heats_by_round)
    return disrupted_round_ids


def admit_late_racers(db: Session, race_id: int) -> list[int]:
    """Put checked-in racers who are in no heat into the rounds already built (#172).

    Returns the ids of rounds that were disrupted admitting them.

    A child who arrives after the schedule was generated used to sit in the
    roster and in no heat, with nothing on screen saying why: ``may_rebuild``
    refuses to regenerate a round holding a result, and there was no other path.

    The three cases are the ones a lane going out of service already has, for
    the same reason — something changed about a round that is under way, and the
    recorded heats have to survive it:

    **A round nobody has raced** is regenerated with the newcomer in it, which
    is the outcome to prefer whenever it is available: everybody ends up with an
    equal schedule and nothing is at risk.

    **A round part-way through** keeps every recorded heat and gets heats
    appended, planned by :mod:`backend.domain.latecomers`. Whoever fills the
    other lanes of those heats runs more often than their peers, so the round is
    marked ``disrupted`` and drops out of ``POINTS`` standings exactly as a
    re-laned one does.

    **A round already finished** is left alone. Appending to it would be asking
    people to come back to a round they have finished; the newcomer joins from
    the next one.

    Only general rounds are considered. A championship field is drawn from the
    standings, so there is no sense in which a latecomer belongs in one — they
    become eligible for it by racing the preliminaries like everybody else.
    """
    rounds = (
        db.query(models.Round)
        .filter(
            models.Round.race_id == race_id,
            models.Round.advancement_source.is_(None),
        )
        .all()
    )
    if not rounds:
        return []

    usable = usable_lanes_for_race(db, race_id)
    disrupted_round_ids: list[int] = []
    # Heats this call creates, by round — repaired into the master running
    # order (#549, stage 3) after the loop, if the race wants one. Empty for
    # a call that admits nobody or only extends elimination/balanced rounds.
    new_heats_by_round: dict[int, list[models.Heat]] = {}

    for round_obj in rounds:
        heats = models.official_heats(
            db.query(models.Heat).filter(models.Heat.round_id == round_obj.id)
        ).all()
        if not heats:
            # Not generated yet; whenever it is, it will field whoever has
            # checked in by then.
            continue

        eligible = eligible_racer_ids(db, race_id, round_obj.racing_group_id)
        heat_lanes = lanes_for_heats(db, heats)
        already = {
            racer_id for heat in heat_lanes for racer_id in lanes.real_racer_ids(heat)
        }
        missing = [racer_id for racer_id in eligible if racer_id not in already]
        if not missing or not usable:
            continue

        if advancement.may_rebuild(heat_lanes):
            new_heats_by_round[round_obj.id] = generate_heats_for_round(
                db, round_obj.id, clear_existing=True
            )
            continue

        if advancement.is_round_complete(heat_lanes):
            continue

        if round_obj.scheduling_strategy in (
            models.SchedulingStrategy.ELIMINATION,
            models.SchedulingStrategy.BALANCED,
        ):
            # No lane-balance appendix here: these schedules grow on their
            # own, and the extenders field every checked-in racer they have
            # not seen — so the latecomer simply joins the next wave or
            # phase (which, for a balanced round, marks it disrupted).
            continue

        appended = latecomers.plan_late_entry(
            missing, sorted(already), usable, met=_met_counts(heat_lanes, missing)
        )
        if not appended:
            continue

        next_number = max(h.heat_number for h in heats) + 1
        new_heats: list[models.Heat] = []
        for offset, plan in enumerate(appended):
            heat = models.Heat(
                race_id=race_id,
                round_id=round_obj.id,
                heat_number=next_number + offset,
            )
            set_heat_lanes(
                heat,
                [
                    lanes.Lane(lane=lane, racer_id=racer_id)
                    for lane, racer_id in plan.assignments
                ],
            )
            db.add(heat)
            new_heats.append(heat)
        new_heats_by_round[round_obj.id] = new_heats

        if not round_obj.disrupted:
            round_obj.disrupted = True
            disrupted_round_ids.append(round_obj.id)

    db.commit()
    repair_master_running_order(db, race_id, new_heats_by_round)
    return disrupted_round_ids


def withdraw_absent_racers(db: Session, race_id: int) -> list[int]:
    """Take racers who are no longer checked in out of the racing to come (#228).

    The mirror of :func:`admit_late_racers`, with the same three cases and the
    same reason for them — a round already under way has to change, and the
    heats people ran must survive it:

    **A round nobody has raced** is regenerated without them, which is the
    outcome to prefer whenever it is available. The generator fields from
    checked-in racers, so the regeneration needs telling nothing.

    **A round part-way through** keeps every finished heat; the withdrawn
    racer's lanes in the *pending* ones are vacated, exactly as a dead lane's
    are (#171). Nobody else's schedule changes — an absent car empties a lane,
    it does not add runs — so unlike admission this sets no ``disrupted`` flag.

    **A round already finished** is untouched. Their recorded results stand;
    a withdrawal does not rewrite history.

    Championship rounds get one more case: an *unraced* one whose field names
    a withdrawn racer is reset to placeholders and re-advanced, so the next
    qualifier steps up rather than a lane racing empty in the final. A raced
    one is left alone, following the invalidation rule.

    Idempotent, like admission — it asks who is scheduled and should not be,
    so a mistaken un-check heals itself: re-checking the racer hands them
    straight back to ``admit_late_racers``.

    Returns the ids of rounds that were changed.
    """
    checked_in = {
        r.id
        for r in db.query(models.Racer)
        .filter(models.Racer.race_id == race_id, models.Racer.car_passed_inspection)
        .all()
    }
    usable = usable_lanes_for_race(db, race_id)
    changed_round_ids: list[int] = []

    rounds = db.query(models.Round).filter(models.Round.race_id == race_id).all()
    for round_obj in rounds:
        heats = models.official_heats(
            db.query(models.Heat).filter(models.Heat.round_id == round_obj.id)
        ).all()
        if not heats:
            continue
        heat_lanes = lanes_for_heats(db, heats)
        scheduled = {
            racer_id
            for lanes_ in heat_lanes
            for racer_id in lanes.real_racer_ids(lanes_)
        }
        withdrawn = scheduled - checked_in
        if not withdrawn:
            continue

        if round_obj.advancement_source is not None:
            # A championship field with a withdrawn racer in it: re-advance if
            # nothing has been raced, so the next qualifier steps up. The
            # local import matches `trigger_auto_advancements`; `services`
            # imports this module.
            if not advancement.may_rebuild(heat_lanes):
                continue
            from backend.services import scoring

            size = round_field_size(db, round_obj)
            if size <= 0:
                continue
            if not _reset_heats_in_place(
                db, round_obj.id, scheduling.placeholder_ids(size), usable
            ):
                generate_heats_for_round(
                    db, round_obj.id, num_placeholders=size, clear_existing=True
                )
            winner_ids = scoring.get_advancing_racers(
                db,
                race_id,
                round_obj.advancement_source,
                round_obj.advancement_num_racers,
                from_bottom=round_obj.advancement_from_bottom,
            )
            if winner_ids:
                populate_round_field(db, round_obj.id, winner_ids)
            changed_round_ids.append(round_obj.id)
            continue

        if advancement.may_rebuild(heat_lanes):
            eligible = eligible_racer_ids(db, race_id, round_obj.racing_group_id)
            if len(eligible) >= 2:
                generate_heats_for_round(db, round_obj.id, clear_existing=True)
                changed_round_ids.append(round_obj.id)
                continue
            # Too few checked-in racers left for a schedule; fall through and
            # vacate instead — an empty lane beats a ValueError at the desk.

        if advancement.is_round_complete(heat_lanes):
            continue

        vacated = False
        for heat, lanes_ in zip(heats, heat_lanes, strict=True):
            if lanes.is_finished(lanes_):
                continue  # they raced it, or it was skipped: history stands
            modified = False
            for lane in lanes_:
                if lane.racer_id in withdrawn:
                    lane.racer_id = None
                    lane.time = None
                    lane.place = None
                    modified = True
            if modified:
                set_heat_lanes(heat, lanes_)
                vacated = True
        if vacated:
            changed_round_ids.append(round_obj.id)

    db.commit()
    return changed_round_ids


def eligible_racer_ids(
    db: Session, race_id: int, racing_group_id: int | None
) -> list[int]:
    """Who a general round's field is drawn from — the same query the generator uses."""
    query = db.query(models.Racer).filter(
        models.Racer.race_id == race_id, models.Racer.car_passed_inspection
    )
    if racing_group_id:
        query = query.filter(models.Racer.racing_group_id == racing_group_id)
    return [racer.id for racer in query.all()]


def _met_counts(
    heat_lanes: Sequence[Sequence[lanes.Lane]], newcomers: Sequence[int]
) -> dict[int, dict[int, int]]:
    """How often each newcomer has already raced each other racer.

    Always zero on a first admission, and not always: a racer admitted late,
    then a second one arriving later still, has a history by then.
    """
    counts: dict[int, dict[int, int]] = {racer: {} for racer in newcomers}
    joining = set(newcomers)
    for heat in heat_lanes:
        racer_ids = lanes.real_racer_ids(heat)
        for racer_id in racer_ids:
            if racer_id not in joining:
                continue
            for other in racer_ids:
                if other != racer_id:
                    counts[racer_id][other] = counts[racer_id].get(other, 0) + 1
    return counts


def usable_lanes_for_race(db: Session, race_id: int) -> list[int]:
    """Which lanes a schedule for this race may use (#171).

    Every lane the track has, less any that are out of service. The one place
    that decides, so taking a lane out of service is a change here rather than
    at each of the four call sites — #48 is the standing reminder about a rule
    that reaches only some of the paths needing it.

    A race with no track gets four lanes, as it always has.
    """
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None or race.track is None:
        return [1, 2, 3, 4]

    # `race.track.id` rather than `race.track_id`: the same value, but the
    # checker can see this one is not None after the guard above.
    out_of_service = set(lane_outages_for_track(db, race.track.id))
    return [
        lane
        for lane in range(1, race.track.lane_count + 1)
        if lane not in out_of_service
    ]


def _reset_heats_in_place(
    db: Session, round_id: int, p_ids: list[int], usable_lanes: Sequence[int]
) -> bool:
    """Rewrite a round's existing heats instead of replacing the rows (#50).

    Deleting and inserting gives every heat a new id, and invalidation runs on
    *every* earlier result — so a heat the operator is looking at, or that the
    timer has armed, kept being swapped for a different row several times a
    round. Worse on SQLite, which hands the old rowid back when the deleted
    rows were the highest: the id then resolves to a heat holding a different
    field, which is how a run could be recorded against the wrong racers.

    The schedule for a given field size is deterministic, so when the shape has
    not changed the same rows can simply be rewritten. Returns False when the
    heat count differs and the caller has to regenerate properly.

    A multi-run round holds a whole number of runs' worth of heats, so the
    check is divisibility rather than equality (#230): a two-run final of two
    slots has four heats, and rewriting only when the count equalled *one*
    run's worth meant every invalidation fell through to full regeneration —
    which rebuilt a single run, collapsing the final the operator configured.
    """
    existing = sorted(
        db.query(models.Heat).filter(models.Heat.round_id == round_id).all(),
        key=lambda h: h.heat_number,
    )
    if not existing:
        return False

    plans = scheduling.generate_ppc(
        p_ids,
        usable_lanes,
        start_heat_number=1,
        rng=_schedule_rng(db, existing[0].race_id, round_id),
    )
    if not plans or len(existing) % len(plans) != 0:
        return False
    for run in range(1, len(existing) // len(plans)):
        plans += scheduling.generate_ppc(
            p_ids,
            usable_lanes,
            start_heat_number=len(plans) + 1,
            rng=_schedule_rng(db, existing[0].race_id, round_id, run=run),
        )

    for heat, plan in zip(existing, plans, strict=True):
        # Belt and braces: every path that creates a round numbers its heats
        # 1..N, and `existing` is sorted by that, so this is a no-op today.
        # Mutation-testing confirms nothing catches its removal. Kept because
        # the alternative is a silent mismatch between a heat's number and its
        # schedule if some other path ever numbers differently.
        heat.heat_number = plan.heat_number
        # Through the ORM, so `lane_sync` projects it into `heat_lanes`.
        set_heat_lanes(
            heat,
            [
                lanes.from_participant(lane_number, participant_id)
                for lane_number, participant_id in plan.assignments
            ],
        )
    db.commit()
    return True


def invalidate_future_rounds(db: Session, race_id: int, current_round_number: int):
    """Reset later championship rounds after a result in this one changes.

    A recorded — or cleared — result moves the standings those rounds were drawn
    from, so their fields go back to placeholders and get re-advanced. A later
    round that has already been raced is left alone; see the rule as written out
    in :mod:`backend.domain.advancement`.

    The reset rewrites the existing heats where it can, so their ids survive —
    see :func:`_reset_heats_in_place`.
    """
    all_rounds = db.query(models.Round).filter(models.Round.race_id == race_id).all()
    usable_lanes = usable_lanes_for_race(db, race_id)

    for r in advancement.rounds_to_invalidate(all_rounds, current_round_number):
        if not advancement.may_rebuild(_round_heat_lanes(db, r.id)):
            continue
        size = round_field_size(db, r)
        if size > 0 and _reset_heats_in_place(
            db, r.id, scheduling.placeholder_ids(size), usable_lanes
        ):
            continue
        generate_heats_for_round(
            db,
            r.id,
            num_placeholders=size,
            clear_existing=True,
        )


def is_round_complete(db: Session, round_id: int) -> bool:
    """True when every heat in the round has a time for every real racer.

    The growing strategies ask one thing more, because between their waves
    "every scheduled heat is finished" is true while the race is still going
    — treating that as complete would advance a championship field off it.
    An elimination round needs a winner to exist; a balanced round needs its
    configured phases to have been raced.
    """
    heat_lanes = _round_heat_lanes(db, round_id)
    if not advancement.is_round_complete(heat_lanes):
        return False
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if (
        round_obj
        and round_obj.scheduling_strategy == models.SchedulingStrategy.ELIMINATION
    ):
        # Filtered to who is still checked in, the same population
        # `extend_elimination_round` fields the next wave from (#313). A car
        # that never loses — every lane it holds is skipped, not raced — sits
        # at zero losses forever; withdrawing it is the operator's only way
        # out, and it must not go on counting as a second car still alive.
        losses = elimination.losses_by_racer(heat_lanes)
        eligible = set(
            eligible_racer_ids(db, round_obj.race_id, round_obj.racing_group_id)
        )
        losses = {
            racer_id: count
            for racer_id, count in losses.items()
            if racer_id in eligible
        }
        return elimination.is_decided(losses, round_obj.elimination_losses or 1)
    if (
        round_obj
        and round_obj.scheduling_strategy == models.SchedulingStrategy.BALANCED
    ):
        apps = balanced.appearances(heat_lanes)
        return bool(apps) and max(apps.values()) >= (round_obj.balanced_phases or 1)
    return True


def populate_round_if_decided(db: Session, round_obj: models.Round) -> bool:
    """Fill a championship round's field, if its source is decided *now*.

    The one place the population question is asked (#48's shape): the
    recorded-result cascade asks it for every later round, and round creation
    asks it for the round just made — a final added after the prelims finished
    has no completion event left to wait for (#248).
    """
    if not round_obj.advancement_source:
        return False

    rule = advancement.AdvancementRule(
        source=round_obj.advancement_source,
        num_racers=round_obj.advancement_num_racers,
        from_bottom=round_obj.advancement_from_bottom,
    )

    def prior_rounds_complete() -> bool:
        earlier = (
            db.query(models.Round)
            .filter(
                models.Round.race_id == round_obj.race_id,
                models.Round.round_number < round_obj.round_number,
            )
            .all()
        )
        return all(is_round_complete(db, pr.id) for pr in earlier)

    if not advancement.should_populate(
        rule,
        lambda source_id: is_round_complete(db, source_id),
        prior_rounds_complete,
    ):
        return False

    from backend.services import scoring

    winner_ids = scoring.get_advancing_racers(
        db,
        round_obj.race_id,
        round_obj.advancement_source,
        rule.num_racers,
        from_bottom=rule.from_bottom,
    )
    # Putting racers in adds no times, so the round is not complete
    # afterwards and there is nothing to cascade into.
    populate_round_field(db, round_obj.id, winner_ids)
    return True


def trigger_auto_advancements(db: Session, race_id: int, completed_round_id: int):
    """Fill in any championship round whose field is now decided."""
    if not is_round_complete(db, completed_round_id):
        return

    completed_round = (
        db.query(models.Round).filter(models.Round.id == completed_round_id).first()
    )
    if not completed_round:
        return

    all_rounds = (
        db.query(models.Round)
        .filter(models.Round.race_id == race_id)
        .order_by(models.Round.round_number)
        .all()
    )
    future_rounds = advancement.rounds_to_invalidate(
        all_rounds, completed_round.round_number
    )

    for r in future_rounds:
        populate_round_if_decided(db, r)


def set_heat_lanes(heat: models.Heat, heat_lanes: Sequence[lanes.Lane]) -> None:
    """Write a heat's lanes. The one door for them.

    Every write goes through here (#119), which is what let the direction
    change — and then the storage format go — in one place rather than nine.

    The staging is not ceremony. A heat that has just been constructed has no
    id until the session flushes, and the rows need one — so the values are
    left on the instance and ``lane_sync`` writes them when the id exists.
    """
    lane_sync.stage(heat, heat_lanes)


def validate_lane_replacement(
    db: Session, heat: models.Heat, heat_lanes: Sequence[lanes.Lane]
) -> str | None:
    """The first problem with replacing ``heat``'s lanes with ``heat_lanes``,
    or ``None`` if there isn't one (#307, extended by #524).

    ``updateHeatResult`` and ``recordFreeRaceResult`` replace a heat's whole
    lane set with whatever a client sends, and until now nothing checked it
    before it reached the table: an empty list wiped the schedule, a partial
    list dropped the lanes it omitted, and a nonexistent racer id surfaced as
    a raw ``sqlite3.IntegrityError``. This is the guard the armed-heat write
    path already had (``_record_results`` verifies the lane assignment it
    armed with) and the direct edit path did not.

    #490 gave a client its first way to send a *place* directly rather than
    one the server derived from a time, and nothing checked that number
    either: a negative one subtracts under ``POINTS``, where lower wins, and a
    duplicate or out-of-range one is silently wrong. Checked here for the
    same reason the lane-set checks are — this is the boundary a client's
    malformed input actually crosses.

    Every legitimate caller — the Edit Results modal, the skip button, the
    re-run clear, the timer's own write, the demo seed — builds its payload by
    reading the heat's *current* lanes and returning the same set back
    (`crud.heat_lanes_of`, echoed lane-for-lane), so requiring the sent set to
    match the stored one exactly costs nothing any of them do already. Only
    the operator's raw GraphQL call has no such guarantee, which is exactly
    what this closes.

    Not called from :func:`record_heat_result` or
    :func:`update_free_race_heat_result` themselves: both are also the
    timer's write path, running outside a request on its own session, and a
    validation failure there has nowhere useful to surface — the resolvers are
    the boundary a client's malformed input actually crosses.
    """
    if not heat_lanes:
        return "A heat's lanes cannot be empty."

    dupes = lanes.duplicate_lane_numbers(heat_lanes)
    if dupes:
        return f"Lane {dupes[0]} is assigned to more than one row."

    sent = {lane.lane for lane in heat_lanes}
    existing = {lane.lane for lane in heat_lanes_of(db, heat)}
    if sent != existing:
        missing = sorted(existing - sent)
        extra = sorted(sent - existing)
        detail = "; ".join(
            part
            for part in (
                f"missing lane(s) {missing}" if missing else "",
                f"unknown lane(s) {extra}" if extra else "",
            )
            if part
        )
        return f"The lanes sent don't match this heat's schedule ({detail})."

    racer_ids = {lane.racer_id for lane in heat_lanes if lane.racer_id is not None}
    if racer_ids:
        found = {
            row[0]
            for row in db.query(models.Racer.id).filter(
                models.Racer.race_id == heat.race_id,
                models.Racer.id.in_(racer_ids),
            )
        }
        missing_racers = racer_ids - found
        if missing_racers:
            return f"Racer {sorted(missing_racers)[0]} is not part of this heat's race."

    # A place has never been validated (#524). It cost nothing while a timer
    # supplied every one of them; #490 lets a person type one directly, and
    # `POINTS` sums places with lower winning, so a bad number here is not
    # merely wrong, it is a reward. Checked here, not in
    # `record_heat_result`/`update_free_race_heat_result` themselves, for the
    # same reason the checks above are: those two are also the timer's write
    # path, running outside a request with nowhere to surface a refusal, and
    # the timer only ever writes places it derived itself.
    below_one = lanes.places_below_one(heat_lanes)
    if below_one:
        return f"Lane {below_one[0]}'s place must be 1 or higher."

    above_field = lanes.places_above_field(heat_lanes)
    if above_field:
        field = len(lanes.real_racer_ids(heat_lanes))
        return (
            f"Lane {above_field[0]}'s place is higher than the {field} "
            "racer(s) in this heat."
        )

    dupe_places = lanes.duplicate_places(heat_lanes)
    if dupe_places:
        return f"Place {dupe_places[0]} is assigned to more than one lane."

    return None


def record_heat_result(
    db: Session,
    heat_id: int,
    heat_lanes: Sequence[lanes.Lane] | None,
    *,
    source: audit.ResultSource,
) -> models.Heat | None:
    """Store a heat's results and re-settle everything downstream of them.

    The cascade runs on *every* result, which is what keeps championship fields
    correct when the operator re-runs a heat mid-round. It is also why this is
    not a plain setter — see issue #8's note about side effects, and issue #7,
    which proposes an explicit session object to own this instead.

    Takes lanes, not a serialized blob. It was the last lane-carrying signature
    in the codebase that spoke the storage format instead of the value, which
    made every caller serialize before calling and left #72 with one more shape
    to change.

    ``source`` is required, and it is keyword-only so it cannot be supplied by
    accident (#219). Results arrive here by two routes — the timer, through its
    own session and outside any request, and a person typing into the override
    box — and only the second is a GraphQL mutation. An audit log built on the
    mutation seam alone therefore records every *correction* to a time and
    never the time it corrected, which is precisely backwards for the dispute
    it exists to settle. Making the argument mandatory is the #48 lesson: a
    rule that depends on each caller remembering reaches only some of them.
    """
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if heat and heat_lanes is not None:
        set_heat_lanes(heat, heat_lanes)
        stamp_recorded(heat, heat_lanes)
        db.commit()
        db.refresh(heat)

        if heat.round:
            invalidate_future_rounds(db, heat.race_id, heat.round.round_number)
            # Before advancement asks whether the round is complete: a round
            # whose schedule grows on results is only complete when its story
            # has ended, and extending it first keeps the two questions from
            # racing each other.
            extend_elimination_round(db, heat.round.id)
            extend_balanced_round(db, heat.round.id)
            trigger_auto_advancements(db, heat.race_id, heat.round.id)

        _record_result_audit(db, heat, heat_lanes, source)

    return heat


def _record_result_audit(
    db: Session,
    heat: models.Heat,
    heat_lanes: Sequence[lanes.Lane],
    source: audit.ResultSource,
) -> None:
    """One audit entry for a recorded heat, whichever route it came by.

    The times themselves are not copied in: they are in ``heat_lanes``, which
    is the record, and duplicating them here would make the log a second and
    divergeable copy of the results. What the entry carries is enough to find
    the heat and to know how the numbers got there.
    """
    timed = [lane for lane in heat_lanes if lane.time is not None]
    record_audit(
        db,
        "heatResultRecorded",
        role=(
            audit.ActorRole.SYSTEM.value
            if source is audit.ResultSource.TIMER
            else audit.ActorRole.OPERATOR.value
        ),
        race_id=heat.race_id,
        details={
            "source": source.value,
            "heatId": heat.id,
            "heatNumber": heat.heat_number,
            "lanesTimed": len(timed),
            "skipped": all(lane.skipped for lane in heat_lanes)
            if heat_lanes
            else False,
        },
    )


def auto_number_racers(
    db: Session, race_id: int, racer_ids: list[int] | None = None
) -> int:
    """Assign car numbers to a race's racers, or to just the ones named.

    ``racer_ids`` was annotated ``list[int | None]`` with a default of ``None``
    — the optionality had been written one level too deep, so the signature
    said "a list that may contain nothing" and meant "no list". Both callers
    pass either a `list[int]` or nothing at all.
    """
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        return 0

    query = db.query(models.Racer).filter(models.Racer.race_id == race_id)
    if racer_ids is not None:
        query = query.filter(models.Racer.id.in_(racer_ids))

    racers = query.all()
    if not racers:
        return 0

    updated_count = 0

    if race.car_numbering_strategy == models.CarNumberingStrategy.GLOBAL:
        # Sort by ID to ensure stable ordering, or last name? Let's do ID (entry order)
        # Or maybe sort by Last Name, First Name
        racers.sort(key=lambda r: (r.last_name, r.first_name))

        current_number = race.global_start_number or 1
        for racer in racers:
            racer.car_number = current_number
            current_number += 1
            updated_count += 1

    elif race.car_numbering_strategy == models.CarNumberingStrategy.PER_GROUP:
        # Organization racers by RacingGroup
        # We need to get all racing groups for this race to know ranges
        racing_groups = (
            db.query(models.RacingGroup)
            .filter(models.RacingGroup.race_id == race_id)
            .all()
        )
        racing_group_map = {d.id: d for d in racing_groups}

        # Pre-bucket racers
        racing_group_racers: dict[int, list[models.Racer]] = {}
        unassigned_racers: list[models.Racer] = []

        for racer in racers:
            if racer.racing_group_id:
                if racer.racing_group_id not in racing_group_racers:
                    racing_group_racers[racer.racing_group_id] = []
                racing_group_racers[racer.racing_group_id].append(racer)
            else:
                unassigned_racers.append(racer)

        # Assign numbers per RacingGroup
        for racing_group_id, group_racers in racing_group_racers.items():
            racing_group = racing_group_map.get(racing_group_id)
            if not racing_group or racing_group.car_number_range_start is None:
                continue  # Skip if no config

            # Sort
            group_racers.sort(key=lambda r: (r.last_name, r.first_name))

            current = racing_group.car_number_range_start
            limit = racing_group.car_number_range_end

            for racer in group_racers:
                if limit and current > limit:
                    break  # Stop assigning if out of range? Or just keep going?
                    # Let's stop to respect the "end" concept, user can fix.

                racer.car_number = current
                current += 1
                updated_count += 1

    else:
        # MANUAL or Unset - do nothing
        return 0

    db.commit()
    return updated_count


def _write_heat_numbers(db: Session, update_map: dict[int, int]) -> list[models.Heat]:
    """Write ``heat_number`` for a set of heats and commit. The one door.

    Shared by :func:`reorder_heats` (one round, an operator's drag) and
    :func:`apply_master_running_order` (several rounds, a generated order) —
    both ultimately do the same thing: point ``Heat.heat_number``, the
    running order, at new values and persist them. Neither writes a heat row
    a second way; the difference between the two callers is entirely in what
    they are allowed to reorder, checked before this is reached.
    """
    from fastapi import HTTPException

    if not update_map:
        return []

    heats = db.query(models.Heat).filter(models.Heat.id.in_(update_map.keys())).all()
    if len(heats) != len(update_map):
        raise HTTPException(status_code=404, detail="One or more heat IDs not found")

    for heat in heats:
        heat.heat_number = update_map[heat.id]

    db.commit()

    for heat in heats:
        db.refresh(heat)

    return sorted(heats, key=lambda h: h.heat_number)


def reorder_heats(db: Session, heat_updates: list[dict]) -> list[models.Heat]:
    """
    Reorder heats within a round by updating their heat_number.

    Args:
        db: Database session
        heat_updates: List of dicts with 'heat_id' and 'new_heat_number'

    Returns:
        List of updated Heat objects

    Raises:
        HTTPException: If heats belong to different rounds or heat IDs are invalid
    """
    from fastapi import HTTPException

    if not heat_updates:
        return []

    # Fetch all heats by ID up front, only to check they share a round — the
    # drag-and-drop schedule screen reorders within one round at a time, and
    # this is the one caller that enforces that. `apply_master_running_order`
    # deliberately does not, since spanning rounds is the whole point of it.
    heat_ids = [update["heat_id"] for update in heat_updates]
    heats = db.query(models.Heat).filter(models.Heat.id.in_(heat_ids)).all()

    if len(heats) != len(heat_ids):
        raise HTTPException(status_code=404, detail="One or more heat IDs not found")

    round_ids = {heat.round_id for heat in heats}
    if len(round_ids) > 1:
        raise HTTPException(
            status_code=400, detail="Cannot reorder heats from different rounds"
        )

    update_map = {
        update["heat_id"]: update["new_heat_number"] for update in heat_updates
    }
    return _write_heat_numbers(db, update_map)


def apply_master_running_order(db: Session, race_id: int) -> list[models.Heat]:
    """Interleave every current round's *pending* heats into one running order.

    "Pending" is exactly `recorded_at is None` (#59) — a heat's spot in
    history is `recorded_at`, and that stays untouched. A recorded heat's own
    `heat_number` is therefore never rewritten here: an announcer who has
    already called heat 6 must find heat 6 unchanged.

    Each round contributes its own pending heats, in their existing order, as
    one `running_order.GroupSchedule` — `domain/running_order.py` decides how
    to weave the rounds together, not this function. `round.id` breaks ties
    between rounds whose credit comes out equal (see `interleave`'s
    docstring); it means nothing else here.

    New numbers are written through `_write_heat_numbers`, the same door
    `reorder_heats` uses, starting one past the highest `heat_number` this
    race has anywhere — recorded or pending, in every round — so a
    newly-assigned number can never collide with a heat that already has a
    place in some round's own history.

    Championship rounds are left out of the weave entirely. Their field is
    drawn from the general rounds' standings, so they cannot meaningfully run
    before those finish — and `_reset_heats_in_place` renumbers a
    championship round's heats 1..N on every rebuild, so a master number
    written onto one would not survive the first preliminary result recorded
    after it. The execution surfaces put them after every general round
    instead (`running_order.execution_sort_key`), untouched.
    """
    all_heats = get_heats(db, race_id)
    if not all_heats:
        return []

    pending = []
    for h in all_heats:
        if h.recorded_at is not None:
            continue
        assert h.round is not None  # get_heats excludes free heats (#6)
        if h.round.advancement_source is None:
            pending.append(h)
    if not pending:
        return []

    lanes_by_heat = lanes_for_heats(db, pending)

    groups: dict[int, list[running_order.HeatEntry[int]]] = {}
    for heat, heat_lanes in zip(pending, lanes_by_heat, strict=True):
        assert heat.round_id is not None  # get_heats excludes free heats (#6)
        groups.setdefault(heat.round_id, []).append(
            running_order.HeatEntry(
                handle=heat.id,
                racer_ids=frozenset(lanes.real_racer_ids(heat_lanes)),
            )
        )

    schedules = [
        running_order.GroupSchedule(group_id=round_id, heats=entries)
        for round_id, entries in groups.items()
    ]
    order = running_order.interleave(schedules)

    base = max(h.heat_number for h in all_heats) + 1
    update_map = {heat_id: base + position for position, heat_id in enumerate(order)}
    return _write_heat_numbers(db, update_map)


def repair_master_running_order(
    db: Session, race_id: int, new_heats_by_round: dict[int, list[models.Heat]]
) -> list[models.Heat]:
    """Fold heats a mid-event change just created into the running order.

    (#549, stage 3)

    Called from the two seams that change a group's heat count while a race
    is under way — :func:`admit_late_racers` (#172) and
    :func:`apply_outages_to_scheduled_heats` (#171), which both regenerate a
    round wholesale when nothing has been raced, and the first also appends a
    wave to a round that is part-way through. Neither is hooked by reaching
    into :func:`generate_heats_for_round` itself, which both call for the
    "nothing raced" case: that function also serves `regenerateRound`,
    `createRoundWizard` and every scheduling-strategy's first wave/phase,
    none of which is a mid-event cascade this issue is about, so hooking it
    would repair far more than the two seams the issue names. Each of the two
    callers instead passes exactly the heats *it* just created.

    `new_heats_by_round` is empty on a call that changed nothing (an outage
    that only vacated lanes, an admission with no eligible latecomer), and an
    empty map is a no-op — which is what makes repeated repair idempotent:
    calling it again with nothing new to fold in touches no row. It is also a
    no-op when `Race.master_running_order` is off, so every existing race
    (the flag's default) is entirely unaffected by this function existing.

    This is append-and-repair, not `applyMasterRunningOrder`'s regenerate.
    Every heat that already existed before this call — recorded or still
    pending, whether or not it has ever been through an interleave — keeps
    the `heat_number` it already had: this function never assigns a new
    heat_number to a heat it did not just receive as an input. That is what
    protects an armed heat, the same rule elimination's wave growth already
    follows (#50) — the only heats eligible for a new number here did not
    exist for the operator to have armed, so there is nothing to disarm and
    no `_revalidate_timers` call is needed (unlike a rebuild that reassigns
    lanes on an *existing* heat, this only ever touches `heat_number` on rows
    nobody could have staged before this function ran).

    Several rounds can each contribute a new wave in the same call — e.g. two
    dens both admit a latecomer through one `bulkCheckIn` — and their new
    heats are woven together by `running_order.interleave`, the same
    algorithm `applyMasterRunningOrder` uses for a whole race, scoped here to
    only what is actually new. A physical insertion between two existing
    heat_number values is not attempted: an integer column has no gap to put
    a heat in without shifting its neighbours, which is exactly the
    renumbering this function exists to avoid. So the new heats are placed
    after the highest `heat_number` the race holds anywhere, in the order
    `interleave` gives them — proportional pacing and no-consecutive-car
    apply to how the *new* heats are woven together, not retroactively to
    heats already on the board.
    """
    new_heats = [heat for heats in new_heats_by_round.values() for heat in heats]
    if not new_heats:
        return []

    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None or not race.master_running_order:
        return []

    # Championship rounds stay out of the master order, exactly as
    # `apply_master_running_order` keeps them out: the execution surfaces run
    # them after every general round, and the advancement cascade renumbers
    # their heats 1..N on every rebuild anyway.
    def _is_general(heats: list[models.Heat]) -> bool:
        round_obj = heats[0].round
        assert round_obj is not None  # cascade heats always belong to a round
        return round_obj.advancement_source is None

    new_heats_by_round = {
        round_id: heats
        for round_id, heats in new_heats_by_round.items()
        if heats and _is_general(heats)
    }
    new_heats = [heat for heats in new_heats_by_round.values() for heat in heats]
    if not new_heats:
        return []

    new_lanes = lanes_for_heats(db, new_heats)
    lanes_by_id = {
        heat.id: heat_lanes
        for heat, heat_lanes in zip(new_heats, new_lanes, strict=True)
    }

    schedules = [
        running_order.GroupSchedule(
            group_id=round_id,
            heats=[
                running_order.HeatEntry(
                    handle=heat.id,
                    racer_ids=frozenset(lanes.real_racer_ids(lanes_by_id[heat.id])),
                )
                for heat in heats
            ],
        )
        for round_id, heats in new_heats_by_round.items()
    ]
    order = running_order.interleave(schedules)

    all_heats = get_heats(db, race_id)
    base = max(h.heat_number for h in all_heats) + 1
    update_map = {heat_id: base + position for position, heat_id in enumerate(order)}
    return _write_heat_numbers(db, update_map)


def bulk_delete_racers(db: Session, racer_ids: list[int]):
    from collections import defaultdict

    racers = db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).all()
    by_race: dict[int, set[int]] = defaultdict(set)
    for r in racers:
        by_race[r.race_id].add(r.id)

    # Which rounds may be rebuilt has to be decided *first*, because vacating a
    # lane clears its time — and a round with no times left looks like a round
    # that was never raced. Asking afterwards regenerates a started round and
    # destroys the results it was meant to protect.
    rebuildable = [
        r
        for race_id in by_race
        for r in db.query(models.Round).filter(models.Round.race_id == race_id)
        if advancement.may_rebuild(_round_heat_lanes(db, r.id))
    ]

    # Vacate before the racers go, not after. A lane can only be matched to a
    # doomed racer while the racer is still there: `ON DELETE SET NULL` (#125)
    # nulls `heat_lanes.racer_id` the moment the delete lands, so anything
    # looking afterwards has nothing left to match on.
    for race_id, ids in by_race.items():
        _vacate_lanes(db, ids, race_id)
    db.commit()

    # Regeneration has to see the racers gone, so that it fields the pool that
    # is actually left.
    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).delete(
        synchronize_session=False
    )
    db.commit()

    # A round that was raced keeps the holes the vacating left; only the rest
    # are rebuilt. A general round asks the field for at least two racers and
    # raises if it can't have them (#310) — the deletes above are already
    # committed by this point, so that exception must never reach the caller.
    # `withdraw_absent_racers` hits the identical situation (checked-in count
    # drops below two) and falls back to leaving the round on its vacated
    # holes instead of regenerating; do the same here rather than raising.
    for round_obj in rebuildable:
        if round_obj.advancement_source is None:
            eligible = eligible_racer_ids(
                db, round_obj.race_id, round_obj.racing_group_id
            )
            if len(eligible) < 2:
                continue
        generate_heats_for_round(db, round_obj.id, clear_existing=True)
    db.commit()


def bulk_clear_car_numbers(db: Session, racer_ids: list[int]):
    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).update(
        {models.Racer.car_number: None}, synchronize_session=False
    )
    db.commit()


def bulk_check_in_racers(
    db: Session, racer_ids: list[int], passed_inspection: bool = True
):
    """Bulk update check-in status for racers."""
    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).update(
        {models.Racer.car_passed_inspection: passed_inspection},
        synchronize_session=False,
    )
    db.commit()


def bulk_set_excluded_from_standings(
    db: Session, racer_ids: list[int], excluded: bool = True
) -> None:
    """Bulk set whether racers race but are not ranked (#548).

    Unlike :func:`bulk_check_in_racers`, this touches nothing but the flag
    itself — check-in still decides who fields in a heat, so there is no
    schedule to rebuild here.
    """
    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).update(
        {models.Racer.excluded_from_standings: excluded},
        synchronize_session=False,
    )
    db.commit()


def create_free_race_heat(
    db: Session,
    race_id: int,
    lane_assignments: list[lanes.Lane],
) -> models.Heat:
    """Create a free race heat from the given lane assignments.

    The assignments go straight into ``lane_results`` with no times, exactly as
    a generated official heat does. "Has this been run" is then one question for
    both kinds — whether any lane holds a time (#6).

    Takes lanes rather than dicts so it goes through ``lanes.serialize`` like
    every other write. It used to ``json.dumps`` its own dicts, which is a
    second copy of the codec in the two places #72 has to change.
    """
    from datetime import datetime, timezone

    heat = models.Heat(
        race_id=race_id,
        round_id=None,
        kind=models.HeatKind.FREE,
        heat_number=_next_free_heat_number(db, race_id),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    set_heat_lanes(heat, lane_assignments)
    db.add(heat)
    db.commit()
    db.refresh(heat)
    return heat


def _next_free_heat_number(db: Session, race_id: int) -> int:
    """Free heats have no round, so this is only a label — but it should count."""
    highest = (
        db.query(func.max(models.Heat.heat_number))
        .filter(
            models.Heat.race_id == race_id,
            models.Heat.kind == models.HeatKind.FREE,
        )
        .scalar()
    )
    return (highest or 0) + 1


def get_free_race_heat(db: Session, heat_id: int) -> models.Heat | None:
    """One free race heat by id.

    The ``kind`` check is not paranoia: it is what stops a free-race mutation
    reaching an official heat now that they share an id space. Before #6 the two
    tables had overlapping ids and this went wrong for real (#4).
    """
    return (
        db.query(models.Heat)
        .filter(
            models.Heat.id == heat_id,
            models.Heat.kind == models.HeatKind.FREE,
        )
        .first()
    )


def update_free_race_heat_result(
    db: Session,
    heat_id: int,
    lane_results: list[lanes.Lane],
    *,
    source: audit.ResultSource,
) -> models.Heat | None:
    """Record results for a free race heat.

    Lanes rather than dicts, for the same reason as
    :func:`create_free_race_heat` — one codec, in ``domain/lanes.py``.

    ``source`` for the same reason as :func:`record_heat_result`: an exhibition
    run reaches the database by the same two routes, and the log should be able
    to say which.
    """
    heat = get_free_race_heat(db, heat_id)
    if heat is None:
        return None
    set_heat_lanes(heat, lane_results)
    stamp_recorded(heat, lane_results)
    db.commit()
    db.refresh(heat)
    _record_result_audit(db, heat, lane_results, source)
    return heat


def get_free_race_heats(
    db: Session,
    race_id: int,
    limit: int = 10,
) -> list[models.Heat]:
    """The most recent free race heats for a race, newest first."""
    return (
        db.query(models.Heat)
        .filter(
            models.Heat.race_id == race_id,
            models.Heat.kind == models.HeatKind.FREE,
        )
        .order_by(models.Heat.id.desc())
        .limit(limit)
        .all()
    )


def create_run_off_heat(
    db: Session,
    race_id: int,
    settles_round_id: int | None,
    racer_ids: Sequence[int],
) -> models.Heat:
    """Create a run-off heat to settle a tie (#550).

    Mirrors :func:`create_free_race_heat`'s shape almost exactly — a heat
    with no ``round_id``, its lane assignments written through the one door
    (:func:`set_heat_lanes`) — because a run-off is exactly as much "not part
    of a generated round's schedule" as a free heat is. The one thing it adds
    is ``settles_round_id``, which names the cut it is racing to decide.

    Lanes are assigned automatically, one tied racer per usable lane, in the
    order given — the whole point is that these specific cars race each
    other once, not that the operator picks who stands where. Raises if
    there are fewer than two racers (nothing to break a tie between) or more
    racers than usable lanes (nowhere to put them); the resolver turns that
    into a GraphQL error.
    """
    if len(set(racer_ids)) < 2:
        raise ValueError("A run-off needs at least two racers.")
    usable = sorted(usable_lanes_for_race(db, race_id))
    if len(racer_ids) > len(usable):
        raise ValueError("More tied racers than usable lanes.")

    assignments = [
        lanes.Lane(lane=lane_num, racer_id=racer_id)
        for lane_num, racer_id in zip(usable, racer_ids, strict=False)
    ]
    heat = models.Heat(
        race_id=race_id,
        round_id=None,
        settles_round_id=settles_round_id,
        kind=models.HeatKind.RUN_OFF,
        heat_number=_next_run_off_heat_number(db, race_id),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    set_heat_lanes(heat, assignments)
    db.add(heat)
    db.commit()
    db.refresh(heat)
    return heat


def _next_run_off_heat_number(db: Session, race_id: int) -> int:
    """Run-off heats have no round, so this is only a label (#550) — the same
    reasoning as :func:`_next_free_heat_number`."""
    highest = (
        db.query(func.max(models.Heat.heat_number))
        .filter(
            models.Heat.race_id == race_id,
            models.Heat.kind == models.HeatKind.RUN_OFF,
        )
        .scalar()
    )
    return (highest or 0) + 1


def get_run_off_heat(db: Session, heat_id: int) -> models.Heat | None:
    """One run-off heat by id — the same ``kind`` guard `get_free_race_heat`
    uses, for the same reason (#4, #6): heat ids are shared across kinds."""
    return (
        db.query(models.Heat)
        .filter(
            models.Heat.id == heat_id,
            models.Heat.kind == models.HeatKind.RUN_OFF,
        )
        .first()
    )


def run_off_heats_for_race(db: Session, race_id: int) -> list[models.Heat]:
    """Every run-off heat on a race (#550), for the GraphQL field that lists
    them all — the standings page and the schedule each filter this by their
    own `settlesRoundId` client-side."""
    return (
        db.query(models.Heat)
        .filter(
            models.Heat.race_id == race_id,
            models.Heat.kind == models.HeatKind.RUN_OFF,
        )
        .order_by(models.Heat.id)
        .all()
    )


def run_off_heats_settling(
    db: Session, race_id: int, settles_round_id: int | None
) -> list[models.Heat]:
    """A race's run-off heats scoped to exactly one standings view (#550).

    ``settles_round_id=None`` is a real, meaningful filter here — the race's
    *overall* standings, the same thing ``get_leaderboard``'s own
    ``round_id`` parameter means when absent — not "don't filter"; that is
    what :func:`run_off_heats_for_race` is for.
    """
    return (
        db.query(models.Heat)
        .filter(
            models.Heat.race_id == race_id,
            models.Heat.kind == models.HeatKind.RUN_OFF,
            models.Heat.settles_round_id == settles_round_id,
        )
        .order_by(models.Heat.id)
        .all()
    )


def delete_run_off_heat(db: Session, heat_id: int) -> bool:
    """Delete a run-off heat. Only if it hasn't been run.

    Mirrors :func:`delete_free_race_heat` — the operator's way to undo a
    run-off created by mistake, before anyone has raced it. A recorded one
    stands, the same as any other heat with results: this module's write
    path is one door, and that door does not include silently discarding a
    result.
    """
    heat = get_run_off_heat(db, heat_id)
    if heat:
        if lanes.has_results(heat_lanes_of(db, heat)):
            raise ValueError("Cannot delete run-off heat: it has results.")
        db.delete(heat)
        db.commit()
        return True
    return False


def get_random_lane_assignments(
    db: Session,
    race_id: int,
    lane_numbers: Sequence[int],
    shuffle: int = 0,
) -> list[dict]:
    """
    Randomly select ``len(lane_numbers)`` checked-in racers and return lane
    assignments over exactly those lanes. If fewer racers are checked in than
    there are lanes, fill the remainder with empty slots (racer_id=None).

    Takes the lanes themselves rather than a count (#303) — a race with a
    lane out of service, or an operator's temporary per-lane disable on the
    Free Race screen, has to draw over the lanes that are actually usable,
    and a bare count cannot say which those are. ``lane_numbers`` need not be
    contiguous or start at 1.

    ``shuffle`` is which draw this is — 0 for the one a screen opens on, then
    1, 2, ... for each Re-shuffle. It is part of the key because the draw may
    be seeded, and a key naming only the race gives every draw the same answer:
    on the public demo, which sets ``TRUSTYTRACK_DEMO_SEED``, that made
    Re-shuffle a button that could not change anything.
    """
    # Ordered because the shuffle below may be seeded (`demo_seed`): a shuffle
    # is only as repeatable as the order of what it shuffles, and a query
    # without ORDER BY promises none. `lane_numbers` is sorted for the same
    # reason (#240) — a caller may hand it over as a set.
    pool = (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race_id, models.Racer.car_passed_inspection)
        .order_by(models.Racer.id)
        .all()
    )
    lanes_sorted = sorted(lane_numbers)
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    demo_seed.generator(
        f"free-race lanes:{race.name if race else race_id}:{shuffle}"
    ).shuffle(pool)
    selected = pool[: len(lanes_sorted)]

    assignments = []
    for i, lane in enumerate(lanes_sorted):
        racer_id = selected[i].id if i < len(selected) else None
        assignments.append({"lane": lane, "racer_id": racer_id})
    return assignments


def bulk_move_racers_to_racing_group(
    db: Session, racer_ids: list[int], racing_group_id: int | None
):
    """Reassign racers to a racing group, or to none."""
    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).update(
        {"racing_group_id": racing_group_id}, synchronize_session=False
    )
    db.commit()


# --------------------------------------------------------------------------- #
# Awards (#170)                                                                #
# --------------------------------------------------------------------------- #
#
# A recipient is never stored for a SPEED award — `services/awards.py` computes
# it from the standings each time. What is stored here is the rule.


def get_awards(db: Session, race_id: int) -> list[models.Award]:
    """A race's awards in presentation order.

    Ordered by `sort_order` then `id`, so awards created before anybody set an
    order still come back in a stable sequence rather than whatever the database
    happens to return.
    """
    return (
        db.query(models.Award)
        .filter(models.Award.race_id == race_id)
        .order_by(models.Award.sort_order, models.Award.id)
        .all()
    )


def _next_award_sort_order(db: Session, race_id: int) -> int:
    highest = (
        db.query(func.max(models.Award.sort_order))
        .filter(models.Award.race_id == race_id)
        .scalar()
    )
    return 0 if highest is None else int(highest) + 1


def create_award(db: Session, race_id: int, award: schemas.AwardCreate) -> models.Award:
    """Add an award, at the end of the running order unless told otherwise.

    The fields that do not belong to the kind are cleared rather than trusted:
    a `SPECIAL` award with a `source` would resolve as neither one thing nor the
    other in `services/awards._rule_for`, and the client has no reason to be the
    thing that remembers.
    """
    data = award.model_dump(exclude_unset=True)
    sort_order = data.pop("sort_order", None)
    db_award = models.Award(
        race_id=race_id,
        sort_order=(
            _next_award_sort_order(db, race_id) if sort_order is None else sort_order
        ),
        **data,
    )
    _clear_fields_of_other_kind(db_award)
    _set_speed_artwork_key(db_award)
    db.add(db_award)
    db.commit()
    db.refresh(db_award)
    return db_award


def update_award(
    db: Session, award_id: int, award_update: schemas.AwardUpdate
) -> models.Award | None:
    db_award = db.query(models.Award).filter(models.Award.id == award_id).first()
    if not db_award:
        return None

    changes = award_update.model_dump(exclude_unset=True)

    # `sort_order` is NOT NULL, and the running order is `reorder_awards`'
    # business rather than the edit form's. The form sends the whole award on
    # every save, so an order it never offers arrives as an explicit null —
    # which would write null into the column. Absent means "leave it alone",
    # the same rule as `update_race` and the PIN (#192).
    if changes.get("sort_order") is None:
        changes.pop("sort_order", None)

    for key, value in changes.items():
        setattr(db_award, key, value)

    # After the update, not before: changing the kind is what makes the other
    # kind's fields stale, and the change and the fields can arrive together.
    _clear_fields_of_other_kind(db_award)
    _set_speed_artwork_key(db_award)

    db.commit()
    db.refresh(db_award)
    return db_award


def _clear_fields_of_other_kind(award: models.Award) -> None:
    """Null whichever half of the row this award's kind does not use."""
    if award.kind is models.AwardKind.SPEED:
        award.racer_id = None
        # A SPEED award has a computed recipient; a ballot for it could not
        # mean anything (#305), so switching an award to SPEED turns voting
        # off rather than leaving a stale flag a client could still read.
        award.votable = False
    else:
        award.source = None
        award.place = None
        award.from_bottom = False
        award.racing_group_id = None


def _set_speed_artwork_key(award: models.Award) -> None:
    """A `SPEED` award's artwork comes from its rule, never a picker (#306).

    Runs after `_clear_fields_of_other_kind`, so a `SPECIAL` award's
    `artwork_key` — set by the ready-made superlative picker, or left blank
    for a plain certificate — is untouched here. Whatever a client sent for a
    `SPEED` award's `artwork_key` is overwritten: the frontend offers no
    control for it, and trusting a stray value would let it drift from the
    rule the moment the rule changes.

    A rule that is not complete yet (no place) gets no artwork key rather than
    a guess — the same "not decided yet" the recipient itself resolves to.
    """
    if award.kind is not models.AwardKind.SPEED:
        return
    if award.place is None:
        award.artwork_key = None
        return
    rule = awards.SpeedRule(
        source=award.source or awards.ALL,
        place=award.place,
        racing_group_id=award.racing_group_id,
        from_bottom=award.from_bottom,
    )
    award.artwork_key = awards.default_artwork_key(rule)


def delete_award(db: Session, award_id: int) -> models.Award | None:
    db_award = db.query(models.Award).filter(models.Award.id == award_id).first()
    if db_award:
        db.delete(db_award)
        db.commit()
    return db_award


def reorder_awards(
    db: Session, race_id: int, award_ids: list[int]
) -> list[models.Award]:
    """Set the presentation order from a list of ids, first to last.

    Ids that do not belong to this race are ignored rather than raising: the
    screen sends the order it is showing, and an award deleted from another
    device between render and drop is a race, not a mistake.
    """
    by_id = {award.id: award for award in get_awards(db, race_id)}
    for position, award_id in enumerate(award_ids):
        award = by_id.get(award_id)
        if award is not None:
            award.sort_order = position
    db.commit()
    return get_awards(db, race_id)


def cast_vote(db: Session, award_id: int, racer_id: int, ballot_key: str) -> str | None:
    """Record one ballot for a `SPECIAL` award (#305).

    Returns ``None`` on success, or the reason it was refused — the same
    shape `TimerManager.release_start_gate` uses, because both are a gate a
    caller with no other feedback needs told in a sentence, not a stack trace
    from a phone that has no console open.

    A retried submission — the same ``ballot_key`` for the same award — is
    silently accepted rather than refused a second time: the `IntegrityError`
    from ``uq_award_ballot`` is caught and treated as success. The guard is
    against a doubled click or a retried request, never against a second vote
    from the same device (#305) — a fresh key is a new ballot.
    """
    award = db.query(models.Award).filter(models.Award.id == award_id).first()
    if award is None:
        return "That award no longer exists."
    if not awards.can_be_voted_on(award.kind.value, award.votable):
        return "This award is not open for voting."

    race = db.query(models.Race).filter(models.Race.id == award.race_id).first()
    if race is None or not race.voting_open:
        return "Voting is closed."

    racer = (
        db.query(models.Racer)
        .filter(models.Racer.id == racer_id, models.Racer.race_id == award.race_id)
        .first()
    )
    if racer is None:
        return "That car is not in this race."

    db.add(
        models.AwardVote(
            award_id=award_id,
            racer_id=racer_id,
            ballot_key=ballot_key,
            cast_at=datetime.now(timezone.utc).isoformat(),
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return None


def vote_counts_for_awards(
    db: Session, award_ids: Sequence[int]
) -> dict[int, dict[int, int]]:
    """Ballots for a set of awards, grouped by award and then by racer.

    One query for a whole race's awards rather than one per award — the same
    shape as `lanes_for_heats`, for the same reason: a tally screen asking
    about every votable award at once must not pay per award.
    """
    by_award: dict[int, dict[int, int]] = {award_id: {} for award_id in award_ids}
    if not award_ids:
        return by_award
    rows = (
        db.query(
            models.AwardVote.award_id,
            models.AwardVote.racer_id,
            func.count(models.AwardVote.id),
        )
        .filter(models.AwardVote.award_id.in_(award_ids))
        .group_by(models.AwardVote.award_id, models.AwardVote.racer_id)
        .all()
    )
    for award_id, racer_id, count in rows:
        by_award[award_id][racer_id] = count
    return by_award


# --- Practice race (#201) -----------------------------------------------


#: The name of the track a practice race falls back to creating.
PRACTICE_TRACK_NAME = "Practice Track"

#: Re-exported so existing callers (and the test suite) can keep saying
#: `crud.PRACTICE_RACE_NAME`; the naming rule itself now lives in
#: `domain.practice`, which needs to be importable with no database (#588).
PRACTICE_RACE_NAME = practice.PRACTICE_RACE_NAME

#: Enough racers to feel like an event without being a chore to sit through.
#: Twenty is `populate`'s default and twenty heats is most of an afternoon.
PRACTICE_RACER_COUNT = 12

#: How many cars reach the practice final.
PRACTICE_FINALISTS = 4


def practice_track(db: Session) -> models.Track:
    """A track a practice race can safely be run on.

    Any existing fake-timer track will do, and reusing one is the point: an
    operator who rehearses three times should not end up with three tracks in
    System Settings. Only a venue whose tracks are all real hardware gets a new
    one, and it gets exactly one.
    """
    existing = (
        db.query(models.Track)
        .filter(models.Track.timer_type == models.TimerType.FAKE)
        .order_by(models.Track.id)
        .first()
    )
    if existing:
        return existing

    return create_track(
        db,
        schemas.TrackCreate(
            name=PRACTICE_TRACK_NAME,
            lane_count=4,
            timer_type=models.TimerType.FAKE,
        ),
    )


def _next_practice_name(db: Session) -> str:
    """A free name, since ``races.name`` is unique.

    The rule is `domain.practice.next_practice_name`; this is just the query
    that supplies its input.
    """
    taken = {
        name
        for (name,) in db.query(models.Race.name)
        .filter(models.Race.name.like(f"{PRACTICE_RACE_NAME}%"))
        .all()
    }
    return practice.next_practice_name(taken)


def existing_practice_race(db: Session) -> models.Race | None:
    """The most recent rehearsal still on the books, if there is one (#588).

    Resuming this one — rather than building another — is what keeps a
    double click, or simply visiting Home a second time, from leaving cruft
    in the races list. `createPracticeRace` reads this before deciding
    whether to create anything, and `Query.practiceRace` reads it too, so the
    Home page can offer "Resume practice race" without re-deriving the naming
    rule itself (#48's lesson about a rule answered twice).

    Ordered by id, not by name: `PRACTICE_RACE_NAME`'s own counter does not
    survive a deletion in the middle, so an operator who deletes "Practice
    Race 2" and rehearses again gets a fresh "Practice Race 2" that is
    *newer* than a surviving "Practice Race 3" — name order and creation
    order can disagree, and only the id is honest about which came last.
    """
    candidates = (
        db.query(models.Race)
        .filter(models.Race.name.like(f"{PRACTICE_RACE_NAME}%"))
        .order_by(models.Race.id.desc())
        .all()
    )
    for race in candidates:
        if practice.is_practice_race_name(race.name):
            return race
    return None


def create_practice_race(db: Session) -> models.Race:
    """A whole event, ready to run, on a fake timer (#201).

    The operator is a parent volunteer who uses this app once a year, and the
    night before is when they want to find out what race day feels like.
    Everything needed already existed — `populate` builds a believable roster
    and the fake timer runs heats without hardware — but neither was reachable
    as a rehearsal: it took creating a race, adding racing groups, populating, checking
    everybody in and running the round wizard, which is most of the thing being
    rehearsed.

    It includes a championship round on purpose. Advancement is the part of
    race day that surprises people, and a rehearsal that stops before the final
    leaves out the bit worth practising.

    Always builds a new one — it is the primitive `existing_practice_race`
    stands in front of, not the thing a caller wanting "resume, or create if
    there isn't one" (#588) should call directly. That caller is the
    `createPracticeRace` resolver, which checks `existing_practice_race`
    first.
    """
    from backend.db import populate

    organization = (
        db.query(models.Organization).order_by(models.Organization.id).first()
    )
    if organization is None:
        raise ValueError("Set the system up before creating a practice race")

    track = practice_track(db)

    race = create_race(
        db,
        schemas.RaceCreate(
            name=_next_practice_name(db),
            organization_id=organization.id,
            track_id=track.id,
            location="Practice",
            car_numbering_strategy=models.CarNumberingStrategy.GLOBAL,
            scoring_strategy=models.ScoringStrategy.TIMED,
            championship_trophies=3,
        ),
    )

    # Checked in, because `generate_heats_for_round` fields only racers that
    # passed inspection — an uninspected roster produces an empty schedule
    # rather than an error, which is a confusing way for a rehearsal to start.
    populate.generate_fake_racers(
        db,
        race.id,
        count=PRACTICE_RACER_COUNT,
        add_racer_photos=True,
        add_car_photos=True,
        assign_racing_groups=True,
        check_in=True,
    )

    prelim = create_round(
        db,
        race.id,
        1,
        models.SchedulingStrategy.PPC,
        default_general_round_name(db, race),
    )
    generate_heats_for_round(db, prelim.id, clear_existing=True)

    final = create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Final",
        advancement_source="ALL",
        advancement_num_racers=PRACTICE_FINALISTS,
    )
    db.flush()
    generate_heats_for_round(db, final.id, clear_existing=True)

    db.commit()
    db.refresh(race)
    return race


# --- The audit log (#219) -----------------------------------------------


#: How many entries to keep.
#:
#: An event is a few thousand rows, so this is many events' worth — and the
#: table lives on an SD card in a Raspberry Pi, which is why there is a number
#: here at all rather than a promise to look at it later. Trimmed at startup by
#: :func:`prune_audit_log`; nothing runs in the background.
AUDIT_LOG_MAX_ENTRIES = 50_000


def record_audit(
    db: Session,
    action: str,
    *,
    role: str,
    outcome: str = audit.Outcome.OK.value,
    source_ip: str | None = None,
    race_id: int | None = None,
    details: dict[str, audit.Detail] | None = None,
) -> audit.Entry:
    """Append one entry.

    Committed on its own rather than left to the caller's transaction. The
    interesting entries are the ones that accompany something going wrong, and
    an entry that rolls back with the operation it was describing is missing
    exactly when it is wanted.
    """
    at = datetime.now(timezone.utc).isoformat()
    row = models.AuditEntry(
        at=at,
        action=action,
        role=role,
        outcome=outcome,
        source_ip=source_ip,
        race_id=race_id,
        details=json.dumps(details) if details else None,
    )
    db.add(row)
    db.commit()

    # A value, not the row. `db.commit()` expires the instance, so handing back
    # the ORM object would make reading any field of it a second SELECT — which
    # is a query per mutation for something every caller already knows, and
    # `test_query_counts.py` measures it.
    return audit.Entry(
        action=action,
        role=audit.ActorRole(role),
        at=at,
        outcome=audit.Outcome(outcome),
        source_ip=source_ip,
        race_id=race_id,
        details=dict(details or {}),
    )


def get_audit_entries(
    db: Session,
    race_id: int | None = None,
    limit: int = 200,
    before_id: int | None = None,
) -> list[models.AuditEntry]:
    """The most recent entries first, newest page first.

    ``race_id`` narrows to one race *and* keeps the entries that concern no
    particular race — setting up a track, restoring a backup — out of the way.
    Paging is by id rather than by timestamp because two entries can share a
    timestamp and an offset would skip rows as new ones arrive at the head.
    """
    query = db.query(models.AuditEntry)
    if race_id is not None:
        query = query.filter(models.AuditEntry.race_id == race_id)
    if before_id is not None:
        query = query.filter(models.AuditEntry.id < before_id)
    return query.order_by(models.AuditEntry.id.desc()).limit(limit).all()


def prune_audit_log(db: Session, keep: int = AUDIT_LOG_MAX_ENTRIES) -> int:
    """Drop all but the newest ``keep`` entries. Returns how many went.

    Called from ``init_db`` rather than on every write: trimming per insert
    would put a count and a delete in the path of every mutation, and the table
    being briefly over its cap between restarts costs nothing.
    """
    total = db.query(func.count(models.AuditEntry.id)).scalar() or 0
    if total <= keep:
        return 0

    cutoff = (
        db.query(models.AuditEntry.id)
        .order_by(models.AuditEntry.id.desc())
        .offset(keep - 1)
        .limit(1)
        .scalar()
    )
    if cutoff is None:
        return 0

    removed = (
        db.query(models.AuditEntry)
        .filter(models.AuditEntry.id < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return removed


# --------------------------------------------------------------------------- #
# Display scenes (#613)                                                        #
# --------------------------------------------------------------------------- #
#
# This module holds only the stored rows. It has no dependency on
# `services/displays.py`'s in-memory presence registry — the same boundary
# that module keeps from the database — so every function here takes the
# display state it needs (a snapshot to capture, an assignment to write) as
# plain arguments rather than reaching for the registry itself. `api/schema.py`
# is what has both: it is where a scene's stored rows and the registry's live
# state actually meet, exactly as it already is for `assignDisplay`.


def get_scenes(db: Session, race_id: int) -> list[models.Scene]:
    """A race's saved scenes, oldest first — the order they were created,
    which is also the order the quick bar offers them in."""
    return (
        db.query(models.Scene)
        .filter(models.Scene.race_id == race_id)
        .order_by(models.Scene.id)
        .all()
    )


def get_scene(db: Session, scene_id: int) -> models.Scene | None:
    return db.query(models.Scene).filter(models.Scene.id == scene_id).first()


def _scene_name_taken(
    db: Session, race_id: int, name: str, exclude_scene_id: int | None = None
) -> bool:
    query = db.query(models.Scene).filter(
        models.Scene.race_id == race_id, models.Scene.name == name
    )
    if exclude_scene_id is not None:
        query = query.filter(models.Scene.id != exclude_scene_id)
    return query.first() is not None


def create_scene(
    db: Session,
    race_id: int,
    name: str,
    captured: list[tuple[str, str, Assignment]],
) -> models.Scene:
    """Save a new named scene.

    ``captured`` is one ``(display_id, display_name, Assignment)`` per
    display the caller wants in it — ordinarily every display
    ``DisplayRegistry.for_race`` currently knows about, read by the resolver
    and handed down, since this module has no dependency on that registry.
    An empty list is a legitimate scene: a name reserved before any screen
    has connected, to be filled in later through
    :func:`upsert_scene_display`.

    Raises ``ValueError`` for a name already used by another scene in this
    race, checked ahead of the insert rather than caught as an
    ``IntegrityError`` afterwards, so the message names the actual problem
    rather than a constraint name.
    """
    if _scene_name_taken(db, race_id, name):
        raise ValueError(f'A scene named "{name}" already exists for this race.')
    scene = models.Scene(race_id=race_id, name=name)
    scene.assignments = [
        models.SceneAssignment(
            display_id=display_id,
            display_name=display_name,
            view=assignment.view,
            cycle_seconds=assignment.cycle_seconds,
            scroll_behavior=assignment.scroll_behavior,
            show_checked_in=assignment.show_checked_in,
            qr_target=assignment.qr_target,
            show_standings_ticker=assignment.show_standings_ticker,
        )
        for display_id, display_name, assignment in captured
    ]
    db.add(scene)
    db.commit()
    db.refresh(scene)
    return scene


def rename_scene(db: Session, scene_id: int, name: str) -> models.Scene | None:
    scene = get_scene(db, scene_id)
    if scene is None:
        return None
    if _scene_name_taken(db, scene.race_id, name, exclude_scene_id=scene_id):
        raise ValueError(f'A scene named "{name}" already exists for this race.')
    scene.name = name
    db.commit()
    db.refresh(scene)
    return scene


def delete_scene(db: Session, scene_id: int) -> bool:
    scene = get_scene(db, scene_id)
    if scene is None:
        return False
    db.delete(scene)
    db.commit()
    return True


def upsert_scene_display(
    db: Session,
    scene_id: int,
    display_id: str,
    display_name: str,
    assignment: Assignment,
) -> models.Scene | None:
    """Add or replace one display's entry within a scene.

    Whole-``Assignment`` in, whole row out — unlike ``assignDisplay``'s live
    equivalent, a caller here supplies every field (`api/schema.py` fills in
    whichever riders the mutation's own arguments omitted, from this entry's
    *current* stored values when it already has one, or from
    ``Assignment``'s ordinary defaults when it does not — the same
    "unspecified keeps what was there" rule ``DisplayRegistry.assign``
    follows for a live screen). This function itself just writes what it is
    given.
    """
    scene = get_scene(db, scene_id)
    if scene is None:
        return None
    existing = next((a for a in scene.assignments if a.display_id == display_id), None)
    if existing is None:
        scene.assignments.append(
            models.SceneAssignment(
                display_id=display_id,
                display_name=display_name,
                view=assignment.view,
                cycle_seconds=assignment.cycle_seconds,
                scroll_behavior=assignment.scroll_behavior,
                show_checked_in=assignment.show_checked_in,
                qr_target=assignment.qr_target,
                show_standings_ticker=assignment.show_standings_ticker,
            )
        )
    else:
        existing.display_name = display_name
        existing.view = assignment.view
        existing.cycle_seconds = assignment.cycle_seconds
        existing.scroll_behavior = assignment.scroll_behavior
        existing.show_checked_in = assignment.show_checked_in
        existing.qr_target = assignment.qr_target
        existing.show_standings_ticker = assignment.show_standings_ticker
    db.commit()
    db.refresh(scene)
    return scene


def remove_scene_display(
    db: Session, scene_id: int, display_id: str
) -> models.Scene | None:
    """Drop one display from a scene — the operator deciding a screen that
    left the venue should no longer be part of it."""
    scene = get_scene(db, scene_id)
    if scene is None:
        return None
    scene.assignments = [a for a in scene.assignments if a.display_id != display_id]
    db.commit()
    db.refresh(scene)
    return scene
