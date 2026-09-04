"""At most one trophy per racer (#615) — the wiring.

The rules live in `test_domain_roll_down.py`, pinned with no database at all.
What is checked here is that `services.awards` and the GraphQL layer read
`Race.one_trophy_per_racer` correctly: the flag off is byte-for-byte the
isolated resolution every race gave before this column existed, the flag on
reaches `domain.roll_down.resolve_awards`, and the `Award` type's `position`,
`passedOver` and `duplicateOf` fields carry its provenance.
"""

from backend.db import crud, models, schemas
from backend.services import awards as awards_service
from backend.tests.test_awards import build_race, race_everyone

ROLL_DOWN_QUERY = """
query RaceAwards($raceId: Int!) {
  race(raceId: $raceId) {
    awards {
      id
      name
      kind
      place
      racingGroupId
      recipient { id firstName lastName }
      position
      passedOver {
        racerId
        awardId
        racer { id firstName }
        award { id name }
      }
      duplicateOf { id name }
    }
  }
}
"""


def _set_one_trophy_per_racer(db, race_id: int, value: bool) -> None:
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    assert race is not None
    race.one_trophy_per_racer = value
    db.commit()


class TestOffIsIsolated:
    def test_the_flag_off_is_byte_for_byte_the_isolated_resolution(self, client, db):
        race_id, _dens, racers = build_race(
            db, racing_groups=("Wolves",), racers_per_den=4
        )
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}
        race_everyone(client, db, race_id, times)

        pack = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="ALL", place=1
            ),
        )
        wolf = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Wolf",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
                racing_group_id=None,
            ),
        )

        # Every race defaults to the flag off, so `recipients_for` (the
        # isolated path) and `resolutions_for` (the roll-down path, flag
        # read off the race) must agree exactly.
        isolated = awards_service.recipients_for(db, race_id)
        resolved = awards_service.resolutions_for(db, race_id)
        assert {k: r.recipient for k, r in resolved.items()} == isolated
        assert all(r.passed_over == () for r in resolved.values())
        assert all(r.duplicate_of is None for r in resolved.values())
        assert resolved[pack.id].position == 1
        assert resolved[wolf.id].position == 1


class TestOnRollsDown:
    def test_a_den_trophy_rolls_down_from_the_pack_champion(self, client, db):
        race_id, _dens, racers = build_race(
            db, racing_groups=("Wolves",), racers_per_den=4
        )
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}
        race_everyone(client, db, race_id, times)
        wolves_group_id = (
            db.query(models.RacingGroup)
            .filter(models.RacingGroup.race_id == race_id)
            .first()
            .id
        )

        pack = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="ALL", place=1
            ),
        )
        wolf = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Wolf",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
                racing_group_id=wolves_group_id,
            ),
        )
        _set_one_trophy_per_racer(db, race_id, True)

        response = client.post(
            "/graphql",
            json={"query": ROLL_DOWN_QUERY, "variables": {"raceId": race_id}},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert "errors" not in body, body["errors"]
        by_id = {a["id"]: a for a in body["data"]["race"]["awards"]}

        # The fastest racer wins the pack championship...
        assert by_id[pack.id]["recipient"]["id"] == racers[0]
        assert by_id[pack.id]["position"] == 1
        assert by_id[pack.id]["passedOver"] == []
        assert by_id[pack.id]["duplicateOf"] is None

        # ...and the Wolf trophy rolls down to the second-fastest Wolf, with
        # the roll explained: who was skipped, and which award they hold.
        assert by_id[wolf.id]["recipient"]["id"] == racers[1]
        assert by_id[wolf.id]["position"] == 2
        assert len(by_id[wolf.id]["passedOver"]) == 1
        passed = by_id[wolf.id]["passedOver"][0]
        assert passed["racerId"] == racers[0]
        assert passed["racer"]["id"] == racers[0]
        assert passed["awardId"] == pack.id
        assert passed["award"]["id"] == pack.id
        assert passed["award"]["name"] == "Fastest Car"

    def test_a_judged_award_reports_a_collision_but_keeps_its_racer(self, client, db):
        race_id, _dens, racers = build_race(
            db, racing_groups=("Wolves",), racers_per_den=4
        )
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}
        race_everyone(client, db, race_id, times)

        pack = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="ALL", place=1
            ),
        )
        best_paint = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Best Paint", kind=models.AwardKind.SPECIAL, racer_id=racers[0]
            ),
        )
        _set_one_trophy_per_racer(db, race_id, True)

        response = client.post(
            "/graphql",
            json={"query": ROLL_DOWN_QUERY, "variables": {"raceId": race_id}},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        by_id = {a["id"]: a for a in body["data"]["race"]["awards"]}

        # The judged award keeps its own pick regardless (a computed rule
        # does not override a person's choice)...
        assert by_id[best_paint.id]["recipient"]["id"] == racers[0]
        # ...but the collision is reported so the operator screen can warn.
        assert by_id[best_paint.id]["duplicateOf"]["id"] == pack.id
        assert by_id[best_paint.id]["duplicateOf"]["name"] == "Fastest Car"
        # And the speed trophy is never displaced by the judged pick.
        assert by_id[pack.id]["recipient"]["id"] == racers[0]
        assert by_id[pack.id]["duplicateOf"] is None


class TestQueryCount:
    def test_resolving_many_awards_with_the_flag_on_costs_the_same_as_one(
        self, client, db
    ):
        """The same guarantee `test_query_counts.py` holds for the isolated
        path: resolving a dozen awards is one scoring pass, not a dozen, and
        the roll-down's own extra work (reading the race's flag) is a fixed
        cost too, not a per-award one.
        """
        from backend.tests.test_query_counts import _QueryCounter

        race_id, dens, racers = build_race(
            db, racing_groups=("Wolves", "Bears"), racers_per_den=4
        )
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}
        race_everyone(client, db, race_id, times)
        _set_one_trophy_per_racer(db, race_id, True)

        crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="ALL", place=1
            ),
        )
        with _QueryCounter() as one_award:
            r = client.post(
                "/graphql",
                json={"query": ROLL_DOWN_QUERY, "variables": {"raceId": race_id}},
            )
        assert "errors" not in r.json(), r.json()

        for den_id in dens:
            crud.create_award(
                db,
                race_id,
                schemas.AwardCreate(
                    name="Fastest in Den",
                    kind=models.AwardKind.SPEED,
                    source="ALL",
                    place=1,
                    racing_group_id=den_id,
                ),
            )
        for place in (2, 3):
            crud.create_award(
                db,
                race_id,
                schemas.AwardCreate(
                    name=f"Place {place}",
                    kind=models.AwardKind.SPEED,
                    source="ALL",
                    place=place,
                ),
            )
        crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Best Paint", kind=models.AwardKind.SPECIAL, racer_id=racers[0]
            ),
        )

        with _QueryCounter() as many_awards:
            r = client.post(
                "/graphql",
                json={"query": ROLL_DOWN_QUERY, "variables": {"raceId": race_id}},
            )
        body = r.json()
        assert "errors" not in body, body["errors"]
        assert len(body["data"]["race"]["awards"]) == 6, (
            "a cheap query that returns nothing proves nothing"
        )
        assert many_awards.count <= one_award.count + 1, (
            f"Six awards cost {many_awards.count} queries against "
            f"{one_award.count} for one; the roll-down's per-race resolution "
            "is scaling with the number of awards."
        )
