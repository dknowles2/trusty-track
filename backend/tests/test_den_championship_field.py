"""A DEN championship round keeping its whole field (#52).

``advancement_num_racers`` is per *den* when the source is ``DEN``. Getting
that wrong does not fail loudly — the round simply comes back with fewer heats
and fewer racers, and the ones dropped are racers who had qualified for it.
"""

from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import lanes
from backend.services import scoring
from backend.tests.helpers import as_lanes, lane_dicts

DENS = 2
PER_DEN = 2


def _race(db: Session, label: str, den_count: int = DENS, racers: int = 6):
    crud.create_initial_config(
        db,
        schemas.InitialConfigCreate(
            group_name=f"G{label}",
            tracks=[
                schemas.TrackCreate(
                    name=f"T{label}",
                    lane_count=4,
                    length_feet=40,
                    timer_type=models.TimerType.FAKE,
                )
            ],
        ),
    )
    group = db.query(models.Group).filter(models.Group.name == f"G{label}").one()
    track = db.query(models.Track).filter(models.Track.name == f"T{label}").one()
    crud.create_race(
        db, schemas.RaceCreate(name=f"R{label}", group_id=group.id, track_id=track.id)
    )
    race = db.query(models.Race).filter(models.Race.name == f"R{label}").one()

    dens = [
        crud.create_den(
            db,
            schemas.DenCreate(name=f"{label}Den{i}", color="#000000", rank="WOLF"),
            race.id,
        )
        for i in range(den_count)
    ]
    for i in range(racers):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"R{i}",
                last_name="T",
                car_number=i + 1,
                race_id=race.id,
                den_id=dens[i % den_count].id,
                car_passed_inspection=True,
            ),
        )
    db.commit()
    return race, dens


def _rounds(db: Session, race, source: str, num_racers: int, slots: int):
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Finals",
        advancement_source=source,
        advancement_num_racers=num_racers,
    )
    db.flush()
    crud.generate_heats_for_round(db, r2.id, num_placeholders=slots)
    return r1, r2


def _slots(db: Session, race, round_obj) -> set[int]:
    return {
        lane.placeholder_slot
        for heat in crud.get_heats(db, race.id, round_id=round_obj.id)
        for lane in crud.heat_lanes_of(db, heat)
        if lane.is_placeholder
    }


def _run_round(db: Session, race, round_obj) -> None:
    for heat in crud.get_heats(db, race.id, round_id=round_obj.id):
        results = lane_dicts(db, heat)
        for res in results:
            rid = res.get("racer_id")
            if rid is None or rid < 0:
                continue
            res["time"] = 1.0 + rid / 100.0
        crud.record_heat_result(db, heat.id, as_lanes(results))


def test_invalidation_keeps_every_den_slot(db: Session):
    """The bug: 4 slots became 2 the moment anything was recorded."""
    race, _ = _race(db, "keep")
    _, r2 = _rounds(db, race, "DEN", PER_DEN, slots=DENS * PER_DEN)
    assert len(_slots(db, race, r2)) == DENS * PER_DEN

    crud.invalidate_future_rounds(db, race.id, 1)

    assert len(_slots(db, race, r2)) == DENS * PER_DEN


def test_everyone_who_qualifies_races_the_final(db: Session):
    """What it cost: two kids who earned a place did not get to race."""
    race, _ = _race(db, "final")
    r1, r2 = _rounds(db, race, "DEN", PER_DEN, slots=DENS * PER_DEN)

    _run_round(db, race, r1)

    qualified = set(scoring.get_advancing_racers(db, race.id, "DEN", PER_DEN))
    finalists = {
        racer_id
        for heat in crud.get_heats(db, race.id, round_id=r2.id)
        for racer_id in lanes.real_racer_ids(crud.heat_lanes_of(db, heat))
    }
    assert qualified == finalists


def test_a_pack_round_is_not_multiplied(db: Session):
    """`num_racers` is absolute for PACK. Multiplying it would be the mirror bug."""
    race, _ = _race(db, "pack")
    _, r2 = _rounds(db, race, "PACK", 4, slots=4)

    crud.invalidate_future_rounds(db, race.id, 1)

    assert len(_slots(db, race, r2)) == 4


def test_a_round_scoped_round_is_not_multiplied(db: Session):
    race, _ = _race(db, "scoped")
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Finals",
        advancement_source=f"ROUND:{r1.id}",
        advancement_num_racers=3,
    )
    db.flush()
    crud.generate_heats_for_round(db, r2.id, num_placeholders=3)

    crud.invalidate_future_rounds(db, race.id, 1)

    assert len(_slots(db, race, r2)) == 3


def test_the_den_count_is_read_when_it_matters(db: Session):
    """Three dens, top two each — six slots, not two and not four."""
    race, _ = _race(db, "three", den_count=3, racers=9)
    _, r2 = _rounds(db, race, "DEN", PER_DEN, slots=3 * PER_DEN)

    crud.invalidate_future_rounds(db, race.id, 1)

    assert len(_slots(db, race, r2)) == 3 * PER_DEN


