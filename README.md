<p align="center">
  <img src="docs/assets/logo.png" alt="Trusty Track Logo" width="500">
</p>

# Trusty Track

<p align="center">
  <strong><a href="https://trusty-track.com">trusty-track.com</a></strong> ·
  <a href="https://demo.trusty-track.com">Live demo</a> ·
  <a href="https://trusty-track.com/docs/">Documentation</a> ·
  <a href="https://trusty-track.com/docs/user/install/">Install</a>
</p>

**Trusty Track** is race management software for Cub Scout Pinewood Derby events. It runs in a web browser and handles everything from racer registration through final standings — so you can focus on the race, not the paperwork.

---

## What It Does

### Before Race Day

- **Set up your race** — name, date, location, and racing groups (dens).
- **Register racers** individually or by bulk-importing a CSV from your pack's roster.
- **Assign car numbers** automatically or manually, with flexible numbering strategies (global, per-den, or fully manual).
- **Print pit passes, driver's licences and check-in codes** — a sheet at a time, on a normal printer.

### On Race Day

- **Check in racers** — verify each car passed inspection and optionally capture racer and car photos. Scan a printed code to jump straight to a racer.
- **Schedule heats automatically** using a fair scheduling algorithm that ensures each car races in every lane.
- **Run the race** with live timer integration — results appear automatically as each heat finishes.
- **Advance to a championship round** — the top finishers race again for final placement.
- **Race the slowest cars** — a just-for-fun Slowest Race bracket where the last one down the track wins.
- **Elimination racing** — ladderless elimination: lose too many heats and you're out, no bracket to draw, last car standing wins.
- **Balanced racing** — each round of heats matches cars doing about as well, so more children get a heat they can win.
- **Run free races** — practice, exhibition and end-of-day fun heats that never touch the standings.

### After the Race

- **Race statistics** — lane fairness, per-racer averages and consistency, den comparisons, and CSV exports for your records.

### For the Audience

- **Live observation display** — show current racers, the next heat on deck, and a live leaderboard on any screen or projector. All displays update in real-time as the race progresses.

---

## Documentation

For the full documentation and user guides, visit: **[https://trusty-track.com/docs/](https://trusty-track.com/docs/)**

### User Guides

| Guide                                                     | Description                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| [Getting Started](https://trusty-track.com/docs/getting-started/)           | First-time setup: system settings and creating your first race    |
| [Race Setup Guide](https://trusty-track.com/docs/race-setup/)               | Managing dens, registering racers, and preparing the roster       |
| [Race Day Operations](https://trusty-track.com/docs/race-day/)              | Check-in, scheduling heats, running the race, and final standings |
| [Scoring & Championships](https://trusty-track.com/docs/scoring-and-championships/) | How scores are worked out, and how championship rounds pick their field |
| [Awards](https://trusty-track.com/docs/awards/)                             | Speed trophies, and the judged ones the timer cannot decide       |
| [Printables](https://trusty-track.com/docs/printables/)                     | Pit passes, driver's licences, and scannable check-in codes       |
| [Free Race](https://trusty-track.com/docs/free-race/)                       | Practice and exhibition heats that count for nothing              |
| [Hardware Timer](https://trusty-track.com/docs/hardware-timer/)             | Connecting an electronic finish line, checking it works, and sending us a test report |
| [Fake Timer](https://trusty-track.com/docs/fake-timer/)                      | Running the whole thing without a track, for practice             |
| [Observation Displays](https://trusty-track.com/docs/observation-displays/) | Setting up audience screens and projectors                        |
| [Race Stats](https://trusty-track.com/docs/race-stats/)                     | Lane fairness, per-racer numbers, and CSV exports                 |
| [Access and Your Network](https://trusty-track.com/docs/access-and-network/) | PINs, which network to use, what a display may do, and the activity log |
| [Backup and Restore](https://trusty-track.com/docs/backup-and-restore/)     | Saving the whole event to one file, and putting it back           |

### Installation

| Method | Difficulty | Best for |
|--------|-----------|----------|
| [macOS App](https://trusty-track.com/docs/user/install-mac/) | Easy | Mac users |
| [Windows App](https://trusty-track.com/docs/user/install-windows/) | Easy | Windows users |
| [Docker](https://trusty-track.com/docs/user/install-docker/) | Medium | Home servers, NAS devices |
| [Raspberry Pi](https://trusty-track.com/docs/user/install-raspberry-pi/) | Medium | Dedicated race-day appliance |
| [From Source](https://trusty-track.com/docs/user/install-from-source/) | Advanced | Developers |

Not sure which to pick? See [Which method should I use?](https://trusty-track.com/docs/user/install/)

---

### Quick Start (From Source)

```bash
# Install dependencies and build the frontend
./scripts/install.sh

# Start the server
./scripts/serve.sh
```

Then open `https://localhost:8005` in your browser. `serve.sh` always runs over HTTPS with a self-signed certificate it generates on first run, so your browser will warn that the certificate isn't trusted — that's expected for a local install; accept it to continue.

---

## Developer Documentation

If you're working on Trusty Track itself:

- [Development Guide](https://trusty-track.com/docs/development/) — local setup, testing, and troubleshooting
- [Design](https://trusty-track.com/docs/design/) — architecture, data models, and API design
- [Specification](https://trusty-track.com/docs/spec/) — detailed product requirements and user journeys
- [Scheduling Algorithms](https://trusty-track.com/docs/scheduling-algorithms/) — how heats are generated (PPC / Perfect-N)
