"""The `docs` dependency group must be able to build the docs on its own.

`mkdocs.yml` names a plugin, `uv sync --only-group docs` installs a group, and
until #468 nothing checked the two agreed: `mkdocs-callouts` lived only in
`dev`, so a host that ran `mkdocs` directly — without `uv run` silently
re-syncing `dev` back in first — had no plugin to render with. CI never saw
it: the `Docs Build` step ran `uv sync --only-group docs` and then `uv run
mkdocs build`, and `uv run` re-syncs the project's default group before doing
anything, so the missing plugin came back a moment after `--only-group docs`
removed it.

That half is fixed by invoking the venv's own binary in CI (`.venv/bin/mkdocs`
in `.github/workflows/ci.yml`'s `Docs Build` step and `.github/workflows/
docs.yml`'s `Deploy docs` job) rather than `uv run mkdocs`, so a missing
docs-group dependency now fails the build it appears to test. This file is
the fast, in-process half: a static cross-check between `mkdocs.yml`'s plugin
list and `pyproject.toml`'s `docs` dependency group, so a plugin added to one
without its package reaching the other fails immediately rather than waiting
for the next docs deploy.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PYPROJECT = REPO_ROOT / "pyproject.toml"
MKDOCS_CONFIG = REPO_ROOT / "mkdocs.yml"

#: Maps an `mkdocs.yml` plugin name to the PyPI distribution that provides it.
#: `None` means the plugin ships inside `mkdocs` itself, which every one of
#: mkdocs-material's own dependencies pulls in — so any docs-group install has
#: it for free and there is nothing separate to declare.
PLUGIN_PACKAGES = {
    "search": None,
    "callouts": "mkdocs-callouts",
}


def _docs_group_deps() -> str:
    text = PYPROJECT.read_text()
    match = re.search(r"^docs = \[\n(.*?)^\]\n", text, re.M | re.S)
    assert match, "no `docs = [...]` dependency group in pyproject.toml"
    return match.group(1)


def _mkdocs_plugins() -> list[str]:
    text = MKDOCS_CONFIG.read_text()
    match = re.search(r"^plugins:\n((?:  - .*\n)+)", text, re.M)
    assert match, "no `plugins:` list in mkdocs.yml"
    return re.findall(r"^  - (\w+)", match.group(1), re.M)


def test_every_docs_plugin_package_is_named_in_plugin_packages():
    """Catches a plugin added to mkdocs.yml with no entry in `PLUGIN_PACKAGES`.

    Without this, a new plugin would silently skip the check below rather
    than failing it.
    """
    known = set(PLUGIN_PACKAGES)
    used = set(_mkdocs_plugins())
    unknown = used - known
    assert not unknown, (
        f"mkdocs.yml loads plugin(s) {sorted(unknown)} with no entry in "
        "PLUGIN_PACKAGES in backend/tests/test_docs_dependency_group.py. Add "
        "one naming the PyPI distribution that provides it (or None if it "
        "ships inside mkdocs itself), so this test can check it belongs to "
        "the `docs` dependency group."
    )


def test_every_mkdocs_plugin_is_in_the_docs_dependency_group():
    """A plugin `mkdocs.yml` loads must be installable from `docs` alone.

    Otherwise `uv sync --only-group docs` produces an environment that cannot
    build the site — the failure #468 describes.
    """
    docs_deps = _docs_group_deps()
    for plugin in _mkdocs_plugins():
        package = PLUGIN_PACKAGES.get(plugin)
        if package is None:
            continue
        assert package in docs_deps, (
            f"mkdocs.yml loads the `{plugin}` plugin (from `{package}`), but "
            f"`{package}` is not declared in pyproject.toml's `docs` "
            "dependency group. `uv sync --only-group docs` would not be able "
            "to build the documentation."
        )
