"""Awards, from the table through to GraphQL (#170).

The rules live in `test_domain_awards.py`. What is checked here is the wiring:
that a speed award reads the standings it names, that it stays right when a
result changes, and that the storage does not let the two kinds bleed into each
other.
"""

from backend.db import crud, models, schemas
from backend.services import awards as awards_service
from backend.tests.helpers import record_heat_result

AWARDS_QUERY = """
query RaceAwards($raceId: Int!) {
  race(raceId: $raceId) {
    awards {
      id
      name
      kind
      place
      source
      sortOrder
      den { id name }
      recipient { id firstName }
    }
  }
}
"""


def build_race(db, *, dens=("Wolves",), racers_per_den=3):
    """A race with dens, racers and one general round, ready to be raced."""
    group = crud.create_group(db, schemas.GroupCreate(name="Pack 42"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Awards Track", lane_count=4)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Awards Race", group_id=group.id, track_id=track.id),
    )

    den_ids = []
    racer_ids = []
    number = 100
    for den_name in dens:
        den = crud.create_den(db, schemas.DenCreate(name=den_name), race.id)
        den_ids.append(den.id)
        for _ in range(racers_per_den):
            number += 1
            racer = crud.create_racer(
                db,
                schemas.RacerCreate(
                    first_name=f"Racer{number}",
                    last_name=den_name,
                    car_number=number,
                    den_id=den.id,
                    race_id=race.id,
                    car_passed_inspection=True,
                ),
            )
            racer_ids.append(racer.id)
    return race.id, den_ids, racer_ids


def race_everyone(client, db, race_id, times_by_racer):
    """Generate a round and record every heat, giving each racer a fixed time."""
    round_ = crud.create_round(db, race_id=race_id, round_number=1, name="Prelims")
    crud.generate_heats_for_round(db, round_.id)
    for heat in crud.get_heats(db, race_id, round_id=round_.id):
        entries = []
        for lane in crud.heat_lanes_of(db, heat):
            if lane.racer_id is None:
                continue
            entries.append(
                {
                    "lane": lane.lane,
                    "racer_id": lane.racer_id,
                    "time": times_by_racer[lane.racer_id],
                }
            )
        record_heat_result(client, heat.id, entries)
    return round_.id


class TestSpeedAwardsReadTheStandings:
    def test_first_place_goes_to_the_fastest_car(self, client, db):
        race_id, _dens, racers = build_race(db, racers_per_den=4)
        # Ascending times, so the first racer is fastest.
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}
        race_everyone(client, db, race_id, times)

        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="PACK", place=1
            ),
        )

        assert awards_service.recipients_for(db, race_id)[award.id] == racers[0]

    def test_the_recipient_follows_a_corrected_time(self, client, db):
        # The whole reason a speed award names a source rather than a winner.
        # An award defined before the racing has to still be right after it.
        race_id, _dens, racers = build_race(db, racers_per_den=4)
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}
        round_id = race_everyone(client, db, race_id, times)

        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="PACK", place=1
            ),
        )
        assert awards_service.recipients_for(db, race_id)[award.id] == racers[0]

        # The operator finds a mistyped time and fixes it: the slowest car was
        # actually the fastest.
        slowest = racers[-1]
        for heat in crud.get_heats(db, race_id, round_id=round_id):
            entries = []
            for lane in crud.heat_lanes_of(db, heat):
                if lane.racer_id is None:
                    continue
                time = 0.5 if lane.racer_id == slowest else times[lane.racer_id]
                entries.append(
                    {"lane": lane.lane, "racer_id": lane.racer_id, "time": time}
                )
            record_heat_result(client, heat.id, entries)

        assert awards_service.recipients_for(db, race_id)[award.id] == slowest

    def test_a_den_award_reads_only_that_den(self, client, db):
        race_id, dens, racers = build_race(
            db, dens=("Wolves", "Bears"), racers_per_den=3
        )
        # Wolves are racers[0:3] and are slower than the Bears.
        times = {racer_id: 4.0 + i for i, racer_id in enumerate(racers[:3])}
        times.update({racer_id: 3.0 + i for i, racer_id in enumerate(racers[3:])})
        race_everyone(client, db, race_id, times)

        fastest_wolf = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Wolf",
                kind=models.AwardKind.SPEED,
                source="PACK",
                place=1,
                den_id=dens[0],
            ),
        )
        recipients = awards_service.recipients_for(db, race_id)
        # Not the fastest car in the race, which is a Bear.
        assert recipients[fastest_wolf.id] == racers[0]

    def test_an_award_nobody_has_won_yet_has_no_recipient(self, db):
        race_id, _dens, _racers = build_race(db)
        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="PACK", place=1
            ),
        )
        # Nothing has been raced, so the standings are empty.
        assert awards_service.recipients_for(db, race_id)[award.id] is None

    def test_a_speed_award_missing_its_rule_resolves_to_nobody(self, db):
        # Rather than raising: an award nobody can win is visible on the
        # operator screen, and an exception takes down the presentation display
        # in the middle of the ceremony.
        race_id, _dens, _racers = build_race(db)
        award = models.Award(
            race_id=race_id, name="Broken", kind=models.AwardKind.SPEED
        )
        db.add(award)
        db.commit()
        assert awards_service.recipients_for(db, race_id)[award.id] is None


