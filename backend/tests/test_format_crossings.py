"""The format sweep #1025 asked for and #1052 tracks — general round style
crossed with championship shape crossed with the master running order,
raced to the end (#1052, item 3).

The per-bug seam tests elsewhere in this suite each cross exactly two
features together, one bug at a time — `test_wizard_elimination_championship.py`
for PPC-vs-elimination chaining, `test_master_running_order_repair.py` for
wave growth vs the interleave, and so on. None of them tries every
combination at once, so a bug at a *third* seam — a general round style, a
championship shape, and the master running order all interacting — has
nowhere it would be caught until an operator hits it. This is that sweep,
in the tradition of `test_domain_scheduling.py`'s racer-count-by-lane-count
property sweep: build every cell through the doors the app itself offers,
race it to the end, and assert the same handful of invariants on all of
them.

Championship shape is `none` / `ALL` / `EACH_GROUP` / `ROUND:<general>` — four
values, not the three #1025 first suggested. `EACH_GROUP` joined after review
found it shares #1054's bug (below) and was simply missing from the original
sweep, the same gap #1025 itself had. The fixture's two racing groups (4 and
3 checked-in racers) are both large enough to fill `EACH_GROUP`'s own request
— `TOP_N` per group, not `TOP_N` total (`domain.advancement.field_size`) — so
`_assert_championship_filled`'s exact-size check (below) is a real assertion
for those cells rather than one that would pass on a short field just as
easily.

Two doors, matching how an operator actually reaches each shape:

- The **general round** is always built through `createRoundWizard` — the
  same wizard `test_wizard_round_styles.py` drives, offering PPC,
  Elimination or Balanced from its own "How it's raced" step.
- A **championship round**, when the cell wants one, is added afterwards
  through `createRound` — the "Add Round" dialog's own mutation, not a
  second wizard call. This is deliberate, not merely convenient: the wizard
  itself auto-chains an "ALL"/"EACH_GROUP" championship source to
  `ROUND:<elimination round id>` when both are requested in the *same*
  wizard call (#1012's fix), which would silently protect every Elimination
  cell from ever reaching a broken configuration. `RoundConfigModal.tsx`'s
  own "Add Round" dialog carries no such chaining — its `source` picker
  offers only `ALL`, `EACH_GROUP`, or the *previous championship round*,
  never a general round directly — so an operator who runs the wizard for
  just a general round and later adds a championship round through "Add
  Round" reaches exactly the two-call sequence this sweep drives. That
  sequence is what surfaced #1054 below, for both `ALL` and `EACH_GROUP`.

Master running order, when a cell wants it on, is switched on and applied
*after* both rounds already exist — `updateRace(masterRunningOrder: true)`
then `applyMasterRunningOrder` — matching how an operator actually uses it:
the schedule is built first, then interleaved. Applying it before a second
round exists would leave that round's own default numbering (which always
starts at 1, independently, per round) free to collide with the
already-interleaved general round's numbers; applying it last is what keeps
every heat number in the race unique, and is also what a person composing a
race actually does.
"""

from __future__ import annotations

import pytest

from backend.db import crud, models, schemas
from backend.domain import lanes as lanes_module
from backend.domain.audit import ResultSource
from backend.services import awards as awards_service

