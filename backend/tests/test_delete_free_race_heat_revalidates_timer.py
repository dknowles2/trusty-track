"""`deleteFreeRaceHeat` is the one delete path that never disarmed the timer
(#887).

`deleteHeat`, `deleteRound`, `deleteRacer`, `bulkDeleteRacers`, `deleteRace`
and `deleteRunOffHeat` all call `_revalidate_timers` after a successful
delete — `deleteFreeRaceHeat` did not, so a manager armed for a free heat the
operator then deleted stayed `ARMED` on a heat row that no longer existed.
The operator only found out after the cars ran, through `_record_results`'
`_abandon_run`, holding times they had to key in by hand — the exact failure
#50 exists to prevent.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.main import TIMER_MANAGERS, app
from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState

client = TestClient(app)


@pytest.fixture(autouse=True)
def registered_manager():
    """Own `TIMER_MANAGERS` for the module — it is a process-wide dict."""
    saved = dict(TIMER_MANAGERS)
    TIMER_MANAGERS.clear()
    yield
    TIMER_MANAGERS.clear()
    TIMER_MANAGERS.update(saved)


def _race_and_track(db: Session):
    org = crud.create_organization(
        db, schemas.OrganizationCreate(name="Free Race Timer Pack 887")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name="Free Race Timer Track", lane_count=4, timer_type="FAKE"
        ),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Free Race Timer Race 887",
            organization_id=org.id,
            track_id=track.id,
        ),
    )
    return race, track


@pytest.mark.anyio
async def test_deleting_an_armed_free_race_heat_disarms_the_timer(db: Session):
    race, track = _race_and_track(db)
    racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Alice",
            last_name="Test",
            race_id=race.id,
            car_passed_inspection=True,
        ),
    )
    heat = crud.create_free_race_heat(
        db, race.id, [crud.lanes.Lane(lane=1, racer_id=racer.id)]
    )

    mgr = TimerManager(track_id=track.id, device=FAKE)
    TIMER_MANAGERS[track.id] = mgr
    await mgr.prepare_heat(heat.id, models.HeatKind.FREE, lane_mask=0b0001)

    assert mgr.status().state == TimerState.ARMED.value

    mutation = """
    mutation($heatId: Int!) {
        deleteFreeRaceHeat(heatId: $heatId)
    }
    """
    resp = client.post(
        "/graphql", json={"query": mutation, "variables": {"heatId": heat.id}}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    assert body["data"]["deleteFreeRaceHeat"] is True

    assert mgr.status().state == TimerState.IDLE.value
    assert mgr._active_heat_id is None
