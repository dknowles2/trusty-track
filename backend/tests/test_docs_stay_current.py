"""The parts of the documentation a machine can check.

`mkdocs build --strict` catches a broken link and a missing image, and it
cannot catch a sentence that is simply wrong — which is the failure that keeps
happening. Most of that is prose and stays a human problem. But four kinds of
staleness are mechanical, and every one of them has shipped at least once with
CI fully green:

* an operation added to the GraphQL schema and never written into the API
  reference (`setLaneOutages`, `timerModels`, and the four award mutations);
* a model added and never written into the data model section (`LaneOutage`);
* a screenshot whose subject was removed, left behind under a filename that
  still promises it (`09-bulk-actions-menu.png` outlived the Bulk Actions menu
  by a release);
* a link to a heading that does not exist. `--strict` validates the *file*
  half of `race-day.md#part-4-standings-and-results` and ignores everything
  after the hash, so a link to a section that was renamed lands the reader at
  the top of the right page and says nothing. Two were written and merged in a
  single afternoon.

A guideline in `CLAUDE.md` said to update all of these, and was followed, and
they drifted anyway. So the rule lives here instead: this file is the reason the
lists cannot rot, in the same way `test_auth_policy` is the reason a new
mutation cannot go unclassified.

Both directions matter. Forward catches the addition nobody documented;
backward catches an entry outliving the thing it named, which is the failure
that leaves a reader hunting for a mutation that no longer exists.
"""

import inspect
import re
from collections.abc import Iterable
from pathlib import Path
from typing import NamedTuple

import markdown
import pytest

from backend.api.schema import schema
from backend.db import models

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DESIGN = REPO_ROOT / "docs" / "design.md"
AGENT_GUIDE = REPO_ROOT / "CLAUDE.md"
DOCS_DIR = REPO_ROOT / "docs"
SCREENSHOT_DIR = DOCS_DIR / "assets" / "screenshots"

#: Models that exist to hold data no reader of the design document needs. Keep
#: this list short and say why — it is an exemption from being documented.
UNDOCUMENTED_MODELS = {
    # Migration 0013's evidence locker: rows only exist on an install whose
    # `lane_results` blob held something `heat_lanes` could not express, and it
    # is expected to be empty. Documented in the migration, not the design.
    "HeatLaneBlobArchive",
}


def _sdl() -> str:
    return schema.as_str()


def _operations(kind: str) -> set[str]:
    """Every field name on `Query`, `Mutation` or `Subscription`."""
    body = re.search(rf"type {kind} \{{(.*?)\n\}}", _sdl(), re.S)
    assert body, f"no `type {kind}` in the SDL"
    return set(re.findall(r"^ {2}(\w+)", body.group(1), re.M))


ALL_OPERATIONS = sorted(
    _operations("Query") | _operations("Mutation") | _operations("Subscription")
)


def _names(operation: str) -> re.Pattern:
    """Matches how each document actually writes an operation.

    `race`, `race(raceId)` and `subscription onDeck(raceId)` are all the same
    claim; only the first form is a bare name.
    """
    return re.compile(rf"`(?:subscription )?{re.escape(operation)}[(`]")


@pytest.mark.parametrize("operation", ALL_OPERATIONS)
def test_the_design_document_names_every_operation(operation):
    """§3.3 is the API reference; an operation absent from it is undocumented."""
    assert _names(operation).search(DESIGN.read_text()), (
        f"`{operation}` is in the schema and not in docs/design.md. "
        "Add it to the query, mutation or subscription list in §3.3."
    )


@pytest.mark.parametrize("operation", ALL_OPERATIONS)
def test_the_agent_guide_names_every_operation(operation):
    """`CLAUDE.md`'s lists are what an agent reads instead of the SDL."""
    assert _names(operation).search(AGENT_GUIDE.read_text()), (
        f"`{operation}` is in the schema and not in CLAUDE.md. "
        "Add it to the GraphQL API section."
    )


def _listed_names(text: str, start: int) -> set[str]:
    """The operations a list under ``start`` actually lists.

    Only the leading run of backticked names on each line, because these lists
    annotate themselves: "`createAward`, ..., `reorderAwards` (all take/return
    `Award`, whose `recipient` is ...)". `Award` and `recipient` are prose about
    the entry, not further entries, and a whole-line scan reports them as
    mutations the schema has lost.

    The anchor's own line counts, because `CLAUDE.md` writes its queries and
    subscriptions inline rather than as a list. Everything stops at the next
    heading — without that bound the last list in a document runs on into the
    rest of it.
    """
    lines = text[start:].split("\n")
    names = _names_in(lines[0])
    in_list = False
    for line in lines[1:]:
        if line.startswith(("#", "**")):
            break
        if not line.strip():
            if in_list:
                break
            continue
        if line.startswith("-"):
            in_list = True
        elif not in_list:
            continue  # prose between the heading and its list
        names |= _names_in(line)
    return names