class TestSlowestCarAwards:
    """A speed award can read the standings from the other end.

    Plenty of packs give a trophy for the slowest car. The rules are in
    `test_domain_awards.py`; what matters here is that the real leaderboard
    reaches the rule with `has_raced` on it, because that is the field the
    domain needs and nothing else in awards reads.
    """

    def test_the_trophy_goes_to_the_slowest_car(self, client, db):
        race_id, _dens, racers = build_race(db, racers_per_den=4)
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}
        race_everyone(client, db, race_id, times)

        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Slowest Car",
                kind=models.AwardKind.SPEED,
                source="PACK",
                place=1,
                from_bottom=True,
            ),
        )

        assert awards_service.recipients_for(db, race_id)[award.id] == racers[-1]

    def test_a_car_that_has_not_raced_yet_does_not_win_it(self, client, db):
        # A scheduled racer is on the leaderboard from the moment the round is
        # generated, sorted below everyone with a result. Without `has_raced`
        # the slowest-car trophy goes to whoever has not run yet — which is
        # every car, in the middle of the first round.
        #
        # Eight racers on a four-lane track, so the first heat is half the
        # field and the other half is scheduled and unraced. Four would put
        # everybody in heat one and prove nothing.
        race_id, _dens, racers = build_race(db, racers_per_den=8)
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}

        round_ = crud.create_round(db, race_id=race_id, round_number=1, name="Prelims")
        crud.generate_heats_for_round(db, round_.id)
        heats = crud.get_heats(db, race_id, round_id=round_.id)

        # Only the first heat is run, so the rest of the field is scheduled and
        # unraced.
        raced = []
        entries = []
        for lane in crud.heat_lanes_of(db, heats[0]):
            if lane.racer_id is None:
                continue
            raced.append(lane.racer_id)
            entries.append(
                {
                    "lane": lane.lane,
                    "racer_id": lane.racer_id,
                    "time": times[lane.racer_id],
                }
            )
        record_heat_result(client, heats[0].id, entries)

        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Slowest Car",
                kind=models.AwardKind.SPEED,
                source="PACK",
                place=1,
                from_bottom=True,
            ),
        )

        slowest_so_far = max(raced, key=lambda racer_id: times[racer_id])
        assert awards_service.recipients_for(db, race_id)[award.id] == slowest_so_far

    def test_a_den_slowest_award_reads_only_that_den(self, client, db):
        race_id, dens, racers = build_race(
            db, dens=("Wolves", "Bears"), racers_per_den=3
        )
        # Wolves are racers[0:3] and are all faster than the Bears, so the
        # slowest car in the race is a Bear.
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers[:3])}
        times.update({racer_id: 6.0 + i for i, racer_id in enumerate(racers[3:])})
        race_everyone(client, db, race_id, times)

        slowest_wolf = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Slowest Wolf",
                kind=models.AwardKind.SPEED,
                source="PACK",
                place=1,
                den_id=dens[0],
                from_bottom=True,
            ),
        )

        assert awards_service.recipients_for(db, race_id)[slowest_wolf.id] == racers[2]

    def test_the_direction_round_trips_through_graphql(self, client, db):
        race_id, _dens, _racers = build_race(db)
        created = client.post(
            "/graphql",
            json={
                "query": """
                mutation($raceId: Int!, $award: AwardInput!) {
                  createAward(raceId: $raceId, award: $award) {
                    id fromBottom place
                  }
                }
                """,
                "variables": {
                    "raceId": race_id,
                    "award": {
                        "name": "Slowest Car",
                        "kind": "SPEED",
                        "source": "PACK",
                        "place": 1,
                        "fromBottom": True,
                    },
                },
            },
        ).json()["data"]["createAward"]

        assert created["fromBottom"] is True

        # And it can be switched back, which an absent-means-leave-alone
        # update would quietly refuse.
        updated = client.post(
            "/graphql",
            json={
                "query": """
                mutation($id: Int!, $award: AwardInput!) {
                  updateAward(id: $id, award: $award) { fromBottom }
                }
                """,
                "variables": {
                    "id": created["id"],
                    "award": {
                        "name": "Fastest Car",
                        "kind": "SPEED",
                        "source": "PACK",
                        "place": 1,
                        "fromBottom": False,
                    },
                },
            },
        ).json()["data"]["updateAward"]

        assert updated["fromBottom"] is False


