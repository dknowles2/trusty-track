"""Check-in codes: what they say, and how they reach a printer.

The payload is printed on paper and read back by a scanner that may be a
different version of this app, so the round trip is the thing to hold. The
endpoint matters because it is a GET, and the SPA catch-all is also a GET.
"""

import pytest

from backend.db import crud, schemas
from backend.domain import printables as domain_printables
from backend.services import printables as service_printables

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.fixture
def race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            group_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )


@pytest.fixture
def racer(db, race):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Alex",
            last_name="Rivera",
            race_id=race.id,
            car_passed_inspection=False,
        ),
    )


class TestPayload:
    def test_a_code_reads_back_as_what_was_printed(self):
        assert domain_printables.decode(domain_printables.encode(3, 42)) == (
            domain_printables.CheckInCode(race_id=3, racer_id=42)
        )

    @pytest.mark.parametrize("race_id", [1, 999, 123456])
    @pytest.mark.parametrize("racer_id", [1, 7, 987654])
    def test_the_round_trip_holds_for_any_ids(self, race_id, racer_id):
        decoded = domain_printables.decode(domain_printables.encode(race_id, racer_id))

        assert decoded is not None
        assert (decoded.race_id, decoded.racer_id) == (race_id, racer_id)

    def test_a_code_names_the_race(self):
        """Two racers with the same id in different races must not collide.

        A code printed at last year's derby and left in a scout's box would
        otherwise resolve to whoever holds that id now.
        """
        assert domain_printables.encode(1, 42) != domain_printables.encode(2, 42)

    @pytest.mark.parametrize(
        "payload",
        [
            "",
            "42",
            "TT1:42",
            "TT1:1:2:3",
            "TT1:one:two",
            "TT0:1:2",
            "TT2:1:2",
            "https://example.com/coupon",
            "TT1::",
        ],
    )
    def test_anything_else_is_refused(self, payload):
        """Every kind of wrong gets the same answer, because the operator's next
        move is the same: search by name instead."""
        assert domain_printables.decode(payload) is None

    def test_surrounding_whitespace_is_tolerated(self):
        """Scanners append a newline; some append a carriage return too."""
        assert domain_printables.decode("  TT1:1:2\r\n  ") is not None

    def test_an_unknown_version_is_refused_rather_than_guessed(self):
        """The reason the version tag is there. A future format must not be read
        under today's rules by a copy of the app that predates it."""
        future = domain_printables.encode(1, 2).replace(
            domain_printables.VERSION, "TT9"
        )

        assert domain_printables.decode(future) is None


class TestRendering:
    def test_it_renders_a_png(self):
        image = service_printables.check_in_png(1, 2)

        assert image.startswith(PNG_MAGIC)

    def test_different_racers_get_different_codes(self):
        assert service_printables.check_in_png(1, 2) != service_printables.check_in_png(
            1, 3
        )

    def test_the_same_racer_always_gets_the_same_code(self):
        """Reprinting one pit pass must not produce a code that scans as
        something else, and the endpoint tells browsers to cache on this basis.
        """
        assert service_printables.check_in_png(1, 2) == service_printables.check_in_png(
            1, 2
        )


class TestEndpoint:
    def test_it_serves_a_png(self, client, racer):
        response = client.get(f"/api/printables/barcode/{racer.id}.png")

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content.startswith(PNG_MAGIC)

    def test_it_answers_without_the_api_prefix_too(self, client, racer):
        """The Vite dev proxy strips `/api` before forwarding, so the path the
        backend sees in development is not the one the page asked for. Only the
        prefixed form registered means the print page works in production and
        404s on the machine it is written on."""
        response = client.get(f"/printables/barcode/{racer.id}.png")

        assert response.status_code == 200
        assert response.content.startswith(PNG_MAGIC)

    def test_the_image_encodes_that_racer_in_that_race(self, client, racer):
        """Not just "a PNG came back" — the bytes have to be this racer's."""
        response = client.get(f"/api/printables/barcode/{racer.id}.png")

        assert response.content == service_printables.check_in_png(
            racer.race_id, racer.id
        )

    def test_an_unknown_racer_is_a_404(self, client):
        assert client.get("/api/printables/barcode/999999.png").status_code == 404

    def test_it_is_not_swallowed_by_the_spa_catch_all(self, client, racer):
        """The catch-all is a GET on `/{full_path:path}` and this is a GET, so
        registration order decides. Registered after it, the endpoint returns
        `index.html` in production and nothing catches it in development, where
        `frontend/dist` usually does not exist."""
        response = client.get(f"/api/printables/barcode/{racer.id}.png")

        assert "text/html" not in response.headers["content-type"]

    def test_the_response_is_cacheable(self, client, racer):
        """A roster sheet is sixty of these and gets reprinted more than once."""
        response = client.get(f"/api/printables/barcode/{racer.id}.png")

        assert "immutable" in response.headers.get("cache-control", "")
