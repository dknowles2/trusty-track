"""``createRound``'s championship branch chaining around an Elimination
qualifier, the way ``createRoundWizard`` already does (#1012, #1054).

``domain.advancement.resolve_championship_source`` is the one rule shared by
both doors — see its docstring for the reasoning. This file is the seam test
for `createRound`'s own I/O half, `crud.resolve_championship_source_for_race`,
plus the mutation end to end: a championship round added through "Add Round"
after an Elimination general round already exists must chain to it, exactly
as the wizard already does when both are requested in the same call.
"""

from backend.db import crud, models, schemas
from backend.domain import advancement
from backend.domain import lanes as lanes_module
from backend.domain.audit import ResultSource

CREATE_ROUND = """
mutation CreateRound($raceId: Int!, $roundData: RoundCreateInput!) {
    createRound(raceId: $raceId, roundData: $roundData) {
        id
        advancementSource
    }
}
"""


def _race(db, name: str) -> models.Race:
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{name} Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{name} Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name=name,
            organization_id=org.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )


def _racers(db, race_id: int, count: int) -> list[int]:
    return [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race_id,
                first_name=f"Racer{n}",
                last_name="AddRound",
                car_number=n + 1,
                car_passed_inspection=True,
            ),
        ).id
        for n in range(count)
    ]


def _run_heat_favouring(db, heat: models.Heat, favourite_order: list[int]) -> None:
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


def _pending_heats(db, round_id: int) -> list[models.Heat]:
    heats = (
        db.query(models.Heat)
        .filter(models.Heat.round_id == round_id)
        .order_by(models.Heat.heat_number)
        .all()
    )
    return [h for h in heats if not lanes_module.is_finished(crud.heat_lanes_of(db, h))]


def _race_elimination_to_a_winner(
    db, round_id: int, favourite_order: list[int], max_waves: int = 50
) -> None:
    for _ in range(max_waves):
        pending = _pending_heats(db, round_id)
        if not pending:
            return
        for heat in pending:
            _run_heat_favouring(db, heat, favourite_order)
    raise AssertionError("the elimination round never finished")


def _add_championship_round(
    client, race_id: int, source: str, name: str = "Grand Finals"
):
    body = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {
                "raceId": race_id,
                "roundData": {
                    "name": name,
                    "advancementSource": source,
                    "advancementNumRacers": 1,
                    "runsPerLane": 1,
                },
            },
        },
    ).json()
    assert "errors" not in body, body
    [round_data] = body["data"]["createRound"]
    return round_data


def _no_unresolved_placeholders(db, round_id: int) -> set[int]:
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    real_racer_ids: set[int] = set()
    for lanes in crud.lanes_for_heats(db, heats):
        for lane in lanes:
            assert not (lane.placeholder_slot is not None and lane.racer_id is None), (
                f"round {round_id} still holds an unresolved placeholder"
            )
            if lane.racer_id is not None:
                real_racer_ids.add(lane.racer_id)
    return real_racer_ids


# --- Unit tests for the pure resolver -------------------------------------


def test_all_and_each_group_pass_through_with_no_elimination_round():
    # No elimination round at all — an ordinary General race. Nothing to fix.
    assert (
        advancement.resolve_championship_source(
            "ALL", elimination_round_id=None, previous_championship_round_id=None
        )
        == "ALL"
    )
    assert (
        advancement.resolve_championship_source(
            "EACH_GROUP",
            elimination_round_id=None,
            previous_championship_round_id=None,
        )
        == "EACH_GROUP"
    )


def test_all_chains_to_the_elimination_round_when_nothing_else_exists():
    assert (
        advancement.resolve_championship_source(
            "ALL", elimination_round_id=7, previous_championship_round_id=None
        )
        == "ROUND:7"
    )


def test_each_group_chains_to_the_elimination_round_too():
    assert (
        advancement.resolve_championship_source(
            "EACH_GROUP", elimination_round_id=7, previous_championship_round_id=None
        )
        == "ROUND:7"
    )


def test_an_existing_championship_round_wins_over_the_elimination_round():
    # A second final should draw from the first final's own field, not
    # re-pick the same survivors the elimination round already ranked.
    assert (
        advancement.resolve_championship_source(
            "ALL", elimination_round_id=7, previous_championship_round_id=12
        )
        == "ROUND:12"
    )


def test_an_existing_championship_round_is_irrelevant_with_no_elimination_round():
    # An ordinary General race with an earlier den final must not have a later
    # "ALL" round-robin final silently rerouted to it — "ALL" there
    # correctly means the whole preliminary field.
    assert (
        advancement.resolve_championship_source(
            "ALL", elimination_round_id=None, previous_championship_round_id=12
        )
        == "ALL"
    )


def test_a_round_scoped_request_is_always_left_alone():
    assert (
        advancement.resolve_championship_source(
            "ROUND:3", elimination_round_id=7, previous_championship_round_id=12
        )
        == "ROUND:3"
    )


