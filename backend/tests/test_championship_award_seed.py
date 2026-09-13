"""Championship trophies auto-populate on the Awards page (#1082).

The pure rule and its table live in `test_domain_awards.py`
(`TestChampionshipAwardSeed`). What is checked here is the wiring: that
`createRoundWizard` and `createRound` actually call it when a final round is
created, that the guard against seeding twice holds across both doors and
across the race setup wizard's copied-awards path, and that the empty-state
`seedChampionshipAwards` mutation carries the same role/lock/audit behaviour
every other award mutation does.
"""

from backend.api import auth, race_lock
from backend.db import crud, models, schemas
from backend.tests.helpers import record_heat_result
from backend.tests.test_query_counts import _QueryCounter

_race_counter = 0


def _race(db, *, championship_trophies=3, racing_groups=("Wolves", "Bears")):
    global _race_counter
    _race_counter += 1
    label = f"Trophy{_race_counter}"
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{label} Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{label} Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"{label} Derby",
            organization_id=org.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
            championship_trophies=championship_trophies,
        ),
    )
    group_ids = []
    racer_ids = []
    number = 0
    for group_name in racing_groups:
        group = crud.create_racing_group(
            db, schemas.RacingGroupCreate(name=group_name), race.id
        )
        group_ids.append(group.id)
        for _ in range(4):
            number += 1
            racer = crud.create_racer(
                db,
                schemas.RacerCreate(
                    first_name=f"Racer{number}",
                    last_name=group_name,
                    car_number=number,
                    racing_group_id=group.id,
                    race_id=race.id,
                    car_passed_inspection=True,
                ),
            )
            racer_ids.append(racer.id)
    return race, group_ids, racer_ids


def _speed_awards(db, race_id):
    return [
        award
        for award in crud.get_awards(db, race_id)
        if award.kind == models.AwardKind.SPEED
    ]


WIZARD = """
mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
  createRoundWizard(raceId: $raceId, config: $config) {
    id
    roundNumber
    advancementSource
  }
}
"""

CREATE_ROUND = """
mutation CreateRound($raceId: Int!, $roundData: RoundCreateInput!) {
  createRound(raceId: $raceId, roundData: $roundData) {
    id
    advancementSource
  }
}
"""

SEED_AWARDS = """
mutation Seed($raceId: Int!) {
  seedChampionshipAwards(raceId: $raceId) {
    id
    name
    place
    source
    racingGroup { id }
  }
}
"""


def _run_wizard(client, race_id, championship_rounds):
    body = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race_id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": championship_rounds,
                },
            },
        },
    ).json()
    assert "errors" not in body, body
    return body["data"]["createRoundWizard"]