WIZARD = """
mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
    createRoundWizard(raceId: $raceId, config: $config) {
        id
        roundNumber
        schedulingStrategy
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

UPDATE_RACE = """
mutation UpdateRace($id: Int!, $race: RaceUpdateInput!) {
    updateRace(id: $id, race: $race) {
        id
        masterRunningOrder
    }
}
"""

APPLY_MASTER_ORDER = """
mutation ApplyOrder($raceId: Int!) {
    applyMasterRunningOrder(raceId: $raceId) {
        updatedCount
    }
}
"""

RACE_STATUS = """
query RaceStatus($raceId: Int!) {
    race(raceId: $raceId) {
        status
    }
}
"""

COPY_SOURCE = """
query CopySource($raceId: Int!) {
    race(raceId: $raceId) {
        racingGroups { name color }
        roundPlan {
            generalRound {
                type
                schedulingStrategy
                runsPerLane
                eliminationLosses
                balancedPhases
            }
            championshipRounds {
                name
                source
                numTopRacers
                runsPerLane
                advancementFromBottom
                sourceRoundId
            }
        }
    }
}
"""

CREATE_RACE = """
mutation CreateRace($race: RaceInput!) {
    createRace(race: $race) {
        id
        rounds { id roundNumber advancementSource }
    }
}
"""

REGENERATE_ROUND = """
mutation Regenerate($roundId: Int!) {
    regenerateRound(roundId: $roundId) { id }
}
"""

RACER_COUNT = 7
LANE_COUNT = 4
TOP_N = 2


def _setup_race(db, label: str) -> tuple[models.Race, list[int]]:
    """A race with `RACER_COUNT` checked-in racers across two racing groups
    on a `LANE_COUNT`-lane track — big enough that Elimination runs several
    waves and Balanced gets a real phase count, per the brief this sweep was
    written from."""
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{label} Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name=f"{label} Track", lane_count=LANE_COUNT, timer_type="FAKE"
        ),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=label,
            organization_id=org.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    group_a = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves", color="#123456"), race.id
    )
    group_b = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Bears", color="#654321"), race.id
    )
    ids = []
    for n in range(RACER_COUNT):
        group_id = group_a.id if n % 2 == 0 else group_b.id
        racer = crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race.id,
                first_name=f"Racer{n}",
                last_name=label,
                car_number=n + 1,
                car_passed_inspection=True,
                racing_group_id=group_id,
            ),
        )
        ids.append(racer.id)
    return race, ids


def _create_general_round(
    client, race_id: int, style: str, runs_per_lane: int = 1
) -> int:
    """Build the general round through the wizard, alone — the same door
    `test_wizard_round_styles.py` drives. Returns its id.

    ``runs_per_lane`` defaults to 1, matching every cell of the 24-cell
    sweep above — the copy sweep below is what exercises a value other
    than the default, since #1119's review found that every existing test
    here (and in `test_create_race_round_plan.py`) used 1, which is
    exactly why `Round.runs_per_lane` being silently discarded on
    regeneration went uncaught.
    """
    general_round: dict = {"type": "ALL", "runsPerLane": runs_per_lane}
    if style != "PPC":
        general_round["schedulingStrategy"] = style
    body = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race_id,
                "config": {"generalRound": general_round, "championshipRounds": []},
            },
        },
    ).json()
    assert "errors" not in body, body
    [general] = body["data"]["createRoundWizard"]
    return general["id"]


def _create_championship_round(
    client, race_id: int, source: str
) -> tuple[int | None, list]:
    """Add a championship round through `createRound` — the "Add Round"
    dialog's own mutation, added *after* the general round already exists.

    Returns ``(round_id, errors)`` — a caller checking for a refusal reads
    the second half; one that expects success reads the first.
    """
    body = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {
                "raceId": race_id,
                "roundData": {
                    "name": "Grand Finals",
                    "advancementSource": source,
                    "advancementNumRacers": TOP_N,
                    "runsPerLane": 1,
                },
            },
        },
    ).json()
    errors = body.get("errors") or []
    if errors:
        return None, errors
    return body["data"]["createRound"][0]["id"], []


def _turn_on_master_running_order(client, race_id: int) -> None:
    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACE,
            "variables": {"id": race_id, "race": {"masterRunningOrder": True}},
        },
    ).json()
    assert "errors" not in body, body
    body2 = client.post(
        "/graphql", json={"query": APPLY_MASTER_ORDER, "variables": {"raceId": race_id}}
    ).json()
    assert "errors" not in body2, body2


def _pending_raceable_heats(db, race_id: int) -> list[models.Heat]:
    """Every official heat not yet finished, excluding one still holding an
    unresolved championship placeholder — the advancement cascade fills
    those in on its own once its source round decides, and a heat that
    still names a placeholder is not something anyone could hand a time to
    yet."""
    heats = crud.get_heats(db, race_id)
    heats_lanes = crud.lanes_for_heats(db, heats)
    pending = []
    for heat, lanes in zip(heats, heats_lanes, strict=True):
        if lanes_module.is_finished(lanes):
            continue
        if any(
            lane.placeholder_slot is not None and lane.racer_id is None
            for lane in lanes
        ):
            continue
        pending.append(heat)
    return pending


def _run_heat_favouring(db, heat: models.Heat, favourite_order: list[int]) -> None:
    """Record a heat: the earlier a racer appears in `favourite_order`, the
    better — the same helper shape `test_elimination.py`/`test_balanced.py`/
    `test_wizard_elimination_championship.py` all use, so the standings
    settle deterministically and the same racers keep qualifying."""
    stored = crud.heat_lanes_of(db, heat)
    racing = [lane for lane in stored if lane.racer_id]
    order = sorted(racing, key=lambda lane: favourite_order.index(lane.racer_id))
    recorded = [
        lanes_module.Lane(
            lane=lane.lane,
            racer_id=lane.racer_id,
            time=3.0 + order.index(lane) * 0.1,
            place=order.index(lane) + 1,
        )
        if lane.racer_id
        else lane
        for lane in stored
    ]
    crud.record_heat_result(db, heat.id, recorded, source=ResultSource.OPERATOR)


def _race_everything(
    db, race_id: int, favourite_order: list[int], max_iterations: int = 200
) -> None:
    """Race every heat that can be raced, including the waves/phases
    Elimination and Balanced append as results come in, until nothing more
    is raceable. A championship round stuck on an unresolved placeholder
    (its source never decides — see the Elimination/ALL cell below) simply
    stops appearing in `_pending_raceable_heats` and the loop ends without
    it, which is the failure this sweep exists to surface rather than hide."""
    for _ in range(max_iterations):
        pending = _pending_raceable_heats(db, race_id)
        if not pending:
            return
        for heat in pending:
            _run_heat_favouring(db, heat, favourite_order)
    raise AssertionError("race never stopped producing new heats to run")


def _race_status(client, race_id: int) -> str:
    body = client.post(
        "/graphql", json={"query": RACE_STATUS, "variables": {"raceId": race_id}}
    ).json()
    assert "errors" not in body, body
    status: str = body["data"]["race"]["status"]
    return status


def _assert_no_solo_heat_in_growing_rounds(db, race_id: int) -> None:
    """#1022's rule: an Elimination or Balanced round never leaves a heat —
    pending or already raced — with exactly one real racer in it. Every
    heat this sweep produces comes straight off `chunk_heats`, with no
    outage or withdrawal to strand a lane afterwards, so this is a
    guard against a *scheduling* regression, not a repeat of #1022 itself."""
    rounds = (
        db.query(models.Round)
        .filter(
            models.Round.race_id == race_id,
            models.Round.scheduling_strategy.in_(
                [
                    models.SchedulingStrategy.ELIMINATION,
                    models.SchedulingStrategy.BALANCED,
                ]
            ),
        )
        .all()
    )
    for round_obj in rounds:
        heats = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
        for heat, lanes in zip(heats, crud.lanes_for_heats(db, heats), strict=True):
            real = sum(1 for lane in lanes if lane.racer_id is not None)
            assert real != 1, (
                f"heat {heat.id} in round {round_obj.id} "
                f"({round_obj.scheduling_strategy}) has exactly one real racer"
            )


