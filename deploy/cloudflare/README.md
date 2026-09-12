# Deploying trusty-track.com

The site is one Cloudflare Pages project holding both halves:

| Path | What it is | Source |
| --- | --- | --- |
| `/` | The landing page | `www/` |
| `/docs/` | The guides and reference | `docs/`, built by mkdocs |

`scripts/build_site.sh` assembles them into `dist/`. Nothing else is involved —
no framework, no bundler, and the landing page has no build step of its own.

## Why one project rather than two

The landing page links into the guides about fifteen times and the guides link
back, so on separate hosts every one of those is a cross-origin hop that has to
be kept in step by hand. Sharing an origin also means the landing page can
render `/docs/assets/screenshots/...` directly rather than keeping a second copy
of images the Playwright specs in `frontend/e2e/docs/` regenerate — a copy would
go stale the first time somebody re-ran a spec, silently, because a stale
picture still renders.

`backend/tests/test_landing_page_links.py` is what keeps those links honest;
`mkdocs build --strict` never looks at `www/`.

## Setting the project up

In the Cloudflare dashboard: **Workers & Pages → Create application → Pages →
Connect to Git**. Take the **Pages** tab specifically — the dashboard leads with
Workers, and "Import a repository" from that side creates a Worker with static
assets instead, which is a different product with a different build form: it has
no **Build output directory** field at all, because for a Worker that setting is
`assets.directory` in a `wrangler.jsonc` committed to the repository. Either
would serve this site; Pages is the one written up here, and it needs nothing in
the repository.

Pick this repository, and set:

| Setting | Value |
| --- | --- |
| Production branch | `release` |
| Build command | `pip install -r docs/requirements.txt && bash scripts/build_site.sh` |
| Build output directory | `dist` |
| Root directory | *(leave blank — the repository root)* |

Add one environment variable, **`PYTHON_VERSION` = `3.12`**. Without it the
build image picks its own, and mkdocs-material's floor moves faster than the
image does.

Then under **Builds & deployments → Preview deployments**, choose **Custom
branches** and list `main` alone.

## Which branch is the site

The site follows **releases, not merges**. `release` is a branch nobody
commits to: `release.yml`'s `publish-site` job force-pushes it to the tag of
every stable release, alongside the job that pushes the same version to the
demo. So the guides describe what a reader can actually download from the
release page, and the front page's demo runs the build the front page is
describing — where building from `main` had the site documenting features
that were weeks from any installer, and that the demo did not have.

`main` is still built on every merge, as a **preview** at
`main.<project>.pages.dev` — the same build, the same `_headers`, only the
address differs. That is where to read a docs change before it is released.
Listing `main` alone rather than every non-production branch is what keeps
feature branches from spending the plan's build quota on previews nobody
opens.

Two consequences worth knowing:

- **A docs fix waits for the next release.** If one cannot wait — a wrong
  download link, say — `git push --force origin v1.2.3:release` from any
  checkout moves the site to that tag by hand; the next release's own push
  supersedes it. Do not push `main` there: that is the state this exists to
  keep off the site.
- **Pre-releases never move it**, for the same reason they never claim
  `latest` or the demo: `releases/latest/download/<asset>` is what the
  install guides link to, and a site describing a release candidate would
  send readers to an installer that is not the one at that address.

Then **Custom domains → Set up a custom domain** for `trusty-track.com` and
again for `www.trusty-track.com`. DNS is already on Cloudflare, so both are
created for you; Pages redirects the `www` host to the apex.

## What is in `www/` besides the page

- `_headers` — Cloudflare Pages reads this from the root of the deployed
  directory. Security headers for everything, and caching rules that let the
  screenshots be re-fetched when a spec regenerates them while pinning mkdocs'
  own fingerprinted bundles.
- `robots.txt` — points crawlers at the sitemap mkdocs writes to
  `/docs/sitemap.xml`.
- `404.html` — what Pages serves for an address that does not exist. mkdocs
  writes its own to `dist/docs/`, and Pages prefers the nearest one, so a
  mistyped guide address lands on a documentation page with the search box on it
  rather than on this one.

## Building it yourself

```bash
./scripts/build_site.sh
python3 -m http.server -d dist 8080
```

Then open <http://localhost:8080/>. Serve it rather than opening
`dist/index.html` from the filesystem: every link on the page is root-relative,
so `file://` resolves them against the disk root and none of them work.

## The old address

`dknowles2.github.io/trusty-track/` still answers, and forwards every path to
its equivalent under `/docs/`. See [`../ghpages-redirect/`](../ghpages-redirect/README.md).
