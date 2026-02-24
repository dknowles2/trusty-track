# Trusty Track

**Trusty Track** is race management software for Cub Scout Pinewood Derby events. It runs in a web browser and handles everything from racer registration through final standings — so you can focus on the race, not the paperwork.

---

## What It Does

### Before Race Day

- **Set up your race** — name, date, location, and racing groups (dens).
- **Register racers** individually or by bulk-importing a CSV from your pack's roster.
- **Assign car numbers** automatically or manually, with flexible numbering strategies (global, per-den, or fully manual).

### On Race Day

- **Check in racers** — verify each car passed inspection and optionally capture racer and car photos.
- **Schedule heats automatically** using a fair scheduling algorithm that ensures each car races in every lane.
- **Run the race** with live timer integration — results appear automatically as each heat finishes.
- **Advance to a championship round** — the top finishers race again for final placement.

### For the Audience

- **Live observation display** — show current racers, the next heat on deck, and a live leaderboard on any screen or projector. All displays update in real-time as the race progresses.

---

## User Documentation

| Guide                                                     | Description                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| [Getting Started](docs/user/getting-started.md)           | First-time setup: system settings and creating your first race    |
| [Race Setup Guide](docs/user/race-setup.md)               | Managing dens, registering racers, and preparing the roster       |
| [Race Day Operations](docs/user/race-day.md)              | Check-in, scheduling heats, running the race, and final standings |
| [Observation Displays](docs/user/observation-displays.md) | Setting up audience screens and projectors                        |

---

## Running the App

Trusty Track runs a local server on your computer. You access it through a web browser, and anyone on the same network can open it on their own device (tablet, laptop, phone).

### Quick Start (From Source)

The easiest way to run Trusty Track from source is using the convenience scripts:

```bash
# Install dependencies and build the frontend
./scripts/install.sh

# Start the server
./scripts/serve.sh
```

Then open `http://localhost:8005` in your browser.

For a two-terminal development workflow with live reload, or for other deployment options like Docker, see the [Development Guide](docs/development.md).

---

## Developer Documentation

If you're working on Trusty Track itself:

- [Development Guide](docs/development.md) — local setup, testing, and troubleshooting
- [Design](DESIGN.md) — architecture, data models, and API design
- [Specification](SPEC.md) — detailed product requirements and user journeys
- [Scheduling Algorithms](docs/scheduling-algorithms.md) — how heats are generated (PPC / Perfect-N)
