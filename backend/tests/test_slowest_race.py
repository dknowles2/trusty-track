"""The Slowest Race bracket: a championship round drawn from the wrong end.

``Round.advancement_from_bottom`` flips which end of the standings a
championship round's field is filled from. The source vocabulary is unchanged
(``ALL``, ``EACH_GROUP``, ``ROUND:<id>``); what changes is the pick — slowest first,
and never a car with no recorded result, because a car that never ran is not
the slowest car, it is an absent one.
"""

from backend.db import crud, models, schemas
from backend.domain import advancement
from backend.domain import lanes as lanes_module
from backend.domain.audit import ResultSource


def _standing(racer_id, racing_group_id=None, has_raced=True):
    return advancement.Standing(
        racer_id=racer_id, racing_group_id=racing_group_id, has_raced=has_raced
    )


class TestThePickingRule:
    """Pure rule: `advancing_racer_ids` with `from_bottom`."""

    def test_pack_picks_the_slowest_first(self):
        rule = advancement.AdvancementRule(source="ALL", num_racers=2, from_bottom=True)
        standings = [_standing(1), _standing(2), _standing(3), _standing(4)]
        # Best-first input, so 4 is the slowest — and slot 1 is the slowest
        # car, the mirror of slot 1 being the fastest in an ordinary round.
        assert advancement.advancing_racer_ids(rule, standings) == [4, 3]

    def test_a_car_that_never_ran_is_not_the_slowest(self):
        rule = advancement.AdvancementRule(source="ALL", num_racers=2, from_bottom=True)
        # The leaderboard sorts the unraced below everyone with a result, so
        # the raw bottom of the standings is exactly the wrong answer.
        standings = [
            _standing(1),
            _standing(2),
            _standing(3),
            _standing(9, has_raced=False),
        ]
        assert advancement.advancing_racer_ids(rule, standings) == [3, 2]

    def test_den_picks_the_slowest_of_each_den(self):
        rule = advancement.AdvancementRule(
            source="EACH_GROUP", num_racers=1, from_bottom=True
        )
        standings = [
            _standing(1, racing_group_id=10),
            _standing(2, racing_group_id=20),
            _standing(3, racing_group_id=10),
            _standing(4, racing_group_id=20),
        ]
        assert advancement.advancing_racer_ids(rule, standings, [10, 20]) == [3, 4]

    def test_a_round_scoped_rule_reads_its_round_from_the_bottom(self):
        rule = advancement.AdvancementRule(
            source="ROUND:7", num_racers=1, from_bottom=True
        )
        standings = [_standing(1), _standing(2), _standing(3)]
        assert advancement.advancing_racer_ids(rule, standings) == [3]

    def test_the_default_direction_is_unchanged(self):
        rule = advancement.AdvancementRule(source="ALL", num_racers=2)
        standings = [_standing(1), _standing(2), _standing(3)]
        assert advancement.advancing_racer_ids(rule, standings) == [1, 2]


# --------------------------------------------------------------------------- #
# Against the database                                                        #
# --------------------------------------------------------------------------- #


def _race(db, name) -> models.Race:
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Pack for {name}")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"Track for {name}", lane_count=4, timer_type="FAKE"),
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            organization_id=group.id,
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
                last_name="Turtle",
                car_number=n + 1,
                car_passed_inspection=True,
            ),
        ).id
        for n in range(count)
    ]


def _run_round(db, round_id, seconds_by_racer, skip_racers=frozenset()):
    """Record every heat; racers in ``skip_racers`` are skipped instead."""
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    for heat in heats:
        stored = crud.heat_lanes_of(db, heat)
        racing = [
            lane
            for lane in stored
            if lane.racer_id and lane.racer_id not in skip_racers
        ]
        order = sorted(racing, key=lambda lane: seconds_by_racer[lane.racer_id])
        placed = {lane.racer_id: place for place, lane in enumerate(order, start=1)}
        recorded = []
        for lane in stored:
            if lane.racer_id in skip_racers:
                recorded.append(
                    lanes_module.Lane(
                        lane=lane.lane, racer_id=lane.racer_id, skipped=True
                    )
                )
            elif lane.racer_id:
                recorded.append(
                    lanes_module.Lane(
                        lane=lane.lane,
                        racer_id=lane.racer_id,
                        time=seconds_by_racer[lane.racer_id],
                        place=placed[lane.racer_id],
                    )
                )
            else:
                recorded.append(lane)
        crud.record_heat_result(db, heat.id, recorded, source=ResultSource.OPERATOR)


