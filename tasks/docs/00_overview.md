# User Documentation — Overview

## Goal

Create user-facing documentation for Trusty Track aimed at **race event organizers and operators** — not software developers. The audience is a Cub Scout pack admin or race day volunteer who needs to understand how to use the application, not how to build it.

## Documentation Set

| Task | File | Document | Audience |
|------|------|----------|----------|
| 1 | `01_user_getting_started.md` | Getting Started Guide | First-time organizers |
| 2 | `02_race_setup.md` | Race Setup Guide | Pack admins setting up a race |
| 3 | `03_race_day.md` | Race Day Operations Guide | Check-in operators, race control operators |
| 4 | `04_observation_displays.md` | Observation & Audience Displays | Display/kiosk operators |

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

All documentation should be written in **Markdown** and placed under `docs/user/`:

```
docs/
  user/
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
```

The docs should be linkable from README.md.