class TestSpecialAwards:
    def test_the_recipient_is_whoever_was_chosen(self, db):
        race_id, _dens, racers = build_race(db)
        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Best Paint",
                kind=models.AwardKind.SPECIAL,
                racer_id=racers[1],
            ),
        )
        assert awards_service.recipients_for(db, race_id)[award.id] == racers[1]

    def test_an_unassigned_award_has_no_recipient(self, db):
        race_id, _dens, _racers = build_race(db)
        award = crud.create_award(db, race_id, schemas.AwardCreate(name="Best Paint"))
        assert awards_service.recipients_for(db, race_id)[award.id] is None

    def test_deleting_the_racer_un_assigns_rather_than_deleting_the_trophy(self, db):
        # `ON DELETE SET NULL`, not cascade. The award still exists and can be
        # given to somebody else.
        race_id, _dens, racers = build_race(db)
        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Best Paint", kind=models.AwardKind.SPECIAL, racer_id=racers[0]
            ),
        )
        crud.delete_racer(db, racers[0])
        db.expire_all()

        assert crud.get_awards(db, race_id) != []
        assert awards_service.recipients_for(db, race_id)[award.id] is None


class TestTheTwoKindsDoNotBleed:
    def test_a_special_award_cannot_keep_a_source(self, db):
        race_id, _dens, _racers = build_race(db)
        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Best Paint",
                kind=models.AwardKind.SPECIAL,
                source="PACK",
                place=1,
            ),
        )
        assert award.source is None
        assert award.place is None

    def test_a_speed_award_cannot_keep_a_hand_picked_racer(self, db):
        race_id, _dens, racers = build_race(db)
        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car",
                kind=models.AwardKind.SPEED,
                source="PACK",
                place=1,
                racer_id=racers[0],
            ),
        )
        assert award.racer_id is None

    def test_switching_kind_clears_the_fields_that_no_longer_apply(self, db):
        # The update arrives as one payload, so the clearing has to happen
        # after the new kind is applied rather than before.
        race_id, _dens, racers = build_race(db)
        award = crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="PACK", place=1
            ),
        )
        crud.update_award(
            db,
            award.id,
            schemas.AwardUpdate(
                name="Judges' Choice",
                kind=models.AwardKind.SPECIAL,
                racer_id=racers[0],
            ),
        )
        db.refresh(award)
        assert award.source is None
        assert award.place is None
        assert award.from_bottom is False
        assert award.racer_id == racers[0]


class TestOrdering:
    def test_saving_an_award_leaves_the_running_order_alone(self, db):
        """The edit form sends every field, and never offers `sort_order`.

        `AwardInput` has one, so `strawberry.asdict` makes it an explicit null
        on every save — and the column is NOT NULL. Without the guard this is
        an IntegrityError the moment anybody picks a winner for a judged award.
        """
        race_id, _dens, racers = build_race(db)
        crud.create_award(db, race_id, schemas.AwardCreate(name="Best Paint"))
        second = crud.create_award(
            db, race_id, schemas.AwardCreate(name="Most Original")
        )
        order_before = second.sort_order

        crud.update_award(
            db,
            second.id,
            schemas.AwardUpdate(
                name="Most Original",
                kind=models.AwardKind.SPECIAL,
                source=None,
                place=None,
                den_id=None,
                racer_id=racers[0],
                sort_order=None,
            ),
        )

        db.refresh(second)
        assert second.racer_id == racers[0]
        assert second.sort_order == order_before

    def test_new_awards_go_to_the_end(self, db):
        race_id, _dens, _racers = build_race(db)
        first = crud.create_award(db, race_id, schemas.AwardCreate(name="Best Paint"))
        second = crud.create_award(
            db, race_id, schemas.AwardCreate(name="Most Original")
        )
        assert [a.id for a in crud.get_awards(db, race_id)] == [first.id, second.id]
        assert second.sort_order > first.sort_order

    def test_reordering_sets_the_running_order(self, db):
        race_id, _dens, _racers = build_race(db)
        first = crud.create_award(db, race_id, schemas.AwardCreate(name="Best Paint"))
        second = crud.create_award(
            db, race_id, schemas.AwardCreate(name="Most Original")
        )

        crud.reorder_awards(db, race_id, [second.id, first.id])

        assert [a.name for a in crud.get_awards(db, race_id)] == [
            "Most Original",
            "Best Paint",
        ]

    def test_reordering_ignores_an_award_that_is_not_this_race_s(self, db):
        # The screen sends the order it is showing; an award deleted from
        # another device in between is a race, not a mistake.
        race_id, _dens, _racers = build_race(db)
        award = crud.create_award(db, race_id, schemas.AwardCreate(name="Best Paint"))
        crud.reorder_awards(db, race_id, [9999, award.id])
        assert [a.id for a in crud.get_awards(db, race_id)] == [award.id]