def _names_in(line: str) -> set[str]:
    head = re.split(r" — | \(", line)[0]
    return set(re.findall(r"`(?:subscription )?(\w+)[(`]", head))


def _documented_operations(text: str, anchors: list[str]) -> set[str]:
    """Backticked names inside the blocks that list operations.

    Scoped to those blocks rather than the whole file: both documents discuss
    plenty of names that are not operations — Python functions, columns, and
    `laneResults`, which is named precisely because it was *removed*.
    """
    found: set[str] = set()
    for anchor in anchors:
        start = text.find(anchor)
        assert start != -1, (
            f"the list beginning {anchor!r} has moved or been reworded. "
            "This test reads that block; point it at the new anchor rather "
            "than deleting the check."
        )
        found |= _listed_names(text, start)
    return found


def test_no_operation_named_in_the_design_document_has_been_removed():
    text = DESIGN.read_text()
    documented = _documented_operations(
        text,
        [
            "**GraphQL Queries:**",
            "**GraphQL Mutations:**",
            "**GraphQL Subscriptions (real-time observation):**",
        ],
    )
    stale = sorted(documented - set(ALL_OPERATIONS))
    assert not stale, (
        f"docs/design.md lists operations the schema no longer has: {stale}. "
        "An entry that outlives its operation sends a reader hunting for it."
    )


def test_no_operation_named_in_the_agent_guide_has_been_removed():
    text = AGENT_GUIDE.read_text()
    documented = _documented_operations(
        text, ["**Queries:**", "**Mutations:**", "**Subscriptions:**"]
    )
    stale = sorted(documented - set(ALL_OPERATIONS))
    assert not stale, f"CLAUDE.md lists operations the schema no longer has: {stale}."


def _model_names() -> list[str]:
    return sorted(
        name
        for name, obj in vars(models).items()
        if inspect.isclass(obj)
        and hasattr(obj, "__tablename__")
        and name not in UNDOCUMENTED_MODELS
    )


@pytest.mark.parametrize("model", _model_names())
def test_the_design_document_names_every_model(model):
    """§3.2 is the data model. `LaneOutage` shipped without an entry (#171)."""
    assert f"`{model}`" in DESIGN.read_text(), (
        f"`{model}` is a table and is not in docs/design.md §3.2. "
        "Document it, or exempt it in UNDOCUMENTED_MODELS with a reason."
    )


def _referenced_images() -> set[Path]:
    """Every image path a doc page links to, resolved the way a reader's
    browser resolves it — relative to *that page's own directory*, not to
    ``DOCS_DIR``. The two agree for every page at the docs root, which was
    every page that linked an image until `docs/reference/race-settings.md`
    became the first page in a subdirectory to (`../assets/...`) — resolving
    against ``DOCS_DIR`` instead would have read that as `docs/assets/...`
    one level short of `docs/reference/assets/...`, and reported a real,
    existing screenshot as an orphan.
    """
    referenced: set[Path] = set()
    for page in DOCS_DIR.rglob("*.md"):
        for match in re.findall(r"\]\(([^)]+\.png)\)", page.read_text()):
            referenced.add((page.parent / match).resolve())
    return referenced


def test_every_screenshot_is_used_by_a_page():
    """An orphaned image is a screen that was documented and then removed.

    `09-bulk-actions-menu.png` outlived the menu it was named after by a whole
    release: the file kept being regenerated, so it quietly became a picture of
    the selection bar under a filename promising a menu. Nothing noticed,
    because a file nobody links to breaks no link.
    """
    if not SCREENSHOT_DIR.exists():
        pytest.skip("no screenshots checked in")

    referenced = _referenced_images()
    orphans = sorted(
        str(path.relative_to(DOCS_DIR))
        for path in SCREENSHOT_DIR.rglob("*.png")
        if path.resolve() not in referenced
    )
    assert not orphans, (
        f"screenshots no page links to: {orphans}. Either the page that used "
        "them was rewritten and they should go, or a link is broken in a way "
        "mkdocs cannot see because it only checks the links that exist."
    )


class Anchor(NamedTuple):
    """A link into a heading, and where it was written."""

    source: Path
    target: Path
    fragment: str

    def __str__(self) -> str:
        return (
            f"{self.source.relative_to(REPO_ROOT)} -> "
            f"{self.target.relative_to(DOCS_DIR)}#{self.fragment}"
        )


#: The heading ids of a page, rendered rather than guessed.
#:
#: `toc` is the extension that assigns them, so asking it is the only way to
#: be sure of matching what the site serves — the slug rules strip punctuation,
#: fold case and disambiguate repeats, and a reimplementation would agree right
#: up until a heading with a bracket in it. `attr_list` is what makes an
#: explicit `{#custom-id}` count, and `fenced_code` keeps a `#` comment inside
#: a code block from being read as a heading.
_ANCHOR_EXTENSIONS = ["toc", "attr_list", "fenced_code"]

