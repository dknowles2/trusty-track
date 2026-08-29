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

The timer list is the third thing here that can rot, and the one that misleads
rather than merely 404s: a pack arrives with a device the page implied was
supported, or does not see the one that was added last month. Its rows carry
`data-timer-key`, so the page states which profiles it is naming and the tests
below hold that to `ALL_PROFILES` in both directions.

This is the same reasoning as `test_docs_stay_current.py`, one directory out: a
rule nobody enforces accumulates debt in files nobody opens.
"""

import re
from pathlib import Path

import pytest

from backend.services.timer.devices import ALL_PROFILES

from .test_timer_recordings import RECORDED_PROFILES

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


# ---------------------------------------------------------------------------
# The timer list
# ---------------------------------------------------------------------------


def _timer_rows() -> dict[str, str]:
    """Every `data-timer-key` on the landing page, mapped to its whole row."""
    html = (WWW_DIR / "index.html").read_text()
    return {
        match.group("key"): match.group(0)
        for match in re.finditer(
            r"""<li\s+data-timer-key=["'](?P<key>[^"']+)["'][^>]*>.*?</li>""",
            html,
            re.DOTALL,
        )
    }


def test_the_landing_page_names_every_timer_the_app_ships():
    """A profile added to `devices/` and not to the page is invisible.

    The page is where somebody decides whether their timer is supported, so a
    device that works and is not listed costs the pack that owns it.
    """
    assert set(_timer_rows()) == {profile.key for profile in ALL_PROFILES}


def test_the_landing_page_names_no_timer_the_app_has_lost():
    """The other direction: a row outliving the profile it named.

    Worse than the first, because a pack turns up with the device.
    """
    assert set(_timer_rows()) <= {profile.key for profile in ALL_PROFILES}


def test_only_the_timers_with_a_recording_are_marked_tested():
    """ "Tested" on this page means one specific thing, and it is checkable.

    `backend/tests/timer_recordings/` holds real output from three devices, and
    that replay is the whole of what has been verified — nothing here has been
    run against hardware physically present. So the badge tracks the recordings
    rather than anybody's recollection, in both directions: a new recording
    should light one up, and a deleted one should put it out.
    """
    rows = _timer_rows().items()
    marked = {key for key, row in rows if "data-timer-recording" in row}
    assert marked == {profile.key for profile in RECORDED_PROFILES.values()}


def test_the_tested_badge_and_the_marker_agree():
    """The visible badge is what a reader believes; the attribute is what the
    test above checks. They are two encodings of one claim, so a row carrying
    only one of them is a badge nothing is holding to account."""
    for key, row in _timer_rows().items():
        has_marker = "data-timer-recording" in row
        has_badge = "tag-ok" in row
        assert has_marker == has_badge, f"{key}: marker={has_marker} badge={has_badge}"


# ---------------------------------------------------------------------------
# The favicon
# ---------------------------------------------------------------------------


def _mkdocs_favicon() -> str:
    """The `theme.favicon` line, read as text.

    Not through a YAML parser: `mkdocs.yml` carries `!!python/name:` tags in
    other projects and heavy comments in this one, and the question here is one
    scalar. Absent means Material serves its own generic icon, which is the
    state this test exists to keep the site out of.
    """
    for line in (REPO_ROOT / "mkdocs.yml").read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("favicon:"):
            return stripped.removeprefix("favicon:").strip()
    return ""


def test_the_documentation_and_the_landing_page_share_one_favicon():
    """The tab icon is how somebody finds this site among twenty open tabs.

    The documentation had Material's default while the landing page had the
    logo, so the two halves of one site were different icons. `mkdocs.yml`
    writes its favicon relative to `docs/`; `www/` reaches the same file
    through the deployed `/docs/` prefix.
    """
    from_mkdocs = _mkdocs_favicon()
    assert from_mkdocs, "mkdocs.yml sets no favicon, so Material serves its own"
    assert (DOCS_DIR / from_mkdocs).is_file()

    expected = f"/docs/{from_mkdocs}"
    for page in _pages():
        icons = re.findall(
            r"""<link[^>]*\brel=["']icon["'][^>]*\bhref=["']([^"']+)["']""",
            page.read_text(),
        )
        assert icons, f"{page.name} declares no favicon"
        assert set(icons) == {expected}, (
            f"{page.name} points at {icons}, not {expected}"
        )


def test_the_favicon_is_square():
    """A browser scales a favicon into a square box.

    `logo.png` is a wide sticker, so using it directly letterboxes the car into
    a sliver — which is what both pages did before this file existed.
    """
    from PIL import Image

    with Image.open(DOCS_DIR / _mkdocs_favicon()) as image:
        assert image.width == image.height, f"favicon is {image.size}"
