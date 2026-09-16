"""The format sweep #1025 asked for and #1052 tracks — general round style
crossed with championship shape crossed with the master running order,
raced to the end (#1052, item 3).

The per-bug seam tests elsewhere in this suite each cross exactly two
features together, one bug at a time — `test_wizard_elimination_championship.py`
for GENERAL-vs-elimination chaining, `test_master_running_order_repair.py` for
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
  same wizard `test_wizard_round_styles.py` drives, offering GENERAL,
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
from backend.services import scoring

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

CREATE_AWARD = """
mutation CreateDistrictAward($raceId: Int!, $award: AwardInput!) {
    createAward(raceId: $raceId, award: $award) {
        id
    }
}
"""

RACER_COUNT = 7
LANE_COUNT = 4
TOP_N = 2


def _setup_race(
    db,
    label: str,
    racer_count: int = RACER_COUNT,
    lane_count: int = LANE_COUNT,
) -> tuple[models.Race, list[int]]:
    """A race with `racer_count` checked-in racers across two racing groups
    on a `lane_count`-lane track — big enough that Elimination runs several
    waves and Balanced gets a real phase count, per the brief this sweep was
    written from.

    ``racer_count``/``lane_count`` default to the module's own `RACER_COUNT`
    and `LANE_COUNT` (every cell of the 24-cell sweep uses the defaults);
    the PERFECT_N crossing below is the one caller that overrides both, to
    land on a field size `perfect_n_tables.CHARTS` actually covers — a
    Perfect-N chart, unlike PPC and ROTATION, does not degrade to serve an
    arbitrary field.
    """
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{label} Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name=f"{label} Track", lane_count=lane_count, timer_type="FAKE"
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
    for n in range(racer_count):
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
    client, race_id: int, style: str, runs_per_lane: int = 1, algorithm: str = "PPC"
) -> int:
    """Build the general round through the wizard, alone — the same door
    `test_wizard_round_styles.py` drives. Returns its id.

    ``runs_per_lane`` defaults to 1, matching every cell of the 24-cell
    sweep above — the copy sweep below is what exercises a value other
    than the default, since #1119's review found that every existing test
    here (and in `test_create_race_round_plan.py`) used 1, which is
    exactly why `Round.runs_per_lane` being silently discarded on
    regeneration went uncaught.

    ``algorithm`` (#1090) is only sent when it names something other than
    the default — omitted for ``"PPC"`` so every existing cell's request
    body is byte-for-byte what it always was, and never sent at all for a
    non-``GENERAL`` style, which has its own fixed algorithm and ignores
    the field.
    """
    general_round: dict = {"type": "ALL", "runsPerLane": runs_per_lane}
    if style != "GENERAL":
        general_round["schedulingStrategy"] = style
    elif algorithm != "PPC":
        general_round["algorithm"] = algorithm
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
    ("GENERAL", "none", "off"),
    ("GENERAL", "none", "on"),
    ("GENERAL", "ALL", "off"),
    ("GENERAL", "ALL", "on"),
    ("GENERAL", "EACH_GROUP", "off"),
    ("GENERAL", "EACH_GROUP", "on"),
    ("GENERAL", "ROUND", "off"),
    ("GENERAL", "ROUND", "on"),
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


# The algorithm axis (#1090): PPC × ROTATION over the same 24 cells above.
# Meaningful only for a `GENERAL`-style general round — `ELIMINATION` and
# `BALANCED` build their own schedules and ignore `algorithm` entirely, so
# crossing them with `ROTATION` would be the identical race already proven
# by the `PPC` cell, run a second time for nothing. Those 16 cells are
# skipped rather than left out of the parametrization, so the 48-id list
# stays the honest record of what this sweep covers and why a given id did
# or did not run — doubling the file's slowest, most valuable 8 cells
# (`GENERAL` × 4 championship shapes × 2 master-order settings) rather than
# the whole 24.
ALGORITHMS = ["PPC", "ROTATION"]


@pytest.mark.parametrize(("general_style", "championship_shape", "master_order"), CELLS)
@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_format_crossing(
    db, client, algorithm, general_style, championship_shape, master_order
):
    if algorithm != "PPC" and general_style != "GENERAL":
        pytest.skip(f"algorithm is meaningless for a {general_style} general round")

    label = f"Crossing {algorithm} {general_style} {championship_shape} {master_order}"
    race, ids = _setup_race(db, label)

    general_round_id = _create_general_round(
        client, race.id, general_style, algorithm=algorithm
    )

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


# PERFECT_N joins the algorithm axis on its own field size (#1090, part C):
# the module's 24-cell sweep is fixed at RACER_COUNT=7 / LANE_COUNT=4, and
# no Perfect-N chart exists for that shape (`perfect_n_tables.CHARTS` has no
# `(4, 7)` entry — see that module's docstring for which shapes do). Rather
# than change the field size every other cell in this file already relies
# on, this crosses the same 8 GENERAL cells (championship shape × master
# order) at 5 racers / 4 lanes, matching `CHARTS[(4, 5)]`.
PERFECT_N_RACER_COUNT = 5
PERFECT_N_LANE_COUNT = 4
GENERAL_CELLS = [
    (championship_shape, master_order)
    for (general_style, championship_shape, master_order) in CELLS
    if general_style == "GENERAL"
]


@pytest.mark.parametrize(("championship_shape", "master_order"), GENERAL_CELLS)
def test_format_crossing_perfect_n(db, client, championship_shape, master_order):
    label = f"Crossing PERFECT_N {championship_shape} {master_order}"
    race, ids = _setup_race(
        db,
        label,
        racer_count=PERFECT_N_RACER_COUNT,
        lane_count=PERFECT_N_LANE_COUNT,
    )

    general_round_id = _create_general_round(
        client, race.id, "GENERAL", algorithm="PERFECT_N"
    )

    champ_round_id = None
    if championship_shape in ("ALL", "EACH_GROUP"):
        champ_round_id, errors = _create_championship_round(
            client, race.id, championship_shape
        )
        assert not errors, (
            f"createRound refused {championship_shape} for a PERFECT_N "
            f"general round: {errors}"
        )
    elif championship_shape == "ROUND":
        champ_round_id, errors = _create_championship_round(
            client, race.id, f"ROUND:{general_round_id}"
        )
        assert not errors, (
            f"createRound refused ROUND:<general> for a PERFECT_N "
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
    ("GENERAL", "none"),
    ("GENERAL", "ALL"),
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

    # 2 runs per lane for the GENERAL cells — every other test in this file and
    # in `test_create_race_round_plan.py` used 1 (the wizard's own default),
    # which is exactly how `Round.runs_per_lane` being silently discarded on
    # `regenerateRound` (#1119's review) went uncaught: GENERAL is the only
    # general style `generate_heats_for_round`'s `runs` parameter actually
    # multiplies the heat count by (elimination/balanced schedule one
    # wave/phase regardless of it), so only those two cells can prove it.
    source_runs_per_lane = 2 if general_style == "GENERAL" else 1
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

    if general_style == "GENERAL":
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


# --------------------------------------------------------------------------- #
# The district cell (#1076, stage 2 — "proof the flow holds end to end")      #
# --------------------------------------------------------------------------- #
#
# A district or council event races several ranks (Lion through AOL) as
# sequential blocks on one track, cuts within a rank, and combines the
# rank winners into one grand final (#1076's "Rescoped" section). Every
# piece already exists — racing groups standing in for ranks, an
# `EACH_GROUP` *general* round to split qualifying one round per rank
# (`crud.create_general_round`, #1013), an `EACH_GROUP` *championship*
# round to draw the grand final's field, `Racer.home_unit` for the
# roster/announcer line (#1076 stage 1) — so this is a composition proof,
# in the tradition of the sweep above: build the event through the same
# doors an operator uses, race it to the end, and check the pieces agree
# with each other rather than with a second, hand-derived copy of the
# answer.
#
# **The knockout stage is the chained-championship-round shape, not a
# per-rank bracket.** The issue's brief for this stage names two options —
# "a `ROUND:<grand-final>`-style second championship round, or a per-rank
# knockout" — and only the first is expressible with today's
# `advancement_source` vocabulary. `createRound`'s championship branch
# always builds *one* round for an `EACH_GROUP` source (`crud.create_round`,
# not `crud.create_general_round`'s per-group loop, which only a *general*
# round gets), and a source can only ever name one round
# (`ALL`/`EACH_GROUP`/`ROUND:<id>` — `.claude/rules/advancement-and-awards.md`'s
# "Championship advancement"). A genuine per-rank knockout — four separate
# brackets, one per rank, each feeding the grand final on its own — would
# need a final whose source names *several* rounds at once, which is
# exactly the `ROUNDS:<id>,<id>,<id>` source the original (iceboxed)
# multi-track sketch at the foot of #1076 proposes and which does not
# exist yet. So "knockout" here is an intermediate `EACH_GROUP`
# championship round (top `DISTRICT_KNOCKOUT_N` per rank, combined into one
# field) that the grand final then chains to with `ROUND:<knockout id>` —
# the two-championship-round chain the existing sweep's own `"ROUND"`
# cells already exercise, just with a district-shaped field underneath it.
DISTRICT_RANKS = ["Lions", "Tigers", "Wolves", "Bears"]
DISTRICT_RACERS_PER_RANK = 5
DISTRICT_LANE_COUNT = 4
DISTRICT_GRAND_FINAL_N = 2
DISTRICT_KNOCKOUT_N = 3
DISTRICT_HOME_UNITS = ["Pack 12", "Pack 30", "Pack 45"]

# The algorithm axis (#1090) crosses PPC/ROTATION/PERFECT_N, not just the
# PPC/ROTATION pair the general sweep above uses. Perfect-N is included
# because `DISTRICT_RACERS_PER_RANK` (5) racers on a `DISTRICT_LANE_COUNT`
# (4) lane track is exactly `perfect_n_tables.CHARTS[(4, 5)]`'s own shape —
# the identical (lanes, cars) pair `test_format_crossing_perfect_n` above
# already relies on for the general sweep, so there is a real chart behind
# every rank's own qualifying round here too.
DISTRICT_ALGORITHMS = ["PPC", "ROTATION", "PERFECT_N"]


def _setup_district_race(
    db, label: str
) -> tuple[models.Race, dict[str, list[int]], dict[str, int]]:
    """A district event: `DISTRICT_RANKS` as racing groups (the issue's
    "ranks"), each with `DISTRICT_RACERS_PER_RANK` checked-in racers
    carrying a `home_unit` drawn from a handful of packs (#1076's "a dozen
    packs send their qualifiers"). Returns ``(race, {rank: [racer_id,
    ...]}, {rank: racing_group_id})``.

    `championship_trophies=0` — the district cell creates exactly the
    awards it means to assert against, through `createAward` below, rather
    than the per-racing-group set `crud.seed_championship_awards` would
    otherwise attach to whichever championship round is created first
    (`.claude/rules/advancement-and-awards.md`'s "Awards": an `EACH_GROUP`
    final's auto-seeded trophies are already one set *per group*, which
    for a district's grand final would mean one trophy per rank scoped to
    *that* round rather than the single grand-final trophy and the
    separate, qualifying-round-scoped rank championships this cell wants).
    """
    org = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"{label} District")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name=f"{label} Track", lane_count=DISTRICT_LANE_COUNT, timer_type="FAKE"
        ),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=label,
            organization_id=org.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
            championship_trophies=0,
        ),
    )
    groups: dict[str, int] = {}
    racer_ids: dict[str, list[int]] = {}
    car_number = 1
    for rank in DISTRICT_RANKS:
        group = crud.create_racing_group(
            db, schemas.RacingGroupCreate(name=rank, color="#123456"), race.id
        )
        groups[rank] = group.id
        ids = []
        for n in range(DISTRICT_RACERS_PER_RANK):
            racer = crud.create_racer(
                db,
                schemas.RacerCreate(
                    race_id=race.id,
                    first_name=f"{rank}{n}",
                    last_name=label,
                    car_number=car_number,
                    car_passed_inspection=True,
                    racing_group_id=group.id,
                    home_unit=DISTRICT_HOME_UNITS[
                        car_number % len(DISTRICT_HOME_UNITS)
                    ],
                ),
            )
            ids.append(racer.id)
            car_number += 1
        racer_ids[rank] = ids
    return race, racer_ids, groups


def _create_district_qualifying_rounds(
    client, race_id: int, algorithm: str
) -> dict[str, int]:
    """One `GENERAL` round per rank — the wizard's `"EACH_GROUP"` general
    round type (#1013), the same door `_create_general_round` above uses
    for `"ALL"`. Returns ``{rank: round_id}``, matched by position: the
    wizard's `EACH_GROUP` loop (`crud.create_general_round`) visits racing
    groups in `get_racing_groups`'s own id order, which is racing-group
    creation order — `DISTRICT_RANKS`' own order, since
    `_setup_district_race` creates them in that order and none is empty.
    """
    general_round: dict = {"type": "EACH_GROUP", "runsPerLane": 1}
    if algorithm != "PPC":
        general_round["algorithm"] = algorithm
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
    rounds = body["data"]["createRoundWizard"]
    assert len(rounds) == len(DISTRICT_RANKS), (
        f"expected one qualifying round per rank, got {len(rounds)}: {rounds}"
    )
    return {rank: r["id"] for rank, r in zip(DISTRICT_RANKS, rounds, strict=True)}


def _create_district_championship_round(
    client, race_id: int, *, name: str, source: str, num_racers: int
) -> int:
    """Add a championship round through `createRound`'s "Add Round" door —
    the knockout or the grand final, both built this way, matching the
    general sweep's own `_create_championship_round` convention above."""
    body = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {
                "raceId": race_id,
                "roundData": {
                    "name": name,
                    "advancementSource": source,
                    "advancementNumRacers": num_racers,
                    "runsPerLane": 1,
                },
            },
        },
    ).json()
    errors = body.get("errors") or []
    assert not errors, f"createRound refused {source!r}: {errors}"
    return int(body["data"]["createRound"][0]["id"])


