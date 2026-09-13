"""`Query.races`/`crud.get_races` list newest-first, with a limit no real
install reaches (#1129).

Before this, `get_races` had no `order_by` at all — `db.query(models.Race)
.offset(skip).limit(limit)` returns SQLite's own storage order, which is
insertion order in the ordinary case — and `limit` defaulted to 100. Home
lists races through this query with no `skip`/`limit` of its own, so once an
install held more than 100 races, the 101st and later — the ones just
created — were simply never on the page, and nothing said so.

Two things are pinned separately, because either fix alone leaves the other
half of the bug in place: `test_a_race_past_the_old_limit_is_on_the_page`
would still fail today if only the `order_by` were added and `limit` were
left at 100, and `test_newest_first_regardless_of_insertion_order` would
still fail if only the limit were raised and no `order_by` existed.
"""

from backend.db import crud, models, schemas

GET_RACES_ORDER_QUERY = """
{
  races {
    id
    name
    dateTime
  }
}
"""


def _org_and_track(db) -> tuple[models.Organization, models.Track]:
    org = crud.create_organization(
        db, schemas.OrganizationCreate(name="Order Test Pack")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name="Order Test Track", lane_count=4)
    )
    return org, track


def _create_race(db, org, track, name: str, date_time: str | None = None):
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name=name,
            organization_id=org.id,
            track_id=track.id,
            date_time=date_time,
        ),
    )


def test_a_race_past_the_old_limit_is_on_the_page(client, db):
    """101 races: the newest — the last one created — is in the default
    page returned by `Query.races`, and it is first.

    Mutation test: restoring `get_races`'s old `limit: int = 100` default
    (or `crud.NO_PRACTICAL_LIMIT` set back to 100) fails this — the 101st
    race would not be in `body["data"]["races"]` at all.
    """
    org, track = _org_and_track(db)
    for i in range(100):
        _create_race(db, org, track, f"Old Race {i:03d}", date_time="2020-01-01T10:00")

    newest = _create_race(db, org, track, "Newest Race", date_time="2026-09-13T10:00")

    response = client.post("/graphql", json={"query": GET_RACES_ORDER_QUERY})
    assert response.status_code == 200
    body = response.json()
    assert "errors" not in body, body
    races = body["data"]["races"]
    assert len(races) == 101, "the 101st race must not be dropped by the page limit"
    assert races[0]["id"] == newest.id, (
        "the newest race must sort first, not merely be present somewhere on the page"
    )


def test_newest_first_regardless_of_insertion_order(client, db):
    """Three races with distinct dates, created out of chronological order,
    still list newest-date-first.

    Mutation test: removing the `order_by` from `crud.get_races` (falling
    back to SQLite's own storage order) fails this, because the races are
    deliberately created in an order that disagrees with their dates.
    """
    org, track = _org_and_track(db)

    middle = _create_race(db, org, track, "Middle Date", date_time="2026-06-01T09:00")
    oldest = _create_race(db, org, track, "Oldest Date", date_time="2026-01-01T09:00")
    newest = _create_race(db, org, track, "Newest Date", date_time="2026-12-01T09:00")

    response = client.post("/graphql", json={"query": GET_RACES_ORDER_QUERY})
    assert response.status_code == 200
    body = response.json()
    ids_in_order = [race["id"] for race in body["data"]["races"]]
    assert ids_in_order == [newest.id, middle.id, oldest.id]


def test_a_race_with_no_date_sorts_last(client, db):
    """A race with a null `date_time` must not jump ahead of every dated
    race — see `crud.get_races`'s docstring for why this is steered
    explicitly rather than left to the backend's own default null
    ordering.
    """
    org, track = _org_and_track(db)

    dated = _create_race(db, org, track, "Has A Date", date_time="2020-01-01T09:00")
    undated = _create_race(db, org, track, "No Date At All", date_time=None)

    response = client.post("/graphql", json={"query": GET_RACES_ORDER_QUERY})
    assert response.status_code == 200
    body = response.json()
    ids_in_order = [race["id"] for race in body["data"]["races"]]
    assert ids_in_order == [dated.id, undated.id]


def test_get_races_orders_newest_first_at_the_crud_layer(db):
    """The same ordering, exercised directly against `crud.get_races`
    rather than through GraphQL — the id tiebreak (`Race.id` desc) is
    easiest to pin here, with two races sharing the same `date_time`.
    """
    org, track = _org_and_track(db)

    first = _create_race(db, org, track, "Same Date A", date_time="2026-05-01T10:00")
    second = _create_race(db, org, track, "Same Date B", date_time="2026-05-01T10:00")

    races = crud.get_races(db)
    ids_in_order = [race.id for race in races]
    assert ids_in_order.index(second.id) < ids_in_order.index(first.id), (
        "a tied date_time falls back to id desc, so the later-created race "
        "(the higher id) sorts first"
    )
