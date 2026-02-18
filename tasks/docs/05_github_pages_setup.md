# Documentation Task: GitHub Pages & MkDocs Infrastructure Setup [DONE]

## Goal

Set up a GitHub Pages–hosted documentation website that is generated from Markdown files in the repo. Writers work only in Markdown; the site rebuilds and deploys automatically on every push to `main`.

## Technology choice

| Tool                          | Reason                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| **MkDocs**                    | Python-based (consistent with backend stack); minimal config; first-class GitHub Pages support       |
| **Material for MkDocs** theme | Polished, mobile-friendly, accessible; built-in search, navigation tabs, admonitions, image lightbox |
| **GitHub Actions**            | Free CI/CD; official MkDocs action keeps deployment simple                                           |

Alternatives considered and rejected:

- **Docusaurus** — React/Node; heavier; better for versioned API docs than narrative user guides.
- **Jekyll** — natively supported by GitHub Pages, but less control over layout; Material theme not available.
- **VitePress** — Vue-based; would add another frontend framework to maintain.

---

## Deliverables

### 1. `mkdocs.yml` (repo root)

```yaml
site_name: Trusty Track Help
site_description: User guide for Trusty Track Pinewood Derby race management
site_url: https://<org>.github.io/trusty-track/ # update to real URL
repo_url: https://github.com/<org>/trusty-track
repo_name: trusty-track
edit_uri: edit/main/docs/

theme:
  name: material
  palette:
    primary: custom # --scouting-blue (#003F87)
    accent: custom # --gold (#FCD116)
  features:
    - navigation.tabs
    - navigation.sections
    - navigation.top
    - search.highlight
    - content.action.edit # "edit this page" link
  logo: assets/logo.png # placeholder; add later

extra_css:
  - assets/extra.css # custom color overrides

nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - Race Setup: race-setup.md
  - Race Day: race-day.md
  - Observation Displays: observation-displays.md

plugins:
  - search

markdown_extensions:
  - admonition # tip/note/warning boxes
  - attr_list # image sizing via { width=... }
  - md_in_html
  - pymdownx.details # collapsible sections
  - pymdownx.superfences
  - pymdownx.tabbed:
      alternate_style: true
```

Replace `<org>` with the actual GitHub organization or username once the repo's Pages URL is known.

### 2. `docs/index.md`

The site home page. Should include:

- A brief tagline ("Trusty Track helps Cub Scout packs run Pinewood Derby events without spreadsheets.")
- A "Where do I start?" section with cards or bullet links to each guide.
- A note about what the app does _not_ require (no technical knowledge, no server administration for the operator).

### 3. `docs/assets/extra.css`

Custom color overrides so the site uses scouting brand colors instead of MkDocs Material defaults:

```css
:root {
  --md-primary-fg-color: #003f87; /* scouting blue */
  --md-primary-fg-color--light: #1a5faa;
  --md-primary-fg-color--dark: #002d63;
  --md-accent-fg-color: #fcd116; /* gold */
}
```

### 4. `.github/workflows/docs.yml`

GitHub Actions workflow that rebuilds and deploys the site on every push to `main` that touches `docs/` or `mkdocs.yml`:

```yaml
name: Deploy docs

on:
  push:
    branches: [main]
    paths:
      - "docs/**"
      - "mkdocs.yml"
  workflow_dispatch: # allow manual trigger

permissions:
  contents: write # needed to push to gh-pages branch

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history for git-dates plugin (optional)

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install MkDocs
        run: pip install mkdocs-material

      - name: Build and deploy
        run: mkdocs gh-deploy --force
```

This pushes the built site to the `gh-pages` branch. Configure GitHub Pages in the repo settings to serve from `gh-pages`.

### 5. GitHub Pages repo setting

In **Settings → Pages**:

- Source: **Deploy from a branch**
- Branch: `gh-pages`, folder: `/ (root)`

After the first workflow run, the site will be live at `https://<org>.github.io/trusty-track/`.

### 6. Content placeholder files

Before the content tasks (01–04) are complete, the site should have stub pages so the navigation renders correctly and writers can verify the site builds. Create minimal stubs:

```
docs/index.md                 # proper home page (see §2 above)
docs/getting-started.md       # stub: "Guide coming soon"
docs/race-setup.md            # stub
docs/race-day.md              # stub
docs/observation-displays.md  # stub
```

---

## Setup sequence

1. Install MkDocs locally to verify the build before committing:
   ```bash
   pip install mkdocs-material
   mkdocs serve    # preview at http://127.0.0.1:8000
   ```
2. Add `mkdocs.yml`, `docs/index.md`, stub pages, `docs/assets/extra.css`, and the GitHub Actions workflow in a single commit.
3. Push to `main`. The Actions workflow will run and deploy to `gh-pages`.
4. Enable GitHub Pages in repo settings (source: `gh-pages` branch).
5. Verify the site loads at the Pages URL.
6. Update `README.md` to link to the Pages URL under a "Documentation" heading.

---

## Local development notes

Writers can preview their changes locally without pushing:

```bash
pip install mkdocs-material   # one-time
mkdocs serve                  # live-reload preview at http://127.0.0.1:8000
```

No backend or frontend setup is needed to work on the documentation.

---

## Screenshot hosting

Screenshots (`.png` files) live in `docs/assets/screenshots/<guide>/` alongside the Markdown. They are committed directly to the repo — no external image hosting needed. MkDocs copies them into the built site automatically.

Reference screenshots in Markdown with relative paths:

```markdown
![Check-in modal](../assets/screenshots/race-day/05-check-in-modal.png)
```

Use the MkDocs `attr_list` extension to control display size when needed:

```markdown
![Check-in modal](../assets/screenshots/race-day/05-check-in-modal.png){ width=600 }
```

---

## Notes

- The `gh-pages` branch is managed entirely by the Actions workflow. Do not commit directly to it.
- If the repo is private, GitHub Pages requires a paid plan. If docs need to be public, the repo must be public or a custom domain / Pages override must be configured.
- The `edit_uri` in `mkdocs.yml` adds an "Edit this page" button on every page that links directly to the Markdown source on GitHub — useful for writers who want to make quick fixes.
