"""Every action belongs to exactly one of the six audit categories (#1253).

The one-direction shape `.claude/rules/auth-and-demo.md` cross-references
(`test_race_lock.py::test_every_locked_mutation_exists`) is not right here —
unlike that denylist, an uncategorised mutation must fail the build: the
whole point of `AuditCategory` is that a screen scanning by subject can trust
every row lands in one of the six chips, and a mutation nobody bucketed would
silently vanish from every chip at once rather than merely being ordinary
behaviour. So this file checks **both** directions, the same shape
`test_auth_policy.py::test_every_mutation_is_classified` uses for the role
table: a mutation the category table has not heard of yet, and a category
entry naming a mutation the schema no longer has, are both failures.
"""

from backend.api.schema import schema
from backend.domain import audit


def _mutation_names() -> set[str]:
    """Every mutation the schema declares, read from the SDL — the same
    derivation `test_race_lock.py` and `test_auth_policy.py` use."""
    body = schema.as_str().split("type Mutation {", 1)[1].split("\n}", 1)[0]
    names = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith(('"', "#")):
            continue
        names.add(line.split("(", 1)[0].split(":", 1)[0].strip())
    return names


#: The three actions that reach the log outside a mutation (#219's second
#: seam): the timer's own result writes, and the two backup endpoints.
NON_MUTATION_ACTIONS = {"heatResultRecorded", "backupDownloaded", "backupRestored"}


def test_every_action_is_in_exactly_one_category():
    declared = _mutation_names() | NON_MUTATION_ACTIONS

    categorized: dict[str, list[audit.AuditCategory]] = {}
    for category, actions in audit.ACTIONS_BY_CATEGORY.items():
        for action in actions:
            categorized.setdefault(action, []).append(category)

    uncategorized = declared - categorized.keys()
    assert uncategorized == set(), (
        f"actions with no category: {sorted(uncategorized)} — add each to "
        "ACTIONS_BY_CATEGORY in backend/domain/audit.py"
    )

    stale = categorized.keys() - declared
    assert stale == set(), (
        f"ACTIONS_BY_CATEGORY names actions the schema no longer has: {sorted(stale)}"
    )

    in_more_than_one = {
        action: cats for action, cats in categorized.items() if len(cats) > 1
    }
    assert in_more_than_one == {}, (
        f"actions claimed by more than one category: {in_more_than_one}"
    )


def test_the_six_categories_are_disjoint():
    seen: set[str] = set()
    for category, actions in audit.ACTIONS_BY_CATEGORY.items():
        overlap = seen & actions
        assert overlap == set(), f"{category} re-uses {overlap}"
        seen |= actions


def test_category_of_matches_the_lookup_table():
    for category, actions in audit.ACTIONS_BY_CATEGORY.items():
        for action in actions:
            assert audit.category_of(action) == category


def test_category_of_an_unknown_action_is_none():
    assert audit.category_of("notARealMutation") is None


def test_every_category_has_a_label_and_a_hint():
    for category in audit.AuditCategory:
        assert audit.CATEGORY_LABELS[category]
        assert audit.CATEGORY_HINTS[category]


def test_noteworthy_actions_is_the_set_is_noteworthy_reads():
    """`is_noteworthy` and the server-side "Noteworthy only" filter must never
    drift apart (#1253) — both read `NOTEWORTHY_ACTIONS` rather than each
    keeping its own copy."""
    for action in audit.NOTEWORTHY_ACTIONS:
        entry = audit.Entry(action=action, role=audit.ActorRole.OPERATOR, at="now")
        assert audit.is_noteworthy(entry)