class TestWizardSeedsTheFinal:
    def test_a_final_earns_one_speed_award_per_trophy(self, db, client):
        race, _groups, _racers = _race(db, championship_trophies=3)
        rounds = _run_wizard(
            client,
            race.id,
            [{"name": "Finals", "source": "ALL", "numTopRacers": 3}],
        )
        final_id = rounds[-1]["id"]

        seeded = _speed_awards(db, race.id)
        assert len(seeded) == 3
        assert {award.place for award in seeded} == {1, 2, 3}
        assert {award.source for award in seeded} == {f"ROUND:{final_id}"}
        assert sorted(award.name for award in seeded) == [
            "1st Place",
            "2nd Place",
            "3rd Place",
        ]

    def test_a_wizard_with_no_championship_round_seeds_nothing(self, db, client):
        race, _groups, _racers = _race(db)
        _run_wizard(client, race.id, [])
        assert _speed_awards(db, race.id) == []

    def test_running_the_wizard_a_second_time_is_refused_so_nothing_doubles(
        self, db, client
    ):
        """The wizard itself refuses a race that already has rounds — this
        just confirms the awards from the first run are not somehow doubled
        by a caller retrying."""
        race, _groups, _racers = _race(db, championship_trophies=2)
        _run_wizard(
            client,
            race.id,
            [{"name": "Finals", "source": "ALL", "numTopRacers": 2}],
        )
        assert len(_speed_awards(db, race.id)) == 2

        body = client.post(
            "/graphql",
            json={
                "query": WIZARD,
                "variables": {
                    "raceId": race.id,
                    "config": {
                        "generalRound": {"type": "ALL", "runsPerLane": 1},
                        "championshipRounds": [
                            {"name": "Finals 2", "source": "ALL", "numTopRacers": 2}
                        ],
                    },
                },
            },
        ).json()
        assert body.get("errors")
        assert len(_speed_awards(db, race.id)) == 2

    def test_a_second_championship_round_added_through_add_round_seeds_nothing_more(
        self, db, client
    ):
        """`createRound`'s own championship branch also seeds, but only when
        the race has no SPEED award yet — a "Slowest Race" bracket added
        after the main final must not double the trophy count."""
        race, _groups, _racers = _race(db, championship_trophies=3)
        _run_wizard(
            client,
            race.id,
            [{"name": "Finals", "source": "ALL", "numTopRacers": 3}],
        )
        assert len(_speed_awards(db, race.id)) == 3

        body = client.post(
            "/graphql",
            json={
                "query": CREATE_ROUND,
                "variables": {
                    "raceId": race.id,
                    "roundData": {
                        "name": "Slowest Race",
                        "advancementSource": "ALL",
                        "advancementNumRacers": 1,
                        "advancementFromBottom": True,
                        "runsPerLane": 1,
                    },
                },
            },
        ).json()
        assert "errors" not in body, body
        assert len(_speed_awards(db, race.id)) == 3

    def test_a_championship_round_added_with_no_wizard_still_seeds(self, db, client):
        """`createRound`'s own door — the wizard was skipped entirely, an
        operator built the general round by hand and added the final
        through Add Round."""
        race, _groups, _racers = _race(db, championship_trophies=2)
        _run_wizard(client, race.id, [])

        body = client.post(
            "/graphql",
            json={
                "query": CREATE_ROUND,
                "variables": {
                    "raceId": race.id,
                    "roundData": {
                        "name": "Finals",
                        "advancementSource": "ALL",
                        "advancementNumRacers": 2,
                        "runsPerLane": 1,
                    },
                },
            },
        ).json()
        assert "errors" not in body, body
        final_id = body["data"]["createRound"][0]["id"]

        seeded = _speed_awards(db, race.id)
        assert len(seeded) == 2
        assert {award.source for award in seeded} == {f"ROUND:{final_id}"}

    def test_a_copied_award_set_blocks_seeding(self, db, client):
        """The race setup wizard's "copy awards from a previous race" step
        writes SPEED awards directly through `crud.create_race`, long
        before any round exists. Presence is the guard regardless of how
        the award arrived."""
        race, _groups, _racers = _race(db, championship_trophies=3)
        crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(
                name="Pack Champion",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
            ),
        )
        _run_wizard(
            client,
            race.id,
            [{"name": "Finals", "source": "ALL", "numTopRacers": 3}],
        )

        seeded = _speed_awards(db, race.id)
        assert len(seeded) == 1
        assert seeded[0].name == "Pack Champion"

    def test_a_judged_only_race_still_seeds(self, db, client):
        race, _groups, _racers = _race(db, championship_trophies=2)
        crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(name="Best Paint", kind=models.AwardKind.SPECIAL),
        )
        _run_wizard(
            client,
            race.id,
            [{"name": "Finals", "source": "ALL", "numTopRacers": 2}],
        )
        assert len(_speed_awards(db, race.id)) == 2

    def test_each_group_seeds_one_set_per_racing_group(self, db, client):
        race, group_ids, _racers = _race(db, championship_trophies=2)
        rounds = _run_wizard(
            client,
            race.id,
            [{"name": "Finals", "source": "EACH_GROUP", "numTopRacers": 2}],
        )
        final_id = rounds[-1]["id"]

        seeded = _speed_awards(db, race.id)
        assert len(seeded) == 4
        assert {award.racing_group_id for award in seeded} == set(group_ids)
        for group_id in group_ids:
            places = sorted(
                award.place for award in seeded if award.racing_group_id == group_id
            )
            assert places == [1, 2]
        assert {award.source for award in seeded} == {f"ROUND:{final_id}"}

    def test_place_never_exceeds_the_final_s_own_field(self, db, client):
        """`championship_trophies=3` but the final only asks for the top 2
        — the floor relationship in the other direction (`RoundConfigModal`
        enforces the usual case; this is what happens when it does not)."""
        race, _groups, _racers = _race(db, championship_trophies=3)
        _run_wizard(
            client,
            race.id,
            [{"name": "Finals", "source": "ALL", "numTopRacers": 2}],
        )
        seeded = _speed_awards(db, race.id)
        assert sorted(award.place for award in seeded) == [1, 2]


