"""The official-heats filter has one spelling, and it is named (#432).

CLAUDE.md: "Use `models.official_heats(query)` rather than writing the filter
out, so its absence is visible at the call site." Three functions in
`crud.py` hand-wrote it anyway, as a Python-side
`if h.kind is models.HeatKind.OFFICIAL` filter over an unfiltered query — the
loading kind of the same #48 pattern the CLAUDE.md rule already names.

The check is structural rather than behavioral: a hand-written comprehension
and `official_heats()` happen to answer identically wherever they are
compared today, so a test built from fixtures could pass with either one and
regress silently the moment a query stops being round-scoped. Pin the
convention itself instead — `HeatKind.OFFICIAL` spelled out anywhere but the
function that owns it.
"""

import ast
from pathlib import Path


def test_only_models_spells_out_heatkind_official():
    """Every other reader goes through `models.official_heats`.

    `db/models.py` is exempt because it *is* `official_heats` (and the
    column's own default). `tests/` and `migrations/` speak the enum on
    fixtures and columns that predate any query to filter. Everything else —
    `crud.py`, `schema.py`, `loaders.py`, `services/` — filters a heat query
    by calling the named helper, never by comparing `.kind` in Python or SQL.
    """
    backend = Path(__file__).resolve().parents[1]
    offenders = set()

    for path in sorted(backend.rglob("*.py")):
        parts = path.relative_to(backend).parts
        if parts[0] in {"tests", "migrations"} or path.name == "models.py":
            continue

        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Attribute)
                and node.attr == "OFFICIAL"
                and isinstance(node.value, ast.Attribute)
                and node.value.attr == "HeatKind"
            ):
                offenders.add(f"{path.relative_to(backend)}:{node.lineno}")

    assert offenders == set(), (
        "HeatKind.OFFICIAL spelled out directly instead of going through "
        f"models.official_heats(): {sorted(offenders)}"
    )
