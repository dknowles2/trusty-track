from __future__ import annotations

import random
from collections.abc import Sequence
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.domain import advancement, lanes, scheduling

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


def get_group(db: Session, group_id: int) -> models.Group | None:
    return db.query(models.Group).filter(models.Group.id == group_id).first()


def get_group_by_name(db: Session, name: str) -> models.Group | None:
    return db.query(models.Group).filter(models.Group.name == name).first()


def create_group(db: Session, group: schemas.GroupCreate) -> models.Group:
    db_group = models.Group(name=group.name)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group


def get_dens(
    db: Session, race_id: int, skip: int = 0, limit: int = 100
) -> list[models.Den]:
    return (
        db.query(models.Den)
        .filter(models.Den.race_id == race_id)
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_den(db: Session, den_id: int) -> models.Den | None:
    return db.query(models.Den).filter(models.Den.id == den_id).first()


def get_den_by_name(db: Session, name: str, race_id: int) -> models.Den | None:
    # Example: Case insensitive search could be done here if DB supports it easily,
    # or just do exact match for simplicity first
    return (
        db.query(models.Den)
        .filter(models.Den.name == name, models.Den.race_id == race_id)
        .first()
    )


def create_den(db: Session, den: schemas.DenCreate, race_id: int) -> models.Den:
    db_den = models.Den(**den.model_dump(), race_id=race_id)
    db.add(db_den)
    db.commit()
    db.refresh(db_den)
    return db_den


def delete_den(db: Session, den_id: int) -> models.Den | None:
    db_den = db.query(models.Den).filter(models.Den.id == den_id).first()
    if db_den:
        racers = db.query(models.Racer).filter(models.Racer.den_id == den_id).all()
        for racer in racers:
            racer.den_id = None

        db.delete(db_den)
        db.commit()
    return db_den


def update_den(
    db: Session, den_id: int, den_update: schemas.DenUpdate
) -> models.Den | None:
    db_den = db.query(models.Den).filter(models.Den.id == den_id).first()
    if not db_den:
        return None

    update_data = den_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_den, key, value)

    db.commit()
    db.refresh(db_den)
    return db_den


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
    race_data = race.model_dump()
    db_race = models.Race(**race_data)
    db.add(db_race)
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

    Two of the three children need doing by hand. ``Race.dens`` and
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
) -> tuple[models.Group, list[models.Track]]:
    # Create Group
    group = models.Group(name=config.group_name, debug_mode=config.debug_mode)
    db.add(group)

    # Create Tracks
    created_tracks = []
    for track_data in config.tracks:
        track = models.Track(**track_data.model_dump())
        db.add(track)
        created_tracks.append(track)

    db.commit()
    db.refresh(group)
    for t in created_tracks:
        db.refresh(t)
    return group, created_tracks


def update_group(
    db: Session, group: models.Group, name: str, debug_mode: bool = False
) -> models.Group:
    group.name = name
    group.debug_mode = debug_mode
    db.commit()
    db.refresh(group)
    return group


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
    query = db.query(models.Racer)
    if race_id:
        query = query.filter(models.Racer.race_id == race_id)
    return query.offset(skip).limit(limit).all()


def create_racer(db: Session, racer: schemas.RacerCreate) -> models.Racer | None:
    # Ensure a race exists.
    race: models.Race | None = None
    if racer.race_id:
        race = db.query(models.Race).filter(models.Race.id == racer.race_id).first()
    else:
        race = db.query(models.Race).first()

    if not race:
        group = db.query(models.Group).first()
        if not group:
            return None
        race = models.Race(name="Main Event", group_id=group.id)
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
        query.join(models.Round)
        .order_by(models.Round.round_number, models.Heat.heat_number)
        .all()
    )


def get_rounds(db: Session, race_id: int) -> list[models.Round]:
    """Get all rounds for a specific race, ordered by round number."""
    return (
        db.query(models.Round)
        .filter(models.Round.race_id == race_id)
        .order_by(models.Round.round_number)
        .all()
    )


