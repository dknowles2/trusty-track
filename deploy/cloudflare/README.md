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

In the Cloudflare dashboard, **Workers & Pages → Create → Pages → Connect to
Git**, pick this repository, and set:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `pip install -r docs/requirements.txt && bash scripts/build_site.sh` |
| Build output directory | `dist` |
| Root directory | *(leave blank — the repository root)* |

Add one environment variable, **`PYTHON_VERSION` = `3.12`**. Without it the
build image picks its own, and mkdocs-material's floor moves faster than the
image does.

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
