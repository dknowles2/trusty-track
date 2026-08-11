"""Chained championship rounds: a semifinal feeding a final (#248–#250).

The wizard has always been able to build "top ten, then top three" — every
championship round after the first draws on ``ROUND:<previous>`` — but the
population rule only fired on the source round's own completion event, so a
final could strand on placeholders with no event left to rescue it. These
tests pin the chain end to end, and the two rescue paths.
"""

from backend.db import crud, models, schemas
from backend.domain import lanes as lanes_module
from backend.domain.audit import ResultSource


def _race(db, name) -> models.Race:
    group = crud.create_group(db, schemas.GroupCreate(name=f"Pack for {name}"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"Track for {name}", lane_count=4, timer_type="FAKE"),
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            group_id=group.id,
            name=name,
            track_id=track.id,
            scoring_strategy=models.ScoringStrategy.TIMED,
        ),
    )


def _racers(db, race_id, count) -> list[int]:
    return [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race_id,
                first_name=f"Racer{n}",
                last_name="Chain",
                car_number=n + 1,
                car_passed_inspection=True,
            ),
        ).id
        for n in range(count)
    ]


def _run_round(db, round_id, seconds_by_racer):
    """Record every heat, giving each racer the same time in every heat."""
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    for heat in heats:
        stored = crud.heat_lanes_of(db, heat)
        racing = [lane for lane in stored if lane.racer_id]
        order = sorted(racing, key=lambda lane: seconds_by_racer[lane.racer_id])
        placed = {lane.racer_id: place for place, lane in enumerate(order, start=1)}
        recorded = [
            lanes_module.Lane(
                lane=lane.lane,
                racer_id=lane.racer_id,
                time=seconds_by_racer[lane.racer_id],
                place=placed[lane.racer_id],
            )
            if lane.racer_id
            else lane
            for lane in stored
        ]
        crud.record_heat_result(db, heat.id, recorded, source=ResultSource.OPERATOR)


def _field(db, round_id) -> tuple[set[int], int]:
    """The racers in a round's lanes, and how many distinct placeholder slots
    remain — a slot appears in several heats, so lanes are the wrong count."""
    racers: set[int] = set()
    slots: set[int] = set()
    for heat in db.query(models.Heat).filter(models.Heat.round_id == round_id).all():
        for lane in crud.heat_lanes_of(db, heat):
            if lane.racer_id:
                racers.add(lane.racer_id)
            elif lane.placeholder_slot is not None:
                slots.add(lane.placeholder_slot)
    return racers, len(slots)


def _chained_race(db, name):
    """Prelims, a top-four semifinal, and a top-two final drawn from it."""
    race = _race(db, name)
    ids = _racers(db, race.id, 6)
    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    crud.generate_heats_for_round(db, prelim.id)
    semi = crud.create_round(
        db,
        race_id=race.id,
        round_number=2,
        advancement_source="PACK",
        advancement_num_racers=4,
    )
    crud.generate_heats_for_round(db, semi.id, num_placeholders=4)
    final = crud.create_round(
        db,
        race_id=race.id,
        round_number=3,
        advancement_source=f"ROUND:{semi.id}",
        advancement_num_racers=2,
    )
    crud.generate_heats_for_round(db, final.id, num_placeholders=2)
    return race, ids, prelim, semi, final


class TestTheChain:
    def test_the_final_draws_on_the_semifinal_not_the_prelims(self, db):
        race, ids, prelim, semi, final = _chained_race(db, "Chain Derby")

        # Prelims: ids[0] fastest, ids[5] slowest.
        _run_round(db, prelim.id, {ids[n]: 3.0 + n * 0.1 for n in range(6)})
        assert _field(db, semi.id) == (set(ids[:4]), 0)
        assert _field(db, final.id) == (set(), 2)

        # Semifinal reverses the form: ids[3] and ids[2] are now fastest.
        _run_round(db, semi.id, {ids[0]: 3.9, ids[1]: 3.8, ids[2]: 3.2, ids[3]: 3.1})
        assert _field(db, final.id) == ({ids[2], ids[3]}, 0)

    def test_a_prelim_correction_does_not_strand_the_final(self, db):
        """#248. The final's field comes from the semifinal, which a prelim
        correction does not touch — but invalidation resets every later
        unraced championship round, and the semifinal never completes *again*
        to re-fire an event-based rule. The state-based rule refills it in the
        same cascade.
        """
        race, ids, prelim, semi, final = _chained_race(db, "Corrected Derby")
        _run_round(db, prelim.id, {ids[n]: 3.0 + n * 0.1 for n in range(6)})
        _run_round(db, semi.id, {ids[0]: 3.9, ids[1]: 3.8, ids[2]: 3.2, ids[3]: 3.1})
        assert _field(db, final.id) == ({ids[2], ids[3]}, 0)

        # The operator corrects a prelim time — ids[5] was actually fastest.
        corrected = {ids[n]: 3.0 + n * 0.1 for n in range(6)}
        corrected[ids[5]] = 2.0
        _run_round(db, prelim.id, corrected)

        # The raced semifinal stands, so the final's source did not move.
        assert _field(db, semi.id) == (set(ids[:4]), 0)
        assert _field(db, final.id) == ({ids[2], ids[3]}, 0)

    def test_populate_asks_about_the_state_now_not_the_event(self, db):
        """#248, the second costume: a round whose source was already complete
        when it was born has no completion event left to wait for.
        """
        race = _race(db, "Late Final Derby")
        ids = _racers(db, race.id, 6)
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        crud.generate_heats_for_round(db, prelim.id)
        _run_round(db, prelim.id, {ids[n]: 3.0 + n * 0.1 for n in range(6)})

        late = crud.create_round(
            db,
            race_id=race.id,
            round_number=2,
            advancement_source="PACK",
            advancement_num_racers=3,
        )
        crud.generate_heats_for_round(db, late.id, num_placeholders=3)

        assert crud.populate_round_if_decided(db, late)
        assert _field(db, late.id) == (set(ids[:3]), 0)


