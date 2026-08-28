from __future__ import annotations

import json
import random
from collections.abc import Sequence
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend import demo_seed
from backend.domain import (
    advancement,
    audit,
    awards,
    balanced,
    elimination,
    lanes,
    latecomers,
    scheduling,
)

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
    # Ordered: an unordered query with offset/limit pages arbitrarily, and
    # `populate` deals seeded den assignments from this list (`demo_seed`).
    return (
        db.query(models.Den)
        .filter(models.Den.race_id == race_id)
        .order_by(models.Den.id)
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
        den_id=den_id,
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
    eligible = set(_eligible_racer_ids(db, round_obj.race_id, round_obj.den_id))
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

    eligible = set(_eligible_racer_ids(db, round_obj.race_id, round_obj.den_id))
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
            # Sorted because set iteration order is not a promise, and the
            # PPC shuffle downstream may be seeded (`demo_seed`).
            p_ids = sorted(current_racers)
        else:
            p_ids = scheduling.placeholder_ids(round_obj.total_participants)
    else:
        query = db.query(models.Racer).filter(
            models.Racer.race_id == race_id, models.Racer.car_passed_inspection
        )
        if round_obj.den_id:
            query = query.filter(models.Racer.den_id == round_obj.den_id)
        # Ordered because the PPC shuffle downstream may be seeded
        # (`demo_seed`), and it is only as repeatable as its input order.
        racers = query.order_by(models.Racer.id).all()
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
    """Bring existing heats into line with a lane going out of service (#171).

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
    out_of_service = set(lane_outages_for_track(db, track_id))
    if not out_of_service:
        return []

    disrupted_round_ids: list[int] = []
    races = db.query(models.Race).filter(models.Race.track_id == track_id).all()

    for race in races:
        usable = usable_lanes_for_race(db, race.id)
        rounds = db.query(models.Round).filter(models.Round.race_id == race.id).all()

        for round_obj in rounds:
            heats = [
                h
                for h in db.query(models.Heat)
                .filter(models.Heat.round_id == round_obj.id)
                .all()
                if h.kind is models.HeatKind.OFFICIAL
            ]
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
                    generate_heats_for_round(db, round_obj.id, clear_existing=True)
                continue

            vacated = False
            for heat in pending:
                current = heat_lanes_of(db, heat)
                if not any(lane.lane in out_of_service for lane in current):
                    continue
                set_heat_lanes(
                    heat,
                    [lane for lane in current if lane.lane not in out_of_service],
                )
                vacated = True

            if vacated and not round_obj.disrupted:
                round_obj.disrupted = True
                disrupted_round_ids.append(round_obj.id)

    db.commit()
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

    for round_obj in rounds:
        heats = [
            h
            for h in db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id)
            .all()
            if h.kind is models.HeatKind.OFFICIAL
        ]
        if not heats:
            # Not generated yet; whenever it is, it will field whoever has
            # checked in by then.
            continue

        eligible = _eligible_racer_ids(db, race_id, round_obj.den_id)
        heat_lanes = lanes_for_heats(db, heats)
        already = {
            racer_id for heat in heat_lanes for racer_id in lanes.real_racer_ids(heat)
        }
        missing = [racer_id for racer_id in eligible if racer_id not in already]
        if not missing or not usable:
            continue

        if advancement.may_rebuild(heat_lanes):
            generate_heats_for_round(db, round_obj.id, clear_existing=True)
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

        if not round_obj.disrupted:
            round_obj.disrupted = True
            disrupted_round_ids.append(round_obj.id)

    db.commit()
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
        heats = [
            h
            for h in db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id)
            .all()
            if h.kind is models.HeatKind.OFFICIAL
        ]
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
            eligible = _eligible_racer_ids(db, race_id, round_obj.den_id)
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


def _eligible_racer_ids(db: Session, race_id: int, den_id: int | None) -> list[int]:
    """Who a general round's field is drawn from — the same query the generator uses."""
    query = db.query(models.Racer).filter(
        models.Racer.race_id == race_id, models.Racer.car_passed_inspection
    )
    if den_id:
        query = query.filter(models.Racer.den_id == den_id)
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
        return elimination.is_decided(
            elimination.losses_by_racer(heat_lanes),
            round_obj.elimination_losses or 1,
        )
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
    or ``None`` if there isn't one (#307).

    ``updateHeatResult`` and ``recordFreeRaceResult`` replace a heat's whole
    lane set with whatever a client sends, and until now nothing checked it
    before it reached the table: an empty list wiped the schedule, a partial
    list dropped the lanes it omitted, and a nonexistent racer id surfaced as
    a raw ``sqlite3.IntegrityError``. This is the guard the armed-heat write
    path already had (``_record_results`` verifies the lane assignment it
    armed with) and the direct edit path did not.

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
            eligible = _eligible_racer_ids(db, round_obj.race_id, round_obj.den_id)
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
    else:
        award.source = None
        award.place = None
        award.from_bottom = False
        award.den_id = None


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
        source=award.source or awards.PACK,
        place=award.place,
        den_id=award.den_id,
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


# --- Practice race (#201) -----------------------------------------------


#: The name of the track a practice race falls back to creating.
PRACTICE_TRACK_NAME = "Practice Track"

#: The stem every practice race is named from. It has to be recognisable at a
#: glance on the Home page — the whole point is that nobody confuses it with
#: the real event.
PRACTICE_RACE_NAME = "Practice Race"

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

    Counts up rather than stamping a timestamp: an operator rehearsing twice
    should see "Practice Race" and "Practice Race 2", not two names with
    seconds in them.
    """
    taken = {
        name
        for (name,) in db.query(models.Race.name)
        .filter(models.Race.name.like(f"{PRACTICE_RACE_NAME}%"))
        .all()
    }
    if PRACTICE_RACE_NAME not in taken:
        return PRACTICE_RACE_NAME
    suffix = 2
    while f"{PRACTICE_RACE_NAME} {suffix}" in taken:
        suffix += 1
    return f"{PRACTICE_RACE_NAME} {suffix}"


def create_practice_race(db: Session) -> models.Race:
    """A whole event, ready to run, on a fake timer (#201).

    The operator is a parent volunteer who uses this app once a year, and the
    night before is when they want to find out what race day feels like.
    Everything needed already existed — `populate` builds a believable roster
    and the fake timer runs heats without hardware — but neither was reachable
    as a rehearsal: it took creating a race, adding dens, populating, checking
    everybody in and running the round wizard, which is most of the thing being
    rehearsed.

    It includes a championship round on purpose. Advancement is the part of
    race day that surprises people, and a rehearsal that stops before the final
    leaves out the bit worth practising.
    """
    from backend.db import populate

    group = db.query(models.Group).order_by(models.Group.id).first()
    if group is None:
        raise ValueError("Set the system up before creating a practice race")

    track = practice_track(db)

    race = create_race(
        db,
        schemas.RaceCreate(
            name=_next_practice_name(db),
            group_id=group.id,
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
        assign_dens=True,
        check_in=True,
    )

    prelim = create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "All Pack")
    generate_heats_for_round(db, prelim.id, clear_existing=True)

    final = create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Final",
        advancement_source="PACK",
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
