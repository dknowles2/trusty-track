"""The scheduling-algorithm registry itself (#1090).

Two things `test_domain_scheduling.py`'s parametrized property suite does not
check: that every `SchedulingAlgorithm` enum member actually has a
`Scheduler` behind it (a member with no entry would raise a bare `KeyError`
deep inside `crud.generate_heats_for_round` the first time a round asked for
it), and that `available_for` genuinely answers for the field/lane shapes the
rest of the suite assumes it can schedule.
"""

import random

import pytest

from backend.db import models
from backend.domain.schedulers import SCHEDULERS


def test_every_algorithm_enum_member_has_a_registry_entry():
    registered = set(SCHEDULERS)
    enum_values = {member.value for member in models.SchedulingAlgorithm}
    assert registered == enum_values, (
        f"registry/enum drift: registered={registered} enum={enum_values}"
    )


@pytest.mark.parametrize("algorithm", sorted(SCHEDULERS))
@pytest.mark.parametrize("racers", range(2, 21))
@pytest.mark.parametrize("lane_count", range(2, 9))
def test_available_for_agrees_with_a_working_schedule(algorithm, racers, lane_count):
    """`available_for` is checked up front by the wizard (part D) and the
    latecomer path; it must never say yes to a field it cannot actually
    schedule, nor no to one it can — `test_domain_scheduling.py`'s own sweep
    covers exactly this (racers, lane_count) grid and passes for every
    registered algorithm, so a `None` answer here had better mean that.

    A refusal is not merely a formality to check the wording of, either
    (#1090 part C, PERFECT_N): `generate` itself is allowed to raise for a
    shape `available_for` refuses — it does, as a backstop for a round
    created without going through either checked door — so this only calls
    `generate` when `available_for` said yes, and additionally confirms a
    refused shape's `generate` call does raise rather than silently
    returning something that looks like a schedule.
    """
    scheduler = SCHEDULERS[algorithm]
    reason = scheduler.available_for(racers, lane_count)
    if reason is None:
        plans = scheduler.generate(
            list(range(1, racers + 1)),
            list(range(1, lane_count + 1)),
            rng=random.Random(0),
        )
        assert len(plans) == racers, (
            f"{algorithm} claimed availability for {racers} racers / "
            f"{lane_count} lanes but produced {len(plans)} heats"
        )
    else:
        # An algorithm that refuses a shape says why, not just that it does.
        assert reason.strip(), f"{algorithm} gave an empty refusal reason"
        with pytest.raises(ValueError):
            scheduler.generate(
                list(range(1, racers + 1)),
                list(range(1, lane_count + 1)),
                rng=random.Random(0),
            )