#: An explicitly written anchor, which `toc` knows nothing about.
_EXPLICIT_ID = re.compile(r"""<a\s[^>]*\bid=["']([^"']+)["']""")

#: `[text](target)`, with an image's leading `!` excluded — an image cannot
#: carry a fragment and `attr_list` sizing syntax trails the closing bracket.
_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)\)")


def _pages() -> list[Path]:
    return sorted(DOCS_DIR.rglob("*.md"))


def _headings_of(page: Path) -> set[str]:
    text = page.read_text()
    renderer = markdown.Markdown(extensions=_ANCHOR_EXTENSIONS)
    renderer.convert(text)

    found: set[str] = set(_EXPLICIT_ID.findall(text))

    def walk(tokens: Iterable[dict]) -> None:
        for token in tokens:
            found.add(token["id"])
            walk(token.get("children", []))

    walk(getattr(renderer, "toc_tokens", []))
    return found


def _anchor_links() -> list[Anchor]:
    links: list[Anchor] = []
    for page in _pages():
        for target in _LINK.findall(page.read_text()):
            if "#" not in target:
                continue
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            path, _, fragment = target.partition("#")
            if not fragment:
                continue
            destination = page if not path else (page.parent / path)
            links.append(Anchor(page, destination.resolve(), fragment))
    return links


ANCHOR_LINKS = _anchor_links()


@pytest.mark.parametrize("link", ANCHOR_LINKS, ids=str)
def test_every_link_into_a_heading_lands_on_one(link: Anchor):
    """`--strict` checks the file and ignores the fragment.

    So a link to a section that has since been renamed still builds, still
    passes CI, and drops the reader at the top of the page with no sign that
    anything went wrong — which is worse than a broken link, because a broken
    link is at least visible.
    """
    assert link.target.exists(), (
        f"{link} points at a file that is not there. mkdocs catches this one; "
        "if you are seeing it here the path is wrong in a way that stopped it "
        "being a link at all."
    )

    headings = _headings_of(link.target)
    assert link.fragment in headings, (
        f"{link} names a heading that page does not have. It has: {sorted(headings)}"
    )


#: Mirrors `mkdocs.yml`'s `markdown_extensions` list, so the render below sees
#: what the published site sees rather than what bare `markdown` would produce.
_SITE_EXTENSIONS = [
    "admonition",
    "attr_list",
    "md_in_html",
    "pymdownx.details",
    "pymdownx.superfences",
    "pymdownx.tabbed",
]

_STRONG = re.compile(r"<strong>(.*?)</strong>", re.S)


@pytest.mark.parametrize(
    "page",
    [DOCS_DIR / "user" / "install-mac.md", DOCS_DIR / "user" / "install-windows.md"],
)
def test_no_bold_text_renders_a_literal_backslash(page: Path):
    """#477: `**TrustyTrack-\\<version\\>-mac.dmg**` published as
    "TrustyTrack-\\<version>-mac.dmg" — a novice was told to click a filename
    with a stray backslash in it, in the one step where they must match a
    name against a real file list.

    The escape isn't honored inside a bold span by the site's Markdown
    pipeline (pymdown-extensions), so this renders through the same
    extensions `mkdocs.yml` configures rather than bare `markdown` — the raw
    source can look fine and still misrender on the published page.
    """
    html = markdown.Markdown(extensions=_SITE_EXTENSIONS).convert(page.read_text())
    bad = [text for text in _STRONG.findall(html) if "\\" in text]
    assert not bad, (
        f"{page.relative_to(REPO_ROOT)} renders bold text with a literal "
        f"backslash: {bad}. Use a backticked example filename instead of an "
        "escaped placeholder like `\\<version\\>`."
    )


def test_the_documentation_actually_contains_anchor_links():
    """Otherwise the check above passes an empty list and proves nothing.

    The parametrised test disappears rather than fails if the pattern above
    ever stops matching, which is exactly the shape of guard that rots
    silently.
    """
    assert len(ANCHOR_LINKS) >= 5


def test_the_pi_guide_never_hardcodes_the_username():
    """Raspberry Pi OS no longer ships a default `pi` user (issue #478).

    The Imager's advanced settings force the reader to choose a username in
    Step 1; an `ssh` command in Step 2 that hardcodes `pi@` is wrong for
    anyone who typed anything else, and fails with nothing connecting the
    `Permission denied` back to the field they filled in ten minutes earlier.
    """
    pi_guide = DOCS_DIR / "user" / "install-raspberry-pi.md"
    text = pi_guide.read_text()

    assert "pi@" not in text, (
        f"{pi_guide} hardcodes the `pi` username in an ssh command — use "
        "`<username>@...` instead, since the Imager makes the reader choose "
        "their own."
    )
    assert "ssh <username>@" in text, (
        f"{pi_guide} should walk the reader through connecting with the "
        "username they set in Step 1."
    )
