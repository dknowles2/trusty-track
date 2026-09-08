"""Every delete mutation that can strand an armed timer calls
`_revalidate_timers` (#887).

A heat id is not a stable handle (#50): deleting a heat, a round, a racer, a
race, a run-off heat or a free race heat can all take away the row a
`TimerManager` is currently armed against. `deleteFreeRaceHeat` was the one
delete mutation of that shape without the call — found by reading, since
nothing enforced it. This is the structural guard `#48`'s lesson asks for: a
rule that depends on each caller remembering reaches only some of them, so
here it is checked across every mutation in `schema.py` rather than trusted
to the next person adding one.

The set below is an explicit, reasoned enumeration — in the spirit of
`frontend/src/nameDisplayGuard.test.ts` — rather than "every mutation whose
name starts with delete_", because several delete mutations
(`delete_scene`, `delete_racing_group`, `delete_track_record`,
`delete_award`) can never remove a row a timer is armed against, and
`delete_track` handles its manager a different way (stopping it outright,
since the track itself is going away) rather than through this seam.
"""

import ast
from pathlib import Path

MUST_REVALIDATE = {
    "delete_race",
    "delete_racer",
    "bulk_delete_racers",
    "delete_round",
    "delete_heat",
    "delete_free_race_heat",
    "delete_run_off_heat",
}


def _mutation_call_names(func: ast.AsyncFunctionDef | ast.FunctionDef) -> set[str]:
    names = set()
    for node in ast.walk(func):
        if not isinstance(node, ast.Call):
            continue
        callee = node.func
        if isinstance(callee, ast.Name):
            names.add(callee.id)
        elif isinstance(callee, ast.Attribute):
            names.add(callee.attr)
    return names


def test_every_heat_stranding_delete_mutation_revalidates_timers():
    schema_path = Path(__file__).resolve().parents[1] / "api" / "schema.py"
    tree = ast.parse(schema_path.read_text())

    found: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and (
            node.name in MUST_REVALIDATE
        ):
            found[node.name] = _mutation_call_names(node)

    missing_functions = MUST_REVALIDATE - found.keys()
    assert not missing_functions, (
        f"Expected mutation(s) not found in schema.py: {sorted(missing_functions)} "
        "— update MUST_REVALIDATE if one was renamed or removed."
    )

    not_revalidating = {
        name for name, calls in found.items() if "_revalidate_timers" not in calls
    }
    assert not not_revalidating, (
        f"{sorted(not_revalidating)} can delete a row an armed timer names "
        "but never calls `_revalidate_timers` — an armed heat could be "
        "swapped underneath the operator (#50, #887)."
    )