def _assert_heat_numbers_unique(db, race_id: int) -> None:
    heats = crud.get_heats(db, race_id)
    numbers = [heat.heat_number for heat in heats]
    assert len(numbers) == len(set(numbers)), f"duplicate heat_number values: {numbers}"


def _assert_championship_filled(db, round_id: int) -> None:
    """No unresolved placeholder remains, *and* the field that filled it is
    exactly what `crud.round_field_size` says it should be — not merely
    non-empty. Checking size as well as "no placeholders left" is what makes
    the `EACH_GROUP` cells genuinely test something: `EACH_GROUP`'s request
    is per racing group (`TOP_N * racing_group_count`, `domain.advancement.
    field_size`), and a fixture with too few checked-in racers in one group
    would let the round quietly shrink to a *short* field (`field_is_short`'s
    own rebuild) and still pass a bare "nothing is a placeholder" check —
    exactly the false confidence the brief asked this sweep to rule out.
    """
    round_obj = db.get(models.Round, round_id)
    assert round_obj is not None
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
    real_racer_ids: set[int] = set()
    for lanes in crud.lanes_for_heats(db, heats):
        for lane in lanes:
            assert not (lane.placeholder_slot is not None and lane.racer_id is None), (
                f"round {round_id} still holds an unresolved placeholder"
            )
            if lane.racer_id is not None:
                real_racer_ids.add(lane.racer_id)
    expected = crud.round_field_size(db, round_obj)
    assert len(real_racer_ids) == expected, (
        f"round {round_id} filled with {len(real_racer_ids)} racers "
        f"({sorted(real_racer_ids)}), but round_field_size says {expected}"
    )