def _gql(client, query: str, variables: dict) -> dict:
    resp = client.post("/graphql", json={"query": query, "variables": variables})
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("errors") is None, body
    return body["data"]


def test_creating_a_den_round_sizes_it_correctly(client, db: Session):
    """`createRound` carried the same wrong copy as invalidation.

    Driven through the mutation, not through `round_field_size` — the bug is
    which number the resolver passes, so a test that calls the helper passes
    whatever the resolver does. (Learned the hard way in #48, and again here:
    the first version of this test could not tell the fix from the bug.)
    """
    race, _ = _race(db, "created")
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    db.commit()

    data = _gql(
        client,
        """
        mutation Create($raceId: Int!, $roundData: RoundCreateInput!) {
            createRound(raceId: $raceId, roundData: $roundData) { id }
        }
        """,
        {
            "raceId": race.id,
            "roundData": {
                "name": "Finals",
                "advancementSource": "DEN",
                "advancementNumRacers": PER_DEN,
            },
        },
    )
    db.expire_all()
    round_id = data["createRound"][0]["id"]
    r2 = db.query(models.Round).filter(models.Round.id == round_id).one()

    assert len(_slots(db, race, r2)) == DENS * PER_DEN


def test_the_wizard_sizes_a_den_round_correctly(client, db: Session):
    """The one place that already had it right. It has to stay right."""
    race, _ = _race(db, "wizard")
    db.commit()

    _gql(
        client,
        """
        mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }
        """,
        {
            "raceId": race.id,
            "config": {
                "generalRound": {"type": "PACK", "runsPerLane": 1},
                "championshipRounds": [
                    {
                        "name": "Finals",
                        "source": "DEN",
                        "numTopRacers": PER_DEN,
                        "runsPerLane": 1,
                    }
                ],
            },
        },
    )
    db.expire_all()
    champ = (
        db.query(models.Round)
        .filter(
            models.Round.race_id == race.id,
            models.Round.advancement_source == "DEN",
        )
        .one()
    )

    assert len(_slots(db, race, champ)) == DENS * PER_DEN


def test_total_participants_uses_the_same_rule(db: Session):
    """The fifth copy, now delegating rather than repeating.

    Nothing in production reaches its DEN branch since `round_field_size`
    started passing a correct non-zero count — `generate_heats_for_round` only
    falls back to this property when asked for zero placeholders. Pinned
    directly because the property is public, and because a rule with five
    copies is how #52 happened in the first place.
    """
    race, _ = _race(db, "total")
    champ = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Finals",
        advancement_source="DEN",
        advancement_num_racers=PER_DEN,
    )
    db.flush()
    assert champ.total_participants == DENS * PER_DEN

    pack = crud.create_round(
        db,
        race.id,
        3,
        models.SchedulingStrategy.PPC,
        "Pack Finals",
        advancement_source="PACK",
        advancement_num_racers=PER_DEN,
    )
    db.flush()
    assert pack.total_participants == PER_DEN


def test_invalidation_puts_an_advanced_round_back_to_placeholders(db: Session):
    """What invalidation is *for*, and what nothing was checking.

    Mutation-testing the in-place reset found that skipping the lane rewrite
    altogether passed the whole suite: every existing test invalidated a round
    that still held placeholders, so "reset it" and "leave it alone" looked the
    same. This one advances the round first, so they cannot.
    """
    race, _ = _race(db, "reset")
    r1, r2 = _rounds(db, race, "PACK", 4, slots=4)

    _run_round(db, race, r1)
    advanced = {
        racer_id
        for heat in crud.get_heats(db, race.id, round_id=r2.id)
        for racer_id in lanes.real_racer_ids(crud.heat_lanes_of(db, heat))
    }
    assert advanced, "the round should hold real racers before we invalidate it"

    crud.invalidate_future_rounds(db, race.id, 1)

    assert len(_slots(db, race, r2)) == 4
    assert not [
        racer_id
        for heat in crud.get_heats(db, race.id, round_id=r2.id)
        for racer_id in lanes.real_racer_ids(crud.heat_lanes_of(db, heat))
    ]


def test_a_round_whose_shape_changed_is_regenerated(db: Session):
    """In-place reset only works while the heat count matches.

    Adding a den changes a DEN round's slot count, so the same rows cannot be
    rewritten and the round has to be rebuilt properly.
    """
    race, _ = _race(db, "reshape")
    _, r2 = _rounds(db, race, "DEN", PER_DEN, slots=DENS * PER_DEN)
    assert len(crud.get_heats(db, race.id, round_id=r2.id)) == DENS * PER_DEN

    crud.create_den(
        db,
        schemas.DenCreate(name="reshapeDenExtra", color="#000000", rank="WOLF"),
        race.id,
    )
    db.commit()

    crud.invalidate_future_rounds(db, race.id, 1)

    expected = (DENS + 1) * PER_DEN
    assert len(_slots(db, race, r2)) == expected
    assert len(crud.get_heats(db, race.id, round_id=r2.id)) == expected