def create_round(
    db: Session,
    race_id: int,
    round_number: int,
    scheduling_strategy: models.SchedulingStrategy = models.SchedulingStrategy.PPC,
    name: str | None = None,
    advancement_source: str | None = None,
    advancement_num_racers: int | None = None,
    den_id: int | None = None,
) -> models.Round:
    """Create a new round for a race."""
    round_obj = models.Round(
        race_id=race_id,
        round_number=round_number,
        scheduling_strategy=scheduling_strategy,
        name=name,
        advancement_source=advancement_source,
        advancement_num_racers=advancement_num_racers,
        den_id=den_id,
    )
    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    return round_obj


def update_round(
    db: Session, round_id: int, round_update: schemas.RoundUpdate
) -> models.Round | None:
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        return None

    if round_update.name is not None:
        round_obj.name = round_update.name

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


def _generate_ppc(
    db: Session,
    race_id: int,
    round_id: int,
    p_ids: list[int],
    lane_count: int,
    start_heat_num: int = 1,
) -> list[models.Heat]:
    """Persist a PPC schedule for the given racers.

    The algorithm itself is :func:`backend.domain.scheduling.generate_ppc`; this
    is only the part that turns heat plans into rows.
    """
    plans = scheduling.generate_ppc(p_ids, lane_count, start_heat_number=start_heat_num)

    generated_heats: list[models.Heat] = []
    for plan in plans:
        lane_assignment = [
            lanes.from_participant(index + 1, participant_id)
            for index, participant_id in enumerate(plan.lanes)
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


def generate_heats_for_round(
    db: Session,
    round_id: int,
    num_placeholders: int = 0,
    racer_ids: list[int] | None = None,
    clear_existing: bool = True,
) -> list[models.Heat]:
    """
    Generate heats for a specific round based on its scheduling strategy.
    Supports regeneration if no heats in the round have started.

    If num_placeholders is > 0, it generates heats for that many "placeholder"
    racers (using negative IDs -1, -2, etc.).

    If racer_ids is provided, it uses those specific racers instead of all
    racers in the race.

    If clear_existing is True, it will delete existing heats in the round.
    """
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        raise ValueError(f"Round {round_id} not found")

    race_id = round_obj.race_id
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    lane_count = race.track.lane_count if race and race.track else 4

    # Check for existing heats
    existing_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    )
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

    if num_placeholders > 0:
        p_ids = scheduling.placeholder_ids(num_placeholders)
    elif racer_ids is not None:
        p_ids = racer_ids
    elif round_obj.advancement_source:
        # Championship round without explicit racer_ids/placeholders:
        # Use existing racers if advanced, otherwise use placeholders.
        current_racers = set()
        for h_lanes in lanes_for_heats(db, round_obj.heats):
            current_racers.update(lanes.real_racer_ids(h_lanes))
        if current_racers:
            p_ids = list(current_racers)
        else:
            p_ids = scheduling.placeholder_ids(round_obj.total_participants)
    else:
        query = db.query(models.Racer).filter(
            models.Racer.race_id == race_id, models.Racer.car_passed_inspection
        )
        if round_obj.den_id:
            query = query.filter(models.Racer.den_id == round_obj.den_id)
        racers = query.all()
        if not racers or len(racers) < 2:
            raise ValueError(
                "Not enough racers to generate a schedule (minimum 2 required)"
            )
        p_ids = [r.id for r in racers]

    # Continue numbering after heats that are still there ("stacking"), but
    # start again at 1 for heats we just deleted. `existing_heats` is the list
    # from *before* the delete, so testing it alone renumbered a regenerated
    # round to 5..8 instead of 1..4 — and left a gap in the race's numbering.
    start_heat_num = len(existing_heats) + 1 if existing_heats and not cleared else 1

    # Generate heats using PPC strategy
    new_heats = _generate_ppc(
        db, race_id, round_id, p_ids, lane_count, start_heat_num=start_heat_num
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
    ``advancement_num_racers`` is a *request* — "top four" — and a den of three
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
    around it — a ``DEN`` round needs its racer count multiplied by the number
    of dens, so somebody has to count the dens.

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
    den_count = 0
    if source == advancement.DEN:
        den_count = (
            db.query(models.Den).filter(models.Den.race_id == round_obj.race_id).count()
        )
    return advancement.field_size(rule, den_count)


def lane_count_for_race(db: Session, race_id: int) -> int:
    """Lanes on the race's track, or four if it has none."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    return race.track.lane_count if race and race.track else 4


def _reset_heats_in_place(
    db: Session, round_id: int, p_ids: list[int], lane_count: int
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
    """
    existing = sorted(
        db.query(models.Heat).filter(models.Heat.round_id == round_id).all(),
        key=lambda h: h.heat_number,
    )
    if not existing:
        return False

    plans = scheduling.generate_ppc(p_ids, lane_count, start_heat_number=1)
    if len(plans) != len(existing):
        return False

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
                lanes.from_participant(index + 1, participant_id)
                for index, participant_id in enumerate(plan.lanes)
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
    lane_count = lane_count_for_race(db, race_id)

    for r in advancement.rounds_to_invalidate(all_rounds, current_round_number):
        if not advancement.may_rebuild(_round_heat_lanes(db, r.id)):
            continue
        size = round_field_size(db, r)
        if size > 0 and _reset_heats_in_place(
            db, r.id, scheduling.placeholder_ids(size), lane_count
        ):
            continue
        generate_heats_for_round(
            db,
            r.id,
            num_placeholders=size,
            clear_existing=True,
        )


def is_round_complete(db: Session, round_id: int) -> bool:
    """True when every heat in the round has a time for every real racer."""
    return advancement.is_round_complete(_round_heat_lanes(db, round_id))


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

    from backend.services import scoring

    for r in future_rounds:
        rule = advancement.AdvancementRule(
            source=r.advancement_source, num_racers=r.advancement_num_racers
        )

        def prior_rounds_complete(before=r.round_number) -> bool:
            return all(
                is_round_complete(db, pr.id)
                for pr in all_rounds
                if pr.round_number < before
            )

        if not advancement.should_populate(
            rule, completed_round_id, prior_rounds_complete
        ):
            continue

        winner_ids = scoring.get_advancing_racers(
            db, race_id, r.advancement_source, r.advancement_num_racers
        )
        # Putting racers in adds no times, so the round is not complete
        # afterwards and there is nothing to cascade into.
        populate_round_field(db, r.id, winner_ids)


def set_heat_lanes(heat: models.Heat, heat_lanes: Sequence[lanes.Lane]) -> None:
    """Write a heat's lanes. The one door for them.

    Every write goes through here (#119), which is what let the direction
    change — and then the storage format go — in one place rather than nine.

    The staging is not ceremony. A heat that has just been constructed has no
    id until the session flushes, and the rows need one — so the values are
    left on the instance and ``lane_sync`` writes them when the id exists.
    """
    lane_sync.stage(heat, heat_lanes)


def record_heat_result(
    db: Session, heat_id: int, heat_lanes: Sequence[lanes.Lane] | None
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
    """
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if heat and heat_lanes is not None:
        set_heat_lanes(heat, heat_lanes)
        stamp_recorded(heat, heat_lanes)
        db.commit()
        db.refresh(heat)

        if heat.round:
            invalidate_future_rounds(db, heat.race_id, heat.round.round_number)
            trigger_auto_advancements(db, heat.race_id, heat.round.id)

    return heat


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
        # Group racers by Den
        # We need to get all dens for this race to know ranges
        dens = db.query(models.Den).filter(models.Den.race_id == race_id).all()
        den_map = {d.id: d for d in dens}

        # Pre-bucket racers
        den_racers: dict[int, list[models.Racer]] = {}
        unassigned_racers: list[models.Racer] = []

        for racer in racers:
            if racer.den_id:
                if racer.den_id not in den_racers:
                    den_racers[racer.den_id] = []
                den_racers[racer.den_id].append(racer)
            else:
                unassigned_racers.append(racer)

        # Assign numbers per Den
        for den_id, group_racers in den_racers.items():
            den = den_map.get(den_id)
            if not den or den.car_number_range_start is None:
                continue  # Skip if no config

            # Sort
            group_racers.sort(key=lambda r: (r.last_name, r.first_name))

            current = den.car_number_range_start
            limit = den.car_number_range_end

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

    # Fetch all heats by ID
    heat_ids = [update["heat_id"] for update in heat_updates]
    heats = db.query(models.Heat).filter(models.Heat.id.in_(heat_ids)).all()

    if len(heats) != len(heat_ids):
        raise HTTPException(status_code=404, detail="One or more heat IDs not found")

    # Verify all heats belong to the same round
    round_ids = {heat.round_id for heat in heats}
    if len(round_ids) > 1:
        raise HTTPException(
            status_code=400, detail="Cannot reorder heats from different rounds"
        )

    # Create a mapping of heat_id to new_heat_number
    update_map = {
        update["heat_id"]: update["new_heat_number"] for update in heat_updates
    }

    # Update each heat's heat_number
    for heat in heats:
        if heat.id in update_map:
            heat.heat_number = update_map[heat.id]

    # Commit the transaction
    db.commit()

    # Refresh and return updated heats, sorted by heat_number
    for heat in heats:
        db.refresh(heat)

    return sorted(heats, key=lambda h: h.heat_number)


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
        r.id
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
    # are rebuilt.
    for round_id in rebuildable:
        generate_heats_for_round(db, round_id, clear_existing=True)
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
) -> models.Heat | None:
    """Record results for a free race heat.

    Lanes rather than dicts, for the same reason as
    :func:`create_free_race_heat` — one codec, in ``domain/lanes.py``.
    """
    heat = get_free_race_heat(db, heat_id)
    if heat is None:
        return None
    set_heat_lanes(heat, lane_results)
    stamp_recorded(heat, lane_results)
    db.commit()
    db.refresh(heat)
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


def get_random_lane_assignments(
    db: Session,
    race_id: int,
    lane_count: int,
) -> list[dict]:
    """
    Randomly select `lane_count` checked-in racers and return lane assignments.
    If fewer than `lane_count` racers are checked in, fill remaining lanes with
    empty slots (racer_id=None).
    """
    pool = (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race_id, models.Racer.car_passed_inspection)
        .all()
    )
    random.shuffle(pool)
    selected = pool[:lane_count]

    assignments = []
    for i in range(lane_count):
        racer_id = selected[i].id if i < len(selected) else None
        assignments.append({"lane": i + 1, "racer_id": racer_id})
    return assignments


def bulk_move_racers_to_den(db: Session, racer_ids: list[int], den_id: int | None):
    """Reassign racers to a den, or to none."""
    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).update(
        {"den_id": den_id}, synchronize_session=False
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

    for key, value in award_update.model_dump(exclude_unset=True).items():
        setattr(db_award, key, value)

    # After the update, not before: changing the kind is what makes the other
    # kind's fields stale, and the change and the fields can arrive together.
    _clear_fields_of_other_kind(db_award)

    db.commit()
    db.refresh(db_award)
    return db_award


def _clear_fields_of_other_kind(award: models.Award) -> None:
    """Null whichever half of the row this award's kind does not use."""
    if award.kind is models.AwardKind.SPEED:
        award.racer_id = None
    else:
        award.source = None
        award.place = None
        award.den_id = None


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
