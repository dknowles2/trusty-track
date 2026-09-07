"""GraphQL requests get the same body cap `POST /upload/` already has (#744).

`Mutation.upload_image` (`backend/api/schema.py`) `base64.b64decode`s a
caller-supplied `data_url` with no length check, and `Mutation.import_racers`
feeds `csv_data` straight into `csv.DictReader` — both reachable at
`CHECKIN` (and by everyone on an install with no PIN set, which is every
install until one is set). Unlike `POST /upload/`'s `MAX_UPLOAD_BYTES`,
neither resolver bounds its own argument, so an oversized request pulls an
arbitrary amount of data into memory before either resolver ever runs, on a
Raspberry Pi with a gigabyte of RAM.

Both resolvers live in `backend/api/schema.py`, out of scope for this fix
(another change is in flight there) — the cap instead sits at the one seam
that already covers every GraphQL mutation regardless of which argument is
carrying the oversized value: the HTTP request body itself, measured while
it is read rather than after it is all in memory, the same rule
`_read_capped` already follows for the REST route.

These tests shrink `main.MAX_GRAPHQL_BODY_BYTES` for speed rather than
sending a body anywhere near the real cap — the mechanism doesn't care how
big the number is, only that the body it is handed exceeds it.
"""

from backend.api import main


def test_an_oversized_upload_image_body_is_refused(client, monkeypatch):
    """The shape #744 actually names: a `data_url` far larger than anything
    a resolver-side check could catch before this fix existed."""
    monkeypatch.setattr(main, "MAX_GRAPHQL_BODY_BYTES", 1024, raising=False)

    response = client.post(
        "/graphql",
        json={
            "query": "mutation($d: String!) { uploadImage(dataUrl: $d) }",
            "variables": {"d": "data:image/png;base64," + ("A" * 10_000)},
        },
    )

    assert response.status_code == 413


def test_an_oversized_import_racers_body_is_refused(client, monkeypatch):
    """The second shape #744 names: `csv_data` has no cap of its own either."""
    monkeypatch.setattr(main, "MAX_GRAPHQL_BODY_BYTES", 1024, raising=False)

    response = client.post(
        "/graphql",
        json={
            "query": (
                "mutation($r: Int!, $c: String!) "
                "{ importRacers(raceId: $r, csvData: $c) }"
            ),
            "variables": {"r": 1, "c": "first_name,last_name\n" * 500},
        },
    )

    assert response.status_code == 413


def test_the_refusal_names_no_particular_field(client, monkeypatch):
    """The cap is on the request body, not on any one argument, so the
    refusal must not depend on which mutation — or field — carried the
    oversized value. An ordinary, well-formed query that merely has a large
    body some other way is refused identically."""
    monkeypatch.setattr(main, "MAX_GRAPHQL_BODY_BYTES", 1024, raising=False)

    response = client.post(
        "/graphql",
        json={"query": "query { version }", "extra_padding": "y" * 10_000},
    )

    assert response.status_code == 413


def test_a_body_within_the_cap_is_unaffected(client, monkeypatch):
    """The cap must not become a trap for ordinary traffic — ties the
    mechanism itself to the actual production constant's neighbourhood
    rather than only ever testing with a tiny one."""
    monkeypatch.setattr(main, "MAX_GRAPHQL_BODY_BYTES", 1_000_000, raising=False)

    response = client.post("/graphql", json={"query": "query { version }"})

    assert response.status_code == 200
    assert "errors" not in response.json()


def test_a_get_request_to_graphql_is_unaffected(client, monkeypatch):
    """GraphiQL's own page load carries no body at all; the middleware must
    not choke on that shape while it is busy guarding the shape that does."""
    monkeypatch.setattr(main, "MAX_GRAPHQL_BODY_BYTES", 1024, raising=False)

    response = client.get("/graphql")

    assert response.status_code != 413
