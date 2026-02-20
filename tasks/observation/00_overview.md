# Observation Feature Improvements Overview

## Background

SPEC.md defines several race observation views for bystanders:

1. **On Deck** - What racers are next to race
2. **Currently Racing** - The current racers (configurable: racer or car pictures)
3. **Timing Stats** - Exact timing of the last/current heat with basic racer details
4. **Leaderboard** - Current standings
5. **Heats** - A view of expected heat progression, annotated with racer/car names

Additional goals:

- Real-time updates via **GraphQL subscriptions** (not polling) — consistent with the project's GraphQL-first architecture
- High-contrast **"Projector Mode"** for kiosks and large-format displays

## Current State

The existing `Observation.tsx` page implements:

- "Now Racing" (current heat) and "On Deck" (next heat)
- Leaderboard with standings
- Racer avatars and car numbers
- 5-second polling for updates

**Missing:**

- Timing Stats dedicated view
- GraphQL subscription real-time updates (instead of polling)
- Projector Mode (high-contrast for displays)

## Task Breakdown

- `01_subscription_backend.md` - Add GraphQL subscriptions to the backend
- `02_subscription_frontend.md` - Replace polling with GraphQL subscriptions in Observation.tsx
- `03_timing_stats_view.md` - Add Timing Stats observation view
- [x] `04_projector_mode.md` - Add Projector/high-contrast display mode [COMPLETED]

## Design Reference

- SPEC.md: "Race Observation" section
- DESIGN.md: Section 4.2 "Observation Interfaces" and Section 3.3 WebSocket endpoints