def _field(db, round_id) -> tuple[set[int], int]:
    racers: set[int] = set()
    slots: set[int] = set()
    for heat in db.query(models.Heat).filter(models.Heat.round_id == round_id).all():
        for lane in crud.heat_lanes_of(db, heat):
            if lane.racer_id:
                racers.add(lane.racer_id)
            elif lane.placeholder_slot is not None:
                slots.add(lane.placeholder_slot)
    return racers, len(slots)


def _slowest_race(db, name, racer_count=6, bracket_size=3):
    """Prelims plus a slowest-N bracket waiting on them."""
    race = _race(db, name)
    ids = _racers(db, race.id, racer_count)
    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    crud.generate_heats_for_round(db, prelim.id)
    bracket = crud.create_round(
        db,
        race_id=race.id,
        round_number=2,
        advancement_source="ALL",
        advancement_num_racers=bracket_size,
        advancement_from_bottom=True,
    )
    crud.generate_heats_for_round(db, bracket.id, num_placeholders=bracket_size)
    return race, ids, prelim, bracket


class TestTheBracket:
    def test_the_field_is_the_slowest_cars(self, db):
        race, ids, prelim, bracket = _slowest_race(db, "Turtle Derby")

        # ids[0] fastest, ids[5] slowest.
        _run_round(db, prelim.id, {ids[n]: 3.0 + n * 0.1 for n in range(6)})

        assert _field(db, bracket.id) == (set(ids[3:]), 0)

    def test_a_prelim_correction_re_fields_the_bracket(self, db):
        race, ids, prelim, bracket = _slowest_race(db, "Corrected Turtle Derby")
        _run_round(db, prelim.id, {ids[n]: 3.0 + n * 0.1 for n in range(6)})
        assert _field(db, bracket.id) == (set(ids[3:]), 0)

        # The fastest car's time is corrected to the slowest of all — the
        # invalidation cascade resets the unraced bracket and repopulates it
        # from the standings as they now are.
        heats = db.query(models.Heat).filter(models.Heat.round_id == prelim.id).all()
        for heat in heats:
            stored = crud.heat_lanes_of(db, heat)
            if not any(lane.racer_id == ids[0] for lane in stored):
                continue
            corrected = [
                lanes_module.Lane(
                    lane=lane.lane,
                    racer_id=lane.racer_id,
                    time=9.0 if lane.racer_id == ids[0] else lane.seconds,
                    place=lane.place,
                )
                for lane in stored
            ]
            crud.record_heat_result(
                db, heat.id, corrected, source=ResultSource.OPERATOR
            )

        field, slots = _field(db, bracket.id)
        assert ids[0] in field
        assert slots == 0

    def test_a_car_skipped_out_of_every_heat_is_not_picked(self, db):
        race, ids, prelim, bracket = _slowest_race(
            db, "Skipped Turtle Derby", racer_count=4, bracket_size=2
        )

        # ids[3] never records a time: every one of its lanes is skipped. The
        # round is still complete (a skipped lane settles), and its infinite
        # score sits at the very bottom of the standings — exactly where a
        # naive bottom-of-the-list pick would find it.
        _run_round(
            db,
            prelim.id,
            {ids[n]: 3.0 + n * 0.1 for n in range(3)},
            skip_racers={ids[3]},
        )

        assert _field(db, bracket.id) == ({ids[1], ids[2]}, 0)


CREATE_ROUND = """
mutation Create($raceId: Int!, $roundData: RoundCreateInput!) {
    createRound(raceId: $raceId, roundData: $roundData) {
        id name advancementFromBottom
        advancementStatus { fromBottom }
    }
}
"""


class TestTheResolver:
    def test_a_bracket_added_after_the_prelims_fills_immediately(self, db, client):
        race = _race(db, "Late Turtle Derby")
        ids = _racers(db, race.id, 5)
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        crud.generate_heats_for_round(db, prelim.id)
        _run_round(db, prelim.id, {ids[n]: 3.0 + n * 0.1 for n in range(5)})

        body = client.post(
            "/graphql",
            json={
                "query": CREATE_ROUND,
                "variables": {
                    "raceId": race.id,
                    "roundData": {
                        "advancementSource": "ALL",
                        "advancementNumRacers": 2,
                        "advancementFromBottom": True,
                    },
                },
            },
        ).json()
        assert "errors" not in body, body

        (made,) = body["data"]["createRound"]
        # The default name says what the round is, in the operator's words.
        assert made["name"] == "Slowest Race"
        assert made["advancementFromBottom"] is True
        assert made["advancementStatus"]["fromBottom"] is True

        db.expire_all()
        assert _field(db, made["id"]) == ({ids[3], ids[4]}, 0)