def _create_speed_award(client, race_id: int, *, name: str, round_id: int) -> int:
    """A `SPEED` award for first place in one round's own standings —
    through `createAward`, the same door the Awards page's own form uses."""
    body = client.post(
        "/graphql",
        json={
            "query": CREATE_AWARD,
            "variables": {
                "raceId": race_id,
                "award": {
                    "name": name,
                    "kind": "SPEED",
                    "source": f"ROUND:{round_id}",
                    "place": 1,
                },
            },
        },
    ).json()
    assert "errors" not in body, body
    return int(body["data"]["createAward"]["id"])


def _update_race(client, race_id: int, fields: dict) -> None:
    body = client.post(
        "/graphql",
        json={"query": UPDATE_RACE, "variables": {"id": race_id, "race": fields}},
    ).json()
    assert "errors" not in body, body


def _real_racer_ids_in_round(db, round_id: int) -> set[int]:
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    ids: set[int] = set()
    for lanes in crud.lanes_for_heats(db, heats):
        for lane in lanes:
            if lane.racer_id is not None:
                ids.add(lane.racer_id)
    return ids


def _top_n_ids(db, race_id: int, round_id: int, n: int) -> list[int]:
    """The top `n` racer ids in one round's own standings, best first —
    `services.scoring`'s own leaderboard, never a hand-computed ranking."""
    entries = scoring.get_leaderboard(db, race_id, round_id=round_id)
    return [entry["racer_id"] for entry in entries[:n]]