def _assert_seeded_awards_resolve(db, race_id: int, round_id: int) -> None:
    """The championship trophies `createRound` seeds for this final (#1082)
    resolve to the round's own actual top finishers, in order, once the
    round is fully raced — not merely that seeding wrote the right number of
    rows. Ground truth comes from the round's own recorded lane times rather
    than from re-deriving who *should* have advanced (elimination and
    balanced waves make that a second copy of the scheduler); a seeded
    award's own source already points at this round (#862), so its
    recipient must agree with this round's own stopwatch regardless of how
    the field reached it.
    """
    source = f"ROUND:{round_id}"
    seeded = [
        award
        for award in crud.get_awards(db, race_id)
        if award.kind == models.AwardKind.SPEED and award.source == source
    ]
    assert seeded, f"no seeded awards found for round {round_id}"

    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    times: dict[int, float] = {}
    for lanes in crud.lanes_for_heats(db, heats):
        for lane in lanes:
            if lane.racer_id is not None and lane.time is not None:
                times[lane.racer_id] = lane.time
    racer_group = {
        racer.id: racer.racing_group_id
        for racer in db.query(models.Racer).filter(models.Racer.race_id == race_id)
    }

    recipients = awards_service.recipients_for(db, race_id)
    by_group: dict[int | None, list[models.Award]] = {}
    for award in seeded:
        by_group.setdefault(award.racing_group_id, []).append(award)

    for group_id, group_awards in by_group.items():
        eligible_ids = [
            racer_id
            for racer_id in times
            if group_id is None or racer_group.get(racer_id) == group_id
        ]
        eligible_ids.sort(key=lambda racer_id: times[racer_id])
        for award in group_awards:
            expected = (
                eligible_ids[award.place - 1]
                if award.place - 1 < len(eligible_ids)
                else None
            )
            actual = recipients.get(award.id)
            assert actual == expected, (
                f"seeded award {award.id} (place {award.place}, group "
                f"{group_id}) resolved to {actual}, expected {expected}"
            )


CELLS = [
    ("PPC", "none", "off"),
    ("PPC", "none", "on"),
    ("PPC", "ALL", "off"),
    ("PPC", "ALL", "on"),
    ("PPC", "EACH_GROUP", "off"),
    ("PPC", "EACH_GROUP", "on"),
    ("PPC", "ROUND", "off"),
    ("PPC", "ROUND", "on"),
    ("ELIMINATION", "none", "off"),
    ("ELIMINATION", "none", "on"),
    # createRound's championship branch used to treat "ALL"/"EACH_GROUP" the
    # same as any other race — neither got the wizard's ROUND:<elimination>
    # chaining, so a championship round added this way (rather than in the
    # wizard's own call) could never fill (#1054). Fixed by sharing the
    # chaining rule through `crud.resolve_championship_source_for_race`.
    ("ELIMINATION", "ALL", "off"),
    ("ELIMINATION", "ALL", "on"),
    ("ELIMINATION", "EACH_GROUP", "off"),
    ("ELIMINATION", "EACH_GROUP", "on"),
    ("ELIMINATION", "ROUND", "off"),
    ("ELIMINATION", "ROUND", "on"),
    ("BALANCED", "none", "off"),
    ("BALANCED", "none", "on"),
    ("BALANCED", "ALL", "off"),
    ("BALANCED", "ALL", "on"),
    ("BALANCED", "EACH_GROUP", "off"),
    ("BALANCED", "EACH_GROUP", "on"),
    ("BALANCED", "ROUND", "off"),
    ("BALANCED", "ROUND", "on"),
]


