"""The landing page's links into the documentation, and the pictures it borrows.

`www/` holds the pages served from the root of trusty-track.com — the landing
page and the site's 404 — and almost every link on them points at a guide:
`/docs/getting-started/`, `/docs/user/install-mac/`, `/docs/reference/scoring/`.
They also render the logo and four screenshots straight out of `docs/assets/`,
rather than keeping a second copy of images the Playwright specs in
`frontend/e2e/docs/` regenerate.

Neither of those is checked by anything else. `mkdocs build --strict` validates
links *inside* the documentation and never looks at `www/`; the landing page has
no build step to fail. So renaming a page — which the docs do, and which
`--strict` correctly forces to be fixed everywhere in `docs/` — leaves the front
door pointing at a 404, and nothing says so until a visitor finds it. Same for a
screenshot whose spec was renamed or removed.

This is the same reasoning as `test_docs_stay_current.py`, one directory out: a
rule nobody enforces accumulates debt in files nobody opens.
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
WWW_DIR = REPO_ROOT / "www"
DOCS_DIR = REPO_ROOT / "docs"

#: `href="..."` and `src="..."`, single or double quoted.
_ATTR = re.compile(r"""\b(?:href|src)\s*=\s*["']([^"']+)["']""")


def _pages() -> list[Path]:
    """Every page `www/` serves.

    Discovered rather than listed: a page added here and forgotten is exactly
    the staleness this file exists to catch.
    """
    return sorted(WWW_DIR.glob("*.html"))


def _references() -> list[str]:
    return [ref for page in _pages() for ref in _ATTR.findall(page.read_text())]


def _root_relative() -> list[str]:
    """Every link the deployment has to resolve itself.

    External links (GitHub, Google Fonts) are somebody else's to keep working,
    and in-page fragments are checked by the anchor test below.
    """
    return sorted({r for r in _references() if r.startswith("/")})


def _docs_pages_for(link: str) -> list[Path]:
    """The Markdown sources mkdocs could have built into `link`.

    mkdocs' default `use_directory_urls` turns `foo/bar.md` into `foo/bar/`, so
    the mapping back is the trailing slash and a `.md`. There are two of them
    because a directory's own page is `index.md`: `/docs/reference/` is
    `reference/index.md` and `/docs/awards/` is `awards.md`, and the URL does
    not say which. `/docs/` itself is the empty remainder, and only the second
    form applies.
    """
    rest = link.removeprefix("/docs/").strip("/")
    if not rest:
        return [DOCS_DIR / "index.md"]
    return [DOCS_DIR / f"{rest}.md", DOCS_DIR / rest / "index.md"]


def test_there_are_pages_and_links_to_check():
    """Guard against the checks below passing because the regex found nothing."""
    assert {page.name for page in _pages()} >= {"index.html", "404.html"}
    links = _root_relative()
    assert len([link for link in links if link.startswith("/docs/")]) > 10, links


@pytest.mark.parametrize(
    "link",
    [r for r in _root_relative() if r.startswith("/docs/assets/")],
)
def test_every_borrowed_image_exists(link: str):
    """A screenshot the landing page shows is a file in `docs/assets/`.

    Not a copy of one: `scripts/build_site.sh` puts the mkdocs site at
    `/docs/`, so these paths resolve to the same images the guides use. A copy
    would go stale the first time somebody regenerated a spec.
    """
    asset = DOCS_DIR / link.removeprefix("/docs/")
    assert asset.is_file(), f"{link} is not in docs/assets/"


@pytest.mark.parametrize(
    "link",
    [r for r in _root_relative() if r.startswith("/docs/") and "/assets/" not in r],
)
def test_every_link_into_the_docs_lands_on_a_page(link: str):
    assert link.endswith("/"), (
        f"{link} has no trailing slash; mkdocs serves pages as directories, so "
        "this would redirect on every visit"
    )
    pages = _docs_pages_for(link)
    assert any(page.is_file() for page in pages), (
        f"{link} points at "
        + " or ".join(str(page.relative_to(REPO_ROOT)) for page in pages)
        + ", neither of which exists"
    )


@pytest.mark.parametrize(
    "link",
    [r for r in _root_relative() if not r.startswith("/docs/")],
)
def test_every_other_absolute_link_is_a_file_in_www(link: str):
    """The stylesheet and anything else served from the site's own root."""
    target = WWW_DIR / (link.lstrip("/") or "index.html")
    assert target.is_file(), f"{link} is not in www/"


@pytest.mark.parametrize("page", _pages(), ids=lambda p: p.name)
def test_every_in_page_link_lands_on_an_id(page: Path):
    """A `#what` in the nav is only a link if something on that page has the id.

    Per page, not across the set: the 404 page carries the same header as the
    landing page, and a jump link that resolves on one and not the other is the
    reason this is not checked against the union of every id in `www/`.
    """
    html = page.read_text()
    ids = set(re.findall(r"""\bid\s*=\s*["']([^"']+)["']""", html))
    fragments = {r.removeprefix("#") for r in _ATTR.findall(html) if r.startswith("#")}
    assert fragments <= ids, f"no element with id: {sorted(fragments - ids)}"


def test_some_page_still_has_jump_links():
    fragments = {r for r in _references() if r.startswith("#")}
    assert fragments, "the nav's jump links have gone"
