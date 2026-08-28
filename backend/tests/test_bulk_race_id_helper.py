"""The bulk racer resolvers share one way to find their race (#432).

Five resolvers in `api/schema.py` — `bulkAutoNumber`, `bulkClearNumbers`,
`bulkCheckIn`, `bulkMoveToDen`, `bulkDeleteRacers` — each used to re-derive
`race_id` from `racer_ids[0]` with its own null-guard, so which one needed
telling the mutation had run on nobody depended on which resolver you were
reading. `_race_id_for_racers` is the one place that indexes `racer_ids` now.

This pins the convention rather than a behavior: every guard style answered
`None` for an empty or unknown id the same way the helper does, so a
fixture-driven test would pass against either shape. What regresses silently
is a sixth resolver, or an edit to one of these five, re-inlining the lookup.
"""

import ast
from pathlib import Path


def test_only_the_helper_indexes_racer_ids():
    """Every bulk resolver goes through `_race_id_for_racers`.

    `racer_ids[0]` may appear inside `_race_id_for_racers` itself and nowhere
    else in the module — a second occurrence is a resolver that stopped
    calling it.
    """
    schema_py = Path(__file__).resolve().parents[1] / "api" / "schema.py"
    tree = ast.parse(schema_py.read_text())

    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name == "_race_id_for_racers":
            continue
        for inner in ast.walk(node):
            if (
                isinstance(inner, ast.Subscript)
                and isinstance(inner.value, ast.Name)
                and inner.value.id == "racer_ids"
            ):
                index = inner.slice
                if isinstance(index, ast.Constant) and index.value == 0:
                    offenders.append(f"{node.name}:{inner.lineno}")

    assert offenders == [], (
        f"racer_ids[0] indexed outside _race_id_for_racers: {offenders}"
    )