@pytest.mark.parametrize(("general_style", "championship_shape", "master_order"), CELLS)
def test_format_crossing(db, client, general_style, championship_shape, master_order):
    label = f"Crossing {general_style} {championship_shape} {master_order}"
    race, ids = _setup_race(db, label)

    general_round_id = _create_general_round(client, race.id, general_style)

    champ_round_id = None
    if championship_shape in ("ALL", "EACH_GROUP"):
        champ_round_id, errors = _create_championship_round(
            client, race.id, championship_shape
        )
        assert not errors, (
            f"createRound refused {championship_shape} for a {general_style} "
            f"general round: {errors}"
        )
    elif championship_shape == "ROUND":
        champ_round_id, errors = _create_championship_round(
            client, race.id, f"ROUND:{general_round_id}"
        )
        assert not errors, (
            f"createRound refused ROUND:<general> for a {general_style} "
            f"general round: {errors}"
        )

    if master_order == "on":
        _turn_on_master_running_order(client, race.id)

    _race_everything(db, race.id, ids)

    if master_order == "on":
        _assert_heat_numbers_unique(db, race.id)

    _assert_no_solo_heat_in_growing_rounds(db, race.id)

    if champ_round_id is not None:
        _assert_championship_filled(db, champ_round_id)
        _assert_seeded_awards_resolve(db, race.id, champ_round_id)

    status = _race_status(client, race.id)
    assert status == "FINISHED", f"race never reached FINISHED (status={status})"


def _copy_race_via_round_plan(
    client, db, source_race_id: int, label: str
) -> tuple[int, list[int], int, int | None]:
    """Build a *second* race the way the setup wizard's copy step does
    (#1088): `Race.roundPlan` off the source race, `createRace` with that
    plan and the source's racing groups. Returns
    ``(race_id, racer_ids, general_round_id, championship_round_id)``.

    A round plan copied at race-creation time has no roster yet — the
    general round is created with no heats (`crud.create_rounds_from_plan`'s
    `tolerate_empty_roster`) rather than refusing the whole race — so this
    adds a roster afterwards, the same order an operator actually follows
    (create the race, then import or add racers), and calls
    `regenerateRound` on the general round once there is one to schedule,
    the same manual step that recovers a round from a lane outage.
    """
    source_body = client.post(
        "/graphql",
        json={"query": COPY_SOURCE, "variables": {"raceId": source_race_id}},
    ).json()
    assert "errors" not in source_body, source_body
    source = source_body["data"]["race"]
    plan = source["roundPlan"]
    assert plan is not None

    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{label} Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name=f"{label} Track", lane_count=LANE_COUNT, timer_type="FAKE"
        ),
    )

    create_body = client.post(
        "/graphql",
        json={
            "query": CREATE_RACE,
            "variables": {
                "race": {
                    "name": label,
                    "organizationId": org.id,
                    "trackId": track.id,
                    "carNumberingStrategy": "MANUAL",
                    "racingGroups": [
                        {"name": g["name"], "color": g["color"]}
                        for g in source["racingGroups"]
                    ],
                    "roundPlan": plan,
                }
            },
        },
    ).json()
    assert "errors" not in create_body, create_body
    new_race = create_body["data"]["createRace"]
    race_id: int = new_race["id"]

    group_by_name = {g.name: g.id for g in crud.get_racing_groups(db, race_id)}
    ids = []
    for n in range(RACER_COUNT):
        group_name = "Wolves" if n % 2 == 0 else "Bears"
        racer = crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race_id,
                first_name=f"Racer{n}",
                last_name=label,
                car_number=n + 1,
                car_passed_inspection=True,
                racing_group_id=group_by_name.get(group_name),
            ),
        )
        ids.append(racer.id)

    general_round_id = next(
        r["id"] for r in new_race["rounds"] if r["advancementSource"] is None
    )
    championship_round_id = next(
        (r["id"] for r in new_race["rounds"] if r["advancementSource"] is not None),
        None,
    )

    regen_body = client.post(
        "/graphql",
        json={"query": REGENERATE_ROUND, "variables": {"roundId": general_round_id}},
    ).json()
    assert "errors" not in regen_body, regen_body

    return race_id, ids, general_round_id, championship_round_id


