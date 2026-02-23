# User Documentation — Overview

## Goal

Create user-facing documentation for Trusty Track aimed at **race event organizers and operators** — not software developers. The audience is a Cub Scout pack admin or race day volunteer who needs to understand how to use the application, not how to build it.

## Documentation Set

| Task     | File                         | Document                             | Audience                                   |
| -------- | ---------------------------- | ------------------------------------ | ------------------------------------------ |
| 0 [DONE] | `05_github_pages_setup.md`   | GitHub Pages / MkDocs infrastructure | Developer / repo maintainer                |
| 1 [DONE] | `01_user_getting_started.md` | Getting Started Guide                | First-time organizers                      |
| 2 [DONE] | `02_race_setup.md`           | Race Setup Guide                     | Pack admins setting up a race              |
| 3        | `03_race_day.md`             | Race Day Operations Guide            | Check-in operators, race control operators |
| 4        | `04_observation_displays.md` | Observation & Audience Displays      | Display/kiosk operators                    |
| 5        | `06_race_stats.md`           | Race Stats Guide                     | Organizers reviewing per-racer and lane stats, exporting results |

Task 0 (infrastructure) should be completed first; the content tasks (1–4) can proceed in parallel once the site skeleton exists.

## Guiding Principles

- **Screenshots are required** for every major step. No doc section that describes a UI action should be text-only.
- Write for a non-technical audience. Avoid jargon like "GraphQL", "backend", "endpoint", "ORM".
- Use numbered steps for sequential workflows; use screenshots to confirm what the user should see at each step.
- Organize by the natural event-day workflow: setup → racer entry → check-in → race → observation.
- Where a feature is not yet implemented (printables, QR scanning, projector mode), either omit it or include a brief "Coming Soon" note.

## Screenshot Standards

All screenshots should:

- Be captured at **1280×800 resolution** or wider.
- Use **realistic sample data** (a plausible pack name, realistic racer names, multiple dens).
- Show **both light and dark states** where applicable (e.g., checked-in vs. not checked-in racers).
- Be saved as **PNG** files in a `docs/assets/screenshots/` folder, organized by guide name.
- Be captioned with a brief description of what is shown.

### Screenshot Naming Convention

```
docs/assets/screenshots/<guide-slug>/<step-number>-<short-description>.png
```

Examples:

- `docs/assets/screenshots/race-setup/01-new-race-form.png`
- `docs/assets/screenshots/race-day/05-check-in-modal.png`
- `docs/assets/screenshots/observation/02-leaderboard-view.png`

## Delivery Format

### Source files

All documentation is written in **Markdown** and lives under `docs/`:

```
docs/
  index.md                    # Site home page (welcome + navigation overview)
  getting-started.md
  race-setup.md
  race-day.md
  observation-displays.md
  assets/
    screenshots/
      getting-started/
      race-setup/
      race-day/
      observation/
mkdocs.yml                    # MkDocs site configuration
.github/
  workflows/
    docs.yml                  # GitHub Actions — auto-deploy on push to main
```

### Website

The Markdown files are compiled into a user-friendly website by **MkDocs** (with the Material theme) and hosted on **GitHub Pages** at the repo's Pages URL. The website is rebuilt and re-deployed automatically whenever a commit touches the `docs/` directory on `main`.

See `tasks/docs/05_github_pages_setup.md` for the full infrastructure setup task.

The docs should also be linkable from README.md (point to the GitHub Pages URL, not the raw Markdown).
