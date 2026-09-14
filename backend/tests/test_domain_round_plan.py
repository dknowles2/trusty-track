"""`domain.round_plan.plan_from_rounds` — see its module docstring.

No database, no ORM rows: `RoundFact` is the plain mirror this module reads,
built by hand here the way `crud`/`api.schema` build it from real `Round`
rows.
"""

from backend.domain.round_plan import RoundFact, plan_from_rounds


def general(
    id: int,
    round_number: int = 1,
    scheduling_strategy: str = "GENERAL",
    elimination_losses: int | None = None,
    balanced_phases: int | None = None,
    runs_per_lane: int | None = 1,
) -> RoundFact:
    return RoundFact(
        id=id,
        round_number=round_number,
        name=None,
        scheduling_strategy=scheduling_strategy,
        advancement_source=None,
        advancement_num_racers=None,
        advancement_from_bottom=False,
        elimination_losses=elimination_losses,
        balanced_phases=balanced_phases,
        runs_per_lane=runs_per_lane,
    )


def championship(
    id: int,
    round_number: int,
    advancement_source: str,
    name: str | None = "Championship Round",
    advancement_num_racers: int | None = 3,
    advancement_from_bottom: bool = False,
    runs_per_lane: int | None = 1,
) -> RoundFact:
    return RoundFact(
        id=id,
        round_number=round_number,
        name=name,
        scheduling_strategy="GENERAL",
        advancement_source=advancement_source,
        advancement_num_racers=advancement_num_racers,
        advancement_from_bottom=advancement_from_bottom,
        elimination_losses=None,
        balanced_phases=None,
        runs_per_lane=runs_per_lane,
    )


def test_no_rounds_is_no_plan() -> None:
    assert plan_from_rounds([]) is None


def test_championship_rounds_with_no_general_round_is_no_plan() -> None:
    # Cannot arise through either real door, but should not raise.
    assert plan_from_rounds([championship(1, 1, "ALL")]) is None


def test_general_round_with_one_all_top_three_final() -> None:
    rounds = [
        general(1, runs_per_lane=2),
        championship(2, 2, "ALL", name="Finals", advancement_num_racers=3),
    ]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.general_round.type == "ALL"
    assert plan.general_round.scheduling_strategy == "GENERAL"
    assert plan.general_round.runs_per_lane == 2
    assert len(plan.championship_rounds) == 1
    finals = plan.championship_rounds[0]
    assert finals.name == "Finals"
    assert finals.source == "ALL"
    assert finals.num_top_racers == 3
    assert finals.source_round_id == 2


def test_elimination_general_round_carries_its_losses() -> None:
    rounds = [general(1, scheduling_strategy="ELIMINATION", elimination_losses=2)]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.general_round.type == "ALL"
    assert plan.general_round.scheduling_strategy == "ELIMINATION"
    assert plan.general_round.elimination_losses == 2
    assert plan.championship_rounds == []


def test_balanced_general_round_carries_its_phases() -> None:
    rounds = [general(1, scheduling_strategy="BALANCED", balanced_phases=5)]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.general_round.scheduling_strategy == "BALANCED"
    assert plan.general_round.balanced_phases == 5


def test_each_group_general_round_from_multiple_general_rounds() -> None:
    rounds = [
        general(1, round_number=1),
        general(2, round_number=2),
        championship(3, 3, "ALL"),
    ]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.general_round.type == "EACH_GROUP"


def test_each_group_championship_source_is_preserved_literally() -> None:
    rounds = [general(1), championship(2, 2, "EACH_GROUP")]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.championship_rounds[0].source == "EACH_GROUP"


def test_advancement_from_bottom_is_preserved() -> None:
    rounds = [
        general(1),
        championship(2, 2, "ALL", advancement_from_bottom=True),
    ]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.championship_rounds[0].advancement_from_bottom is True


def test_null_runs_per_lane_becomes_one() -> None:
    rounds = [
        general(1, runs_per_lane=None),
        championship(2, 2, "ALL", runs_per_lane=None),
    ]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.general_round.runs_per_lane == 1
    assert plan.championship_rounds[0].runs_per_lane == 1


def test_second_final_chained_to_the_first_recovers_as_previous() -> None:
    # The wizard's own "PREVIOUS" option resolves to a concrete ROUND:<id>
    # the moment the round is created (see `create_round_wizard`); this is
    # what a den final chained to a Grand Finals round looks like on disk.
    rounds = [
        general(1),
        championship(2, 2, "ALL", name="Den Final"),
        championship(3, 3, "ROUND:2", name="Grand Finals"),
    ]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    sources = [c.source for c in plan.championship_rounds]
    assert sources == ["ALL", "PREVIOUS"]


def test_final_chained_to_an_elimination_general_round_recovers_as_all() -> None:
    # `resolve_championship_source` rewrites a requested ALL/EACH_GROUP to
    # ROUND:<elimination round id> when the general round is elimination —
    # collapsing which of the two was asked for. Recovered as ALL; applying
    # `resolve_championship_source` again on the copy reproduces the same
    # chained round regardless of which was originally meant.
    rounds = [
        general(1, scheduling_strategy="ELIMINATION", elimination_losses=3),
        championship(2, 2, "ROUND:1", name="Finals"),
    ]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.championship_rounds[0].source == "ALL"


def test_championship_rounds_are_ordered_by_round_number_not_id() -> None:
    rounds = [
        general(1),
        championship(3, 3, "ALL", name="Second"),
        championship(2, 2, "ALL", name="First"),
    ]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert [c.name for c in plan.championship_rounds] == ["First", "Second"]


def test_source_round_id_names_the_original_round() -> None:
    rounds = [general(1), championship(7, 2, "ALL")]
    plan = plan_from_rounds(rounds)
    assert plan is not None
    assert plan.championship_rounds[0].source_round_id == 7