# A representative subset, not the full 24-cell sweep above (#1088's own
# note: doubling this file's runtime for what is, past the copy step
# itself, the identical race-to-FINISHED proof already run once per cell).
# One cell per general style, plus both ways a championship round can name
# its source once copied (`ALL`/`EACH_GROUP` derived from the wizard's own
# literal answer, `ROUND:<id>` recovered and re-chained by `domain.
# round_plan.plan_from_rounds` — see its docstring for what "recovered"
# means when the original round was elimination-chained).
COPY_CELLS = [
    ("PPC", "none"),
    ("PPC", "ALL"),
    ("ELIMINATION", "ALL"),
    ("ELIMINATION", "ROUND"),
    ("BALANCED", "EACH_GROUP"),
    ("BALANCED", "ROUND"),
]


@pytest.mark.parametrize(("general_style", "championship_shape"), COPY_CELLS)
def test_copied_round_plan_races_to_finished(
    db, client, general_style, championship_shape
):
    """The proof #1088 asked this sweep for: a race built by copying
    another race's round plan reaches `FINISHED` the same way a wizard-built
    one does, for a representative spread of general styles and
    championship shapes — the plan copied is a real plan, not merely a
    shape that *looks* like the original wizard answer.
    """
    label = f"CopySource {general_style} {championship_shape}"
    race, ids = _setup_race(db, label)

    # 2 runs per lane for the PPC cells — every other test in this file and
    # in `test_create_race_round_plan.py` used 1 (the wizard's own default),
    # which is exactly how `Round.runs_per_lane` being silently discarded on
    # `regenerateRound` (#1119's review) went uncaught: PPC is the only
    # general style `generate_heats_for_round`'s `runs` parameter actually
    # multiplies the heat count by (elimination/balanced schedule one
    # wave/phase regardless of it), so only those two cells can prove it.
    source_runs_per_lane = 2 if general_style == "PPC" else 1
    general_round_id = _create_general_round(
        client, race.id, general_style, runs_per_lane=source_runs_per_lane
    )

    if championship_shape in ("ALL", "EACH_GROUP"):
        _champ_round_id, errors = _create_championship_round(
            client, race.id, championship_shape
        )
        assert not errors, errors
    elif championship_shape == "ROUND":
        _champ_round_id, errors = _create_championship_round(
            client, race.id, f"ROUND:{general_round_id}"
        )
        assert not errors, errors

    copy_label = f"Copy {general_style} {championship_shape}"
    new_race_id, new_ids, new_general_id, new_champ_id = _copy_race_via_round_plan(
        client, db, race.id, copy_label
    )

    if general_style == "PPC":
        # The bug #1119's review found: `regenerateRound` on the copied
        # general round (built with zero heats, `tolerate_empty_roster`)
        # used to fall back to 1 run per lane regardless of what the plan
        # asked for, since there were no existing heats to derive the count
        # from. `_copy_race_via_round_plan` has already called
        # `regenerateRound` once a roster exists; RACER_COUNT * 2 heats
        # proves the copied `runs_per_lane` survived that round trip.
        general_heats = (
            db.query(models.Heat).filter(models.Heat.round_id == new_general_id).all()
        )
        assert len(general_heats) == RACER_COUNT * 2, (
            f"expected {RACER_COUNT * 2} heats (2 runs per lane, copied from "
            f"the source), got {len(general_heats)}"
        )

    _race_everything(db, new_race_id, new_ids)

    _assert_no_solo_heat_in_growing_rounds(db, new_race_id)

    if new_champ_id is not None:
        _assert_championship_filled(db, new_champ_id)
        _assert_seeded_awards_resolve(db, new_race_id, new_champ_id)

    status = _race_status(client, new_race_id)
    assert status == "FINISHED", f"copied race never reached FINISHED (status={status})"