class TestSeedChampionshipAwardsMutation:
    """The Awards page's empty-state 'Add the N championship trophies'
    button — the same crud helper, called by hand."""

    def test_seeds_the_race_s_existing_final(self, db, client):
        race, _groups, _racers = _race(db, championship_trophies=3)
        _run_wizard(client, race.id, [])
        body = client.post(
            "/graphql",
            json={
                "query": CREATE_ROUND,
                "variables": {
                    "raceId": race.id,
                    "roundData": {
                        "name": "Finals",
                        "advancementSource": "ALL",
                        "advancementNumRacers": 3,
                        "runsPerLane": 1,
                    },
                },
            },
        ).json()
        assert "errors" not in body, body
        # Simulate a deleted seed: remove what `createRound` just seeded.
        for award in _speed_awards(db, race.id):
            crud.delete_award(db, award.id)
        assert _speed_awards(db, race.id) == []

        seed_body = client.post(
            "/graphql",
            json={"query": SEED_AWARDS, "variables": {"raceId": race.id}},
        ).json()
        assert "errors" not in seed_body, seed_body
        assert len(seed_body["data"]["seedChampionshipAwards"]) == 3
        assert len(_speed_awards(db, race.id)) == 3

    def test_a_race_with_a_speed_award_already_gets_nothing_more(self, db, client):
        race, _groups, _racers = _race(db, championship_trophies=3)
        _run_wizard(
            client,
            race.id,
            [{"name": "Finals", "source": "ALL", "numTopRacers": 3}],
        )
        assert len(_speed_awards(db, race.id)) == 3

        body = client.post(
            "/graphql",
            json={"query": SEED_AWARDS, "variables": {"raceId": race.id}},
        ).json()
        assert "errors" not in body, body
        assert body["data"]["seedChampionshipAwards"] == []
        assert len(_speed_awards(db, race.id)) == 3

    def test_a_race_with_no_championship_round_is_refused(self, db, client):
        race, _groups, _racers = _race(db)
        _run_wizard(client, race.id, [])

        body = client.post(
            "/graphql",
            json={"query": SEED_AWARDS, "variables": {"raceId": race.id}},
        ).json()
        assert body.get("errors")
        assert _speed_awards(db, race.id) == []


def _round_with_heats(db, race, heat_count: int) -> models.Round:
    """A championship round with `heat_count` bare heat rows — enough for
    `test_query_counts.py`'s own shape of test: does seeding cost scale with
    how many heats the round holds, the thing #1082 explicitly asks not to
    regress on."""
    round_obj = crud.create_round(
        db,
        race.id,
        round_number=2,
        advancement_source="ALL",
        advancement_num_racers=3,
    )
    for n in range(heat_count):
        db.add(models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=n + 1))
    db.commit()
    return round_obj


def test_seeding_query_count_does_not_scale_with_heat_count(db):
    """`seed_championship_awards` is a function of trophies and racing
    groups, never of how many heats a round holds — a fixed number of
    inserts, not one per heat."""
    race_small, _groups, _racers = _race(
        db, championship_trophies=3, racing_groups=("Wolves",)
    )
    round_small = _round_with_heats(db, race_small, heat_count=2)
    with _QueryCounter() as small:
        crud.seed_championship_awards(db, round_small)

    race_big, _groups2, _racers2 = _race(
        db, championship_trophies=3, racing_groups=("Wolves",)
    )
    round_big = _round_with_heats(db, race_big, heat_count=200)
    with _QueryCounter() as big:
        crud.seed_championship_awards(db, round_big)

    assert big.count == small.count, (
        f"seeding cost {big.count} queries against {small.count} for a round "
        "100x the heat count — it must be reading the heats somewhere"
    )


# --------------------------------------------------------------------------- #
# Policy: role, lock, demo, audit                                              #
# --------------------------------------------------------------------------- #


def test_seed_championship_awards_is_operator_only():
    assert "seedChampionshipAwards" in auth.OPERATOR_ONLY_MUTATIONS
    assert "seedChampionshipAwards" not in auth.CHECKIN_MUTATIONS


