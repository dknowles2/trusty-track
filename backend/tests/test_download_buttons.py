"""Direct download buttons agree with what the release workflow publishes.

Issue #474: the landing page and the two desktop install guides link straight
to `releases/latest/download/<asset>` rather than sending a first-time visitor
through the GitHub Releases page to find the right file under Assets. That
only works if the asset actually exists under that exact name on every
release — GitHub resolves `latest` to whichever release most recently
published, but the *name* inside it has to be the one every caller asked for.

Three places have to agree on the same two filenames, and nothing but a
human remembering held them together before this file: `www/index.html`'s
download buttons, the two guides' Step 1 buttons, and
`.github/workflows/release.yml`, which is the one place that actually makes a
file exist under that name (see "Create stable-named copies for direct
downloads"). A rename in any one of the three — or dropping the release step
that publishes the stable copy — leaves a button pointing at a 404, silently,
because nothing else in the tree looks at `www/` or the release workflow.
"""

import re
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

#: The stable, unversioned asset names the release workflow must publish
#: alongside the versioned ones, and that every download button must point
#: at. Keyed by OS only to give test failures a readable label.
STABLE_ASSETS = {
    "macOS": "TrustyTrack-mac.dmg",
    "Windows": "TrustyTrack-setup.exe",
}

RELEASE_URL_FOR = {
    os: f"https://github.com/dknowles2/trusty-track/releases/latest/download/{asset}"
    for os, asset in STABLE_ASSETS.items()
}


@pytest.mark.parametrize("os", sorted(STABLE_ASSETS))
def test_landing_page_links_to_the_stable_download(os: str):
    html = (REPO_ROOT / "www" / "index.html").read_text()
    assert RELEASE_URL_FOR[os] in html, (
        f"www/index.html has no link to {RELEASE_URL_FOR[os]}; the "
        f"'Download for {os}' button on the landing page's install card is "
        "missing or points somewhere else"
    )


@pytest.mark.parametrize(
    ("os", "guide"),
    [("macOS", "install-mac.md"), ("Windows", "install-windows.md")],
)
def test_install_guide_step_one_links_to_the_stable_download(os: str, guide: str):
    text = (REPO_ROOT / "docs" / "user" / guide).read_text()
    assert RELEASE_URL_FOR[os] in text, (
        f"docs/user/{guide} has no link to {RELEASE_URL_FOR[os]}; Step 1 "
        "should be a direct download button, not a trip through the "
        "Releases page's Assets list"
    )


def _release_workflow_text() -> str:
    return (REPO_ROOT / ".github" / "workflows" / "release.yml").read_text()


@pytest.mark.parametrize("asset", sorted(STABLE_ASSETS.values()))
def test_release_workflow_publishes_the_stable_asset_name(asset: str):
    """The workflow must upload a file under the *exact* stable name.

    Not just the versioned glob (`TrustyTrack-*-mac.dmg`) — that still leaves
    the version in the published filename, which is what the stable URL
    promises callers it will not do. The versioned glob can never match this
    literal substring search (it has `-*-` where this has a single `-`), so a
    plain membership check already tells the two apart.
    """
    text = _release_workflow_text()
    assert asset in text, (
        f"{asset} does not appear in .github/workflows/release.yml — "
        "nothing publishes a release asset under this exact stable name, so "
        f"releases/latest/download/{asset} would 404"
    )


def test_release_workflow_uploads_both_stable_assets_to_the_release():
    """The stable-named copies must actually reach `gh release upload`.

    Creating the copies and forgetting to list them is the same failure as
    never creating them: the file sits in the runner's workspace and nothing
    ever uploads it.

    The command used to be `gh release create`; the release page is now the
    draft Release Drafter has been maintaining, so the assets are attached to
    it and it is published afterwards. What is being guarded is unchanged.
    """
    text = _release_workflow_text()
    match = re.search(r"gh release upload.*?(?=\n\s*\n|\Z)", text, re.S)
    assert match, "no `gh release upload` invocation found in release.yml"
    block = match.group(0)
    for asset in STABLE_ASSETS.values():
        assert asset in block, (
            f"the `gh release upload` command in release.yml does not reference {asset}"
        )


def test_the_windows_version_step_runs_under_bash():
    """The Windows job's version stamp must not be left to PowerShell.

    A Windows runner's default shell is PowerShell, where `\\"` is not an
    escape: the string ends at the first unescaped quote. What reached
    `backend/version.py` was three lines — `__version__ = \\`, the bare
    version, and an empty one — so the file was not Python at all. The build
    script reads the version out of it through `2>$null`, so the job died with
    a single line of traceback and no cause, after the release had already
    published the Docker image.

    The same `run:` line is correct on the two Linux and macOS jobs, which is
    why reading it does not reveal the bug — only the runner it lands on does.
    """
    workflow = yaml.safe_load(_release_workflow_text())
    steps = workflow["jobs"]["windows-exe"]["steps"]
    stamp = [s for s in steps if s.get("name") == "Set version in version.py"]
    assert stamp, "the Windows job no longer stamps a version into version.py"
    for step in stamp:
        assert step.get("shell") == "bash", (
            "the Windows job's `Set version in version.py` step must declare "
            "`shell: bash`; PowerShell writes a version.py that is not Python"
        )