class TestOverGraphQL:
    def test_a_race_reports_its_awards_with_recipients(self, client, db):
        race_id, dens, racers = build_race(db, racers_per_den=4)
        times = {racer_id: 3.0 + i for i, racer_id in enumerate(racers)}
        race_everyone(client, db, race_id, times)

        crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Fastest Wolf",
                kind=models.AwardKind.SPEED,
                source="PACK",
                place=1,
                den_id=dens[0],
            ),
        )
        crud.create_award(
            db,
            race_id,
            schemas.AwardCreate(
                name="Best Paint",
                kind=models.AwardKind.SPECIAL,
                racer_id=racers[2],
            ),
        )

        response = client.post(
            "/graphql",
            json={"query": AWARDS_QUERY, "variables": {"raceId": race_id}},
        )
        body = response.json()
        assert "errors" not in body, body.get("errors")
        awards = body["data"]["race"]["awards"]

        assert [a["name"] for a in awards] == ["Fastest Wolf", "Best Paint"]
        assert awards[0]["kind"] == "SPEED"
        assert int(awards[0]["recipient"]["id"]) == racers[0]
        assert awards[0]["den"]["name"] == "Wolves"
        assert int(awards[1]["recipient"]["id"]) == racers[2]

    def test_creating_and_deleting_an_award(self, client, db):
        race_id, _dens, racers = build_race(db)

        created = client.post(
            "/graphql",
            json={
                "query": """
                mutation Create($raceId: Int!, $award: AwardInput!) {
                  createAward(raceId: $raceId, award: $award) {
                    id name kind recipient { id }
                  }
                }
                """,
                "variables": {
                    "raceId": race_id,
                    "award": {
                        "name": "Judges' Choice",
                        "kind": "SPECIAL",
                        "racerId": racers[0],
                    },
                },
            },
        ).json()
        assert "errors" not in created, created.get("errors")
        award = created["data"]["createAward"]
        assert int(award["recipient"]["id"]) == racers[0]

        deleted = client.post(
            "/graphql",
            json={
                "query": "mutation Delete($id: Int!) { deleteAward(id: $id) }",
                "variables": {"id": int(award["id"])},
            },
        ).json()
        assert deleted["data"]["deleteAward"] is True
        assert crud.get_awards(db, race_id) == []

    def test_a_place_below_one_is_refused_at_the_edge(self, client, db):
        race_id, _dens, _racers = build_race(db)
        body = client.post(
            "/graphql",
            json={
                "query": """
                mutation Create($raceId: Int!, $award: AwardInput!) {
                  createAward(raceId: $raceId, award: $award) { id }
                }
                """,
                "variables": {
                    "raceId": race_id,
                    "award": {
                        "name": "Nonsense",
                        "kind": "SPEED",
                        "source": "PACK",
                        "place": 0,
                    },
                },
            },
        ).json()
        assert "errors" in body
        assert crud.get_awards(db, race_id) == []


class TestDeletingTheRace:
    def test_awards_go_with_it(self, db):
        race_id, _dens, _racers = build_race(db)
        crud.create_award(db, race_id, schemas.AwardCreate(name="Best Paint"))
        crud.delete_race(db, race_id)
        remaining = db.query(models.Award).filter(models.Award.race_id == race_id)
        assert remaining.all() == []
