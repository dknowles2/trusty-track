"""The one number on the comparison page that drifts on its own.

`docs/comparison.md` sets Trusty Track beside the other Pinewood Derby programs.
Almost everything on it is a claim about somebody else's software, checked
against their website on a stated date and re-checked by a person — a test can
do nothing useful there.

One cell is different: how many timer models Trusty Track lists. That is a fact
about this repository, it is the row a reader compares hardest, and it changes
whenever a profile is added to `backend/services/timer/devices/`. So it is held
to the code, the same way the landing page's timer list is
(`test_landing_page_links.py`).

The rest of the page deliberately carries no counts. An earlier draft said
"eight models, three of them tested", which is two more numbers to keep in step
for no gain — the prose points at the list itself instead.
"""

import re
from pathlib import Path

from backend.services.timer.devices import ALL_PROFILES

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
COMPARISON = REPO_ROOT / "docs" / "comparison.md"


def _timer_row_cells() -> list[str]:
    """The cells of the "Timer models listed" row, in column order."""
    for line in COMPARISON.read_text().splitlines():
        if line.startswith("| **Timer models listed**"):
            return [cell.strip() for cell in line.strip().strip("|").split("|")]
    return []


def test_the_comparison_page_has_a_timer_row():
    """Guard against the check below passing because the row was renamed."""
    assert _timer_row_cells(), "no 'Timer models listed' row in docs/comparison.md"


def test_the_comparison_page_counts_our_timers_correctly():
    """The first column after the label is Trusty Track's own.

    Overstating it is the worst failure this page can have: a pack reads the
    row, buys a timer, and finds nothing on the other end of the cable.
    """
    cells = _timer_row_cells()
    ours = cells[1]
    assert re.fullmatch(r"\d+", ours), f"expected a plain count, got {ours!r}"
    assert int(ours) == len(ALL_PROFILES)