@pytest.mark.parametrize("master_order", ["off", "on"])
@pytest.mark.parametrize("knockout", ["off", "on"])
@pytest.mark.parametrize("algorithm", DISTRICT_ALGORITHMS)
def test_district_derby_crossing(db, client, algorithm, knockout, master_order):
    """#1076 stage 2: the district-derby flow, end to end.

    Shape: `DISTRICT_RANKS` (4) as racing groups, each racing its own
    qualifying round (`"EACH_GROUP"` general round, one per rank) with
    `DISTRICT_RACERS_PER_RANK` (5) checked-in racers apiece, each carrying
    a `home_unit` from one of `DISTRICT_HOME_UNITS`. A grand final
    (`createRound`, `advancement_source="EACH_GROUP"`, top
    `DISTRICT_GRAND_FINAL_N` per rank) draws one combined field; with
    ``knockout == "on"`` an intermediate `EACH_GROUP` round (top
    `DISTRICT_KNOCKOUT_N` per rank) sits between qualifying and the final,
    chained the ordinary way (`ROUND:<knockout id>`) — see this module's
    own note above for why that is the shape tested rather than a per-rank
    bracket. `master_order`, when "on", is switched on the same way the
    general sweep above does it — `_turn_on_master_running_order` right
    after every round exists, before any racing — and is what caught #1076
    stage 2's own review-found seam: two *chained* championship rounds
    (the knockout, then a grand final drawing from it) are new territory
    the 24-cell sweep above never reaches (`championship_shape` there is
    always exactly one round), and each independently restarted its own
    heat numbering at 1 on every invalidation-driven rebuild, colliding
    with the other for as long as neither had been raced — fixed in
    `crud._next_master_order_heat_number` (`generate_heats_for_round` and
    `_reset_heats_in_place`). Scoring strategy is left at the module
    default, `TIMED` — the sweep above never parametrizes `ScoringStrategy`
    either, and a district event's own "one track, cuts by time"
    description (#1076) is exactly what `TIMED` models; `POINTS`'s
    sum-of-placements would need every rank to run the same heat count to
    stay fair, which nothing about this format changes, so there is
    nothing new here for it to catch.

    Invariants: every rank's qualifying field is disjoint and equals its
    checked-in racers; the grand-final (and, with a knockout, the
    knockout's own) field is exactly the per-round top N by
    `services.scoring`'s standings; each rank's champion award — sourced
    from that rank's own qualifying round, never the combined final —
    resolves to that rank's 1st; the grand-final trophy resolves to
    exactly one racer; "at most one trophy per racer" (`roll_down.py`)
    rolls a double winner's rank championship down to their rank's
    runner-up once `Race.oneTrophyPerRacer` is on; heat numbers are
    globally unique once `master_order` is "on" (matching the general
    sweep's own `_assert_heat_numbers_unique`, called under the identical
    condition); and the race reaches `FINISHED`.
    """
    label = f"District {algorithm} {knockout} {master_order}"
    race, racer_ids, _groups = _setup_district_race(db, label)
    checked_in_by_rank = {rank: set(ids) for rank, ids in racer_ids.items()}

    qualifying_round_ids = _create_district_qualifying_rounds(
        client, race.id, algorithm
    )

    if knockout == "on":
        knockout_round_id: int | None = _create_district_championship_round(
            client,
            race.id,
            name="Knockout",
            source="EACH_GROUP",
            num_racers=DISTRICT_KNOCKOUT_N,
        )
        final_round_id = _create_district_championship_round(
            client,
            race.id,
            name="Grand Final",
            source=f"ROUND:{knockout_round_id}",
            num_racers=DISTRICT_GRAND_FINAL_N,
        )
    else:
        knockout_round_id = None
        final_round_id = _create_district_championship_round(
            client,
            race.id,
            name="Grand Final",
            source="EACH_GROUP",
            num_racers=DISTRICT_GRAND_FINAL_N,
        )

    if master_order == "on":
        _turn_on_master_running_order(client, race.id)

    # Every racer id, fastest-overall first. `_run_heat_favouring` ranks a
    # heat's own real racers by their position in this list, so the racer
    # listed first beats every rank-mate in qualifying (their rank's own
    # champion) *and* beats every other rank's qualifier once the fields
    # combine in the knockout/final — the double winner the roll-down
    # assertion below needs, produced for free rather than rigged
    # separately.
    favourite_order = [rid for rank in DISTRICT_RANKS for rid in racer_ids[rank]]

    _race_everything(db, race.id, favourite_order)

    if master_order == "on":
        _assert_heat_numbers_unique(db, race.id)

    _assert_no_solo_heat_in_growing_rounds(db, race.id)

    # Invariant: every rank's qualifying field is disjoint and equals the
    # rank's own checked-in racers.
    seen: set[int] = set()
    for rank in DISTRICT_RANKS:
        field = _real_racer_ids_in_round(db, qualifying_round_ids[rank])
        assert field == checked_in_by_rank[rank], (
            f"{rank}'s qualifying round held {sorted(field)}, expected "
            f"{sorted(checked_in_by_rank[rank])}"
        )
        assert not (field & seen), f"{rank}'s qualifying field overlaps another rank's"
        seen |= field

    # Invariant: the grand-final field (and the knockout's, if there is
    # one) is exactly the per-round top N, against `services.scoring`'s
    # own standings.
    if knockout_round_id is not None:
        _assert_championship_filled(db, knockout_round_id)
        knockout_expected: set[int] = set()
        for rank in DISTRICT_RANKS:
            knockout_expected |= set(
                _top_n_ids(db, race.id, qualifying_round_ids[rank], DISTRICT_KNOCKOUT_N)
            )
        knockout_actual = _real_racer_ids_in_round(db, knockout_round_id)
        assert knockout_actual == knockout_expected, (
            f"knockout field {sorted(knockout_actual)} != expected "
            f"{sorted(knockout_expected)}"
        )
        final_expected = set(
            _top_n_ids(db, race.id, knockout_round_id, DISTRICT_GRAND_FINAL_N)
        )
    else:
        final_expected = set()
        for rank in DISTRICT_RANKS:
            final_expected |= set(
                _top_n_ids(
                    db, race.id, qualifying_round_ids[rank], DISTRICT_GRAND_FINAL_N
                )
            )

    _assert_championship_filled(db, final_round_id)
    final_actual = _real_racer_ids_in_round(db, final_round_id)
    assert final_actual == final_expected, (
        f"grand-final field {sorted(final_actual)} != expected {sorted(final_expected)}"
    )

    # Awards: a champion per rank, sourced from that rank's own qualifying
    # round, and a single grand-final trophy.
    champion_award_ids = {
        rank: _create_speed_award(
            client,
            race.id,
            name=f"{rank} Champion",
            round_id=qualifying_round_ids[rank],
        )
        for rank in DISTRICT_RANKS
    }
    grand_final_award_id = _create_speed_award(
        client, race.id, name="Grand Final Champion", round_id=final_round_id
    )

    # Invariant: each rank's champion resolves to that rank's own 1st, and
    # the grand-final trophy resolves to exactly one racer — isolated
    # resolution (no roll-down yet), so a collision (below) is visible as
    # exactly that: two awards agreeing on the same racer.
    recipients = awards_service.recipients_for(db, race.id)
    for rank in DISTRICT_RANKS:
        expected = _top_n_ids(db, race.id, qualifying_round_ids[rank], 1)[0]
        assert recipients[champion_award_ids[rank]] == expected, (
            f"{rank} champion resolved to {recipients[champion_award_ids[rank]]}, "
            f"expected {expected}"
        )
    grand_final_winner = _top_n_ids(db, race.id, final_round_id, 1)[0]
    assert grand_final_winner is not None
    assert recipients[grand_final_award_id] == grand_final_winner

    # `favourite_order[0]` beats every rank-mate and every other rank's
    # qualifier alike, so they hold both their own rank's championship and
    # the grand final at this point — the collision "at most one trophy per
    # racer" exists to resolve.
    fastest_overall = favourite_order[0]
    fastest_overall_rank = next(
        rank for rank in DISTRICT_RANKS if fastest_overall in racer_ids[rank]
    )
    assert grand_final_winner == fastest_overall
    assert recipients[champion_award_ids[fastest_overall_rank]] == fastest_overall

    # Invariant: "at most one trophy per racer" (`domain/roll_down.py`).
    # The grand final is the race-wide podium and is resolved first
    # (`roll_down.priority_order`: race-wide before group-scoped), so the
    # double winner keeps it; their own rank's championship — a
    # group-scoped podium — rolls down to the next fastest racer in that
    # rank's own qualifying standings.
    _update_race(client, race.id, {"oneTrophyPerRacer": True})
    resolutions = awards_service.resolutions_for(db, race.id, one_trophy_per_racer=True)

    grand_final_resolution = resolutions[grand_final_award_id]
    assert grand_final_resolution.recipient == fastest_overall

    rank_standings = _top_n_ids(
        db, race.id, qualifying_round_ids[fastest_overall_rank], 2
    )
    runner_up = rank_standings[1]
    rank_resolution = resolutions[champion_award_ids[fastest_overall_rank]]
    assert rank_resolution.recipient == runner_up, (
        f"{fastest_overall_rank} champion should roll down to {runner_up}, "
        f"got {rank_resolution.recipient}"
    )
    assert any(
        passed.racer_id == fastest_overall for passed in rank_resolution.passed_over
    ), "the roll-down's own passed_over list should name the double winner"

    status = _race_status(client, race.id)
    assert status == "FINISHED", (
        f"district race never reached FINISHED (status={status})"
    )