# --- crud.resolve_championship_source_for_race (the I/O half) ------------


def test_crud_wrapper_elimination_only_race(db):
    race = _race(db, "CrudWrapperElim")
    _racers(db, race.id, 4)
    elim_round = crud.create_round(
        db,
        race.id,
        1,
        models.SchedulingStrategy.ELIMINATION,
        "Elimination Round",
        elimination_losses=1,
    )
    crud.generate_heats_for_round(
        db, elim_round.id, num_placeholders=crud.round_field_size(db, elim_round)
    )

    assert (
        crud.resolve_championship_source_for_race(db, race.id, "ALL")
        == f"ROUND:{elim_round.id}"
    )
    assert (
        crud.resolve_championship_source_for_race(db, race.id, "EACH_GROUP")
        == f"ROUND:{elim_round.id}"
    )
    # Already round-scoped: never rewritten.
    assert (
        crud.resolve_championship_source_for_race(db, race.id, "ROUND:999")
        == "ROUND:999"
    )


def test_crud_wrapper_balanced_only_race_is_unchanged(db):
    """Balanced heats feed the aggregate standings by design
    (`.claude/rules/scheduling.md`'s "Balanced racing"), so "ALL" already
    has real candidates and must not be rewritten."""
    race = _race(db, "CrudWrapperBalanced")
    _racers(db, race.id, 4)
    balanced_round = crud.create_round(
        db,
        race.id,
        1,
        models.SchedulingStrategy.BALANCED,
        "Balanced Round",
        balanced_phases=2,
    )
    crud.generate_heats_for_round(
        db,
        balanced_round.id,
        num_placeholders=crud.round_field_size(db, balanced_round),
    )

    assert crud.resolve_championship_source_for_race(db, race.id, "ALL") == "ALL"
    assert (
        crud.resolve_championship_source_for_race(db, race.id, "EACH_GROUP")
        == "EACH_GROUP"
    )


def test_crud_wrapper_mixed_ppc_and_elimination_general_rounds_leaves_all_alone(db):
    """A race with *both* a General round and an Elimination one (built
    through two separate `createRound` calls, say) still has a General round
    feeding the aggregate standings — "ALL" is left exactly as requested
    rather than being rerouted to the elimination round's own narrower
    field. This is the documented decision for the mixed case: honest
    "leave ALL alone" rather than guessing which qualifying round the
    operator meant."""
    race = _race(db, "CrudWrapperMixed")
    _racers(db, race.id, 4)
    ppc_round = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.GENERAL, "All Pack"
    )
    crud.generate_heats_for_round(
        db, ppc_round.id, num_placeholders=crud.round_field_size(db, ppc_round)
    )
    elim_round = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.ELIMINATION,
        "Elimination Round",
        elimination_losses=1,
    )
    crud.generate_heats_for_round(
        db, elim_round.id, num_placeholders=crud.round_field_size(db, elim_round)
    )

    assert crud.resolve_championship_source_for_race(db, race.id, "ALL") == "ALL"
    assert (
        crud.resolve_championship_source_for_race(db, race.id, "EACH_GROUP")
        == "EACH_GROUP"
    )


def test_crud_wrapper_chains_to_the_latest_existing_championship_round(db):
    race = _race(db, "CrudWrapperChain")
    _racers(db, race.id, 4)
    elim_round = crud.create_round(
        db,
        race.id,
        1,
        models.SchedulingStrategy.ELIMINATION,
        "Elimination Round",
        elimination_losses=1,
    )
    crud.generate_heats_for_round(
        db, elim_round.id, num_placeholders=crud.round_field_size(db, elim_round)
    )
    first_final = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.GENERAL,
        "Semifinal",
        advancement_source=f"ROUND:{elim_round.id}",
        advancement_num_racers=4,
    )
    crud.generate_heats_for_round(
        db,
        first_final.id,
        num_placeholders=crud.round_field_size(db, first_final),
    )

    # A second, later championship round asking for "ALL" chains to the
    # semifinal it was added after, not back to the elimination round.
    assert (
        crud.resolve_championship_source_for_race(db, race.id, "ALL")
        == f"ROUND:{first_final.id}"
    )


# --- End to end through the `createRound` mutation (the "Add Round" door) -


def test_add_round_all_fills_after_an_elimination_qualifier(db, client):
    race = _race(db, "AddRoundAll")
    ids = _racers(db, race.id, 4)
    elim_round = crud.create_round(
        db,
        race.id,
        1,
        models.SchedulingStrategy.ELIMINATION,
        "Elimination Round",
        elimination_losses=1,
    )
    crud.generate_heats_for_round(
        db, elim_round.id, num_placeholders=crud.round_field_size(db, elim_round)
    )

    final = _add_championship_round(client, race.id, "ALL")
    assert final["advancementSource"] == f"ROUND:{elim_round.id}"

    _race_elimination_to_a_winner(db, elim_round.id, favourite_order=ids)

    db.expire_all()
    real_racer_ids = _no_unresolved_placeholders(db, final["id"])
    assert real_racer_ids == {ids[0]}