class TestTheResolverPaths:
    def _seeded_race(self, db, name):
        race = _race(db, name)
        ids = _racers(db, race.id, 6)
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        crud.generate_heats_for_round(db, prelim.id)
        _run_round(db, prelim.id, {ids[n]: 3.0 + n * 0.1 for n in range(6)})
        return race, ids

    def test_a_final_created_after_the_prelims_fills_immediately(self, db, client):
        """#248 through the mutation an operator actually reaches."""
        race, ids = self._seeded_race(db, "Race-Day Final Derby")

        response = client.post(
            "/graphql",
            json={
                "query": """
                mutation($raceId: Int!) {
                  createRound(raceId: $raceId, roundData: {
                    name: "Finals",
                    schedulingStrategy: "PPC",
                    advancementSource: "PACK",
                    advancementNumRacers: 3,
                    runsPerLane: 1
                  }) { id }
                }
                """,
                "variables": {"raceId": race.id},
            },
        )
        assert "errors" not in response.json(), response.json()
        round_id = response.json()["data"]["createRound"][0]["id"]

        db.expire_all()
        assert _field(db, round_id) == (set(ids[:3]), 0)

    def test_round_numbers_never_collide_after_a_delete(self, db, client):
        """#250. Numbering from the count reuses a number once a middle round
        is deleted, and two rounds sharing one are invisible to each other in
        advancement's strict ordering.
        """
        race, ids = self._seeded_race(db, "Renumbered Derby")

        def add_round(name):
            response = client.post(
                "/graphql",
                json={
                    "query": """
                    mutation($raceId: Int!, $name: String!) {
                      createRound(raceId: $raceId, roundData: {
                        name: $name,
                        schedulingStrategy: "PPC",
                        advancementSource: "PACK",
                        advancementNumRacers: 3,
                        runsPerLane: 1
                      }) { id }
                    }
                    """,
                    "variables": {"raceId": race.id, "name": name},
                },
            )
            assert "errors" not in response.json(), response.json()
            return response.json()["data"]["createRound"][0]["id"]

        first = add_round("Semifinal")
        add_round("Final")
        crud.delete_round(db, first)
        add_round("Consolation")

        numbers = [
            r.round_number
            for r in db.query(models.Round)
            .filter(models.Round.race_id == race.id)
            .all()
        ]
        assert len(numbers) == len(set(numbers)), numbers

    def test_a_failed_wizard_rolls_back_and_can_run_again(
        self, db, client, monkeypatch
    ):
        """#249. The rollback deleted the general round first, which is
        refused while the championship rounds it also created still exist —
        so the rollback itself failed, the half-made rounds survived their
        own commit, and every later wizard run was refused.
        """
        race = _race(db, "Rollback Derby")
        _racers(db, race.id, 6)

        real = crud.generate_heats_for_round

        def failing(db_arg, round_id, **kwargs):
            if kwargs.get("num_placeholders"):
                raise ValueError("a simulated championship-phase failure")
            return real(db_arg, round_id, **kwargs)

        monkeypatch.setattr(crud, "generate_heats_for_round", failing)

        wizard = """
        mutation($raceId: Int!) {
          createRoundWizard(raceId: $raceId, config: {
            generalRound: { type: "PACK", runsPerLane: 1 },
            championshipRounds: [
              { name: "Final", source: "PACK", numTopRacers: 3, runsPerLane: 1 }
            ]
          }) { id }
        }
        """
        response = client.post(
            "/graphql", json={"query": wizard, "variables": {"raceId": race.id}}
        )
        assert "errors" in response.json()

        db.expire_all()
        leftover = (
            db.query(models.Round).filter(models.Round.race_id == race.id).count()
        )
        assert leftover == 0

        monkeypatch.setattr(crud, "generate_heats_for_round", real)
        retry = client.post(
            "/graphql", json={"query": wizard, "variables": {"raceId": race.id}}
        )
        assert "errors" not in retry.json(), retry.json()