def test_seed_championship_awards_is_refused_for_check_in():
    assert "seedChampionshipAwards" not in auth.POLICY[auth.Role.CHECKIN]
    assert "seedChampionshipAwards" not in auth.POLICY[auth.Role.VIEWER]


def test_seed_championship_awards_is_on_the_lock_denylist():
    assert "seedChampionshipAwards" in race_lock.LOCKED_MUTATION_RESOLVERS
    assert race_lock.LOCKED_MUTATION_RESOLVERS["seedChampionshipAwards"] is (
        race_lock._direct_locked
    )


def test_a_locked_race_refuses_seeding(db, client):
    race, _groups, _racers = _race(db, championship_trophies=2)
    _run_wizard(client, race.id, [])
    body = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {
                "raceId": race.id,
                "roundData": {
                    "name": "Finals",
                    "advancementSource": "ALL",
                    "advancementNumRacers": 2,
                    "runsPerLane": 1,
                },
            },
        },
    ).json()
    assert "errors" not in body, body
    for award in _speed_awards(db, race.id):
        crud.delete_award(db, award.id)

    db_race = db.query(models.Race).filter(models.Race.id == race.id).first()
    db_race.is_locked = True
    db.commit()

    seed_body = client.post(
        "/graphql",
        json={"query": SEED_AWARDS, "variables": {"raceId": race.id}},
    ).json()
    assert seed_body.get("errors")
    db.expire_all()
    assert _speed_awards(db, race.id) == []


def test_the_seeding_mutation_is_audited(db, client):
    race, _groups, _racers = _race(db, championship_trophies=2)
    _run_wizard(client, race.id, [])
    body = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {
                "raceId": race.id,
                "roundData": {
                    "name": "Finals",
                    "advancementSource": "ALL",
                    "advancementNumRacers": 2,
                    "runsPerLane": 1,
                },
            },
        },
    ).json()
    assert "errors" not in body, body
    for award in _speed_awards(db, race.id):
        crud.delete_award(db, award.id)

    seed_body = client.post(
        "/graphql",
        json={"query": SEED_AWARDS, "variables": {"raceId": race.id}},
    ).json()
    assert "errors" not in seed_body, seed_body

    entry = (
        db.query(models.AuditEntry)
        .filter(models.AuditEntry.action == "seedChampionshipAwards")
        .order_by(models.AuditEntry.id.desc())
        .first()
    )
    assert entry is not None
    assert entry.outcome == "OK"


def test_the_seeded_set_resolves_once_raced(db, client):
    """End to end: seed through the wizard, race the final on the fake
    timer's own recording path, and check the trophies land on the round's
    actual top three."""
    race, _groups, racer_ids = _race(
        db, championship_trophies=3, racing_groups=("Wolves",)
    )
    rounds = _run_wizard(
        client,
        race.id,
        [{"name": "Finals", "source": "ALL", "numTopRacers": 3}],
    )
    general_round_id = rounds[0]["id"]
    final_id = rounds[-1]["id"]

    # Race the general round so the final's field decides, favouring racers
    # in `racer_ids` order (lower id = faster).
    for heat in crud.get_heats(db, race.id, round_id=general_round_id):
        stored = crud.heat_lanes_of(db, heat)
        entries = [
            {
                "lane": lane.lane,
                "racer_id": lane.racer_id,
                "time": (
                    3.0 + racer_ids.index(lane.racer_id) * 0.01
                    if lane.racer_id is not None
                    else None
                ),
            }
            for lane in stored
        ]
        record_heat_result(client, heat.id, entries)

    # The final should now be populated and raceable.
    for heat in crud.get_heats(db, race.id, round_id=final_id):
        stored = crud.heat_lanes_of(db, heat)
        entries = [
            {
                "lane": lane.lane,
                "racer_id": lane.racer_id,
                "time": (
                    3.0 + racer_ids.index(lane.racer_id) * 0.01
                    if lane.racer_id is not None
                    else None
                ),
            }
            for lane in stored
        ]
        record_heat_result(client, heat.id, entries)

    from backend.services import awards as awards_service

    seeded = sorted(_speed_awards(db, race.id), key=lambda award: award.place)
    recipients = awards_service.recipients_for(db, race.id)
    expected_top_three = racer_ids[:3]
    assert [recipients[award.id] for award in seeded] == expected_top_three