def test_add_round_each_group_fills_after_an_elimination_qualifier(db, client):
    race = _race(db, "AddRoundEachGroup")
    ids = _racers(db, race.id, 4)
    elim_round = crud.create_round(
        db,
        race.id,
        1,
        models.SchedulingStrategy.ELIMINATION,
        "Elimination Round",
        elimination_losses=1,
    )
    crud.generate_heats_for_round(
        db, elim_round.id, num_placeholders=crud.round_field_size(db, elim_round)
    )

    final = _add_championship_round(client, race.id, "EACH_GROUP")
    assert final["advancementSource"] == f"ROUND:{elim_round.id}"

    _race_elimination_to_a_winner(db, elim_round.id, favourite_order=ids)

    db.expire_all()
    real_racer_ids = _no_unresolved_placeholders(db, final["id"])
    assert real_racer_ids == {ids[0]}


def test_add_round_round_scoped_source_is_untouched(db, client):
    race = _race(db, "AddRoundRoundScoped")
    _racers(db, race.id, 4)
    elim_round = crud.create_round(
        db,
        race.id,
        1,
        models.SchedulingStrategy.ELIMINATION,
        "Elimination Round",
        elimination_losses=1,
    )
    crud.generate_heats_for_round(
        db, elim_round.id, num_placeholders=crud.round_field_size(db, elim_round)
    )

    final = _add_championship_round(client, race.id, f"ROUND:{elim_round.id}")
    assert final["advancementSource"] == f"ROUND:{elim_round.id}"


def test_add_round_second_championship_round_chains_to_the_first(db, client):
    race = _race(db, "AddRoundSecondChains")
    _racers(db, race.id, 4)
    elim_round = crud.create_round(
        db,
        race.id,
        1,
        models.SchedulingStrategy.ELIMINATION,
        "Elimination Round",
        elimination_losses=1,
    )
    crud.generate_heats_for_round(
        db, elim_round.id, num_placeholders=crud.round_field_size(db, elim_round)
    )

    first_final = _add_championship_round(client, race.id, "ALL", name="Semifinal")
    assert first_final["advancementSource"] == f"ROUND:{elim_round.id}"

    # A second "Grand Finals" round, left on the picker's default "Overall"
    # (RoundConfigModal always starts at "ALL" — it does not know a
    # championship round already exists), chains to the semifinal it
    # follows rather than re-picking the elimination round's own survivors.
    second_final = _add_championship_round(client, race.id, "ALL", name="Grand Finals")
    assert second_final["advancementSource"] == f"ROUND:{first_final['id']}"


def test_add_round_all_is_unchanged_for_a_mixed_ppc_and_elimination_race(db, client):
    """A race with a General round *and* a separate Elimination general
    round (two `createRound` calls, not the wizard) still has the General round
    feeding the aggregate standings, so "ALL" is left alone — the documented
    mixed-race decision — and the resulting final fills from the General
    round's own preliminary standings, excluding the elimination heats."""
    race = _race(db, "AddRoundMixed")
    ids = _racers(db, race.id, 4)
    ppc_round = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.GENERAL, "All Pack"
    )
    crud.generate_heats_for_round(
        db, ppc_round.id, num_placeholders=crud.round_field_size(db, ppc_round)
    )
    elim_round = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.ELIMINATION,
        "Elimination Round",
        elimination_losses=1,
    )
    crud.generate_heats_for_round(
        db, elim_round.id, num_placeholders=crud.round_field_size(db, elim_round)
    )

    final = _add_championship_round(client, race.id, "ALL")
    assert final["advancementSource"] == "ALL"

    # "ALL"/"EACH_GROUP" waits for *every* earlier round to finish before
    # picking a field (`domain.advancement.should_populate`'s "otherwise the
    # field would be picked from a partial leaderboard"), so both general
    # rounds have to be raced — the elimination round's own result plays no
    # part in the aggregate standings (`services.scoring._scoring_heats`
    # excludes it), but its completion still has to be observed.
    ppc_heats = db.query(models.Heat).filter(models.Heat.round_id == ppc_round.id).all()
    for heat in ppc_heats:
        _run_heat_favouring(db, heat, ids)
    _race_elimination_to_a_winner(
        db, elim_round.id, favourite_order=list(reversed(ids))
    )

    db.expire_all()
    real_racer_ids = _no_unresolved_placeholders(db, final["id"])
    # The field came from the General round's own standings, not the
    # elimination round's (raced with the opposite favourite order above) —
    # confirming "ALL" was genuinely left alone rather than silently
    # rerouted to the elimination round.
    assert real_racer_ids == {ids[0]}
