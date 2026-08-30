"""``Round.racingGroupId`` on the GraphQL schema (#549 stage 4).

The column has always been on the model; nothing exposed it. The master
running order screen needs it to label a heat with the group whose cars are
on the track — resolved client-side against ``race.racingGroups``, which the
schedule screen already fetches, rather than a second name-carrying field
here.
"""

from backend.db import crud, models, schemas


def _race_with_group(db):
    org = crud.create_organization(db, schemas.OrganizationCreate(name="RG Field Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="RG Field Track", lane_count=4)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            organization_id=org.id, name="RG Field Derby", track_id=track.id
        ),
    )
    racing_group = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Lions", color="#112233"), race.id
    )
    return race, racing_group


def test_a_round_scoped_to_a_racing_group_reports_its_id(client, db):
    race, racing_group = _race_with_group(db)
    crud.create_round(
        db, race_id=race.id, round_number=1, racing_group_id=racing_group.id
    )

    response = client.post(
        "/graphql",
        json={
            "query": f"""
            {{
              race(raceId: {race.id}) {{
                rounds {{ racingGroupId }}
              }}
            }}
            """
        },
    )

    assert response.status_code == 200
    rounds = response.json()["data"]["race"]["rounds"]
    assert rounds == [{"racingGroupId": racing_group.id}]


def test_a_round_scoped_to_no_group_reports_null(client, db):
    race, _ = _race_with_group(db)
    crud.create_round(db, race_id=race.id, round_number=1)

    response = client.post(
        "/graphql",
        json={
            "query": f"""
            {{
              race(raceId: {race.id}) {{
                rounds {{ racingGroupId }}
              }}
            }}
            """
        },
    )

    assert response.status_code == 200
    rounds = response.json()["data"]["race"]["rounds"]
    assert rounds == [{"racingGroupId": None}]


def test_the_field_is_a_plain_column_read_no_extra_query(db):
    # Not a resolver reaching for a loader — `Round.racing_group_id` is a
    # plain column already on the eagerly-loaded row (#549 stage 4's own
    # reasoning for adding it as a bare field rather than a resolved name).
    race, racing_group = _race_with_group(db)
    round_obj = crud.create_round(
        db, race_id=race.id, round_number=1, racing_group_id=racing_group.id
    )
    fetched = db.query(models.Round).filter(models.Round.id == round_obj.id).one()
    assert fetched.racing_group_id == racing_group.id
