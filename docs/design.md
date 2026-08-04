# Trusty Track - Technical Design Document

## 1. Introduction

This document outlines the technical design for Trusty Track, a Cub Scout Pinewood Derby race management system. It details the architectural choices, component designs, data structures, and API specifications to meet the product vision and basic requirements described in the [Specification](spec.md). The system aims for ease of use, fairness, accuracy, and aesthetic appeal across various user interfaces and device types.

## 2. Architectural Overview

Trusty Track will follow a client-server architecture, comprising a Python-based backend API, a React-based frontend application, and optional remote proxy services for hardware interaction.

-   **Backend (Python):** Serves as the core application logic, data plane, and control plane. It will manage configuration, racer information, race scheduling, and result processing.
-   **Frontend (React):** Provides user interfaces for various device types (laptops, desktops, mobile phones, tablets, kiosks, large-format displays). It will consume data and interact with the backend via a well-defined API.
-   **Remote Proxies:** Optional services (e.g., Raspberry Pi) to bridge physical timing devices with the backend, especially when the backend is cloud-hosted or physically remote from the track.

```mermaid
graph LR
    A[Timing Device] -- Serial/USB --> RP((Remote Proxy))
    RP -- WebSocket/HTTP --> B[Backend API (Python/FastAPI)]
    F1[Frontend (React) - Admin] -- GraphQL/WebSocket --> B
    F2[Frontend (React) - Observer] -- GraphQL/WebSocket --> B
    B -- SQLAlchemy ORM --> DB[(SQLite / PostgreSQL)]
    F3[Frontend (React) - Kiosk/Display] -- WebSocket --> B
```

## 3. Backend Design (Python)

The backend will be developed in Python, leveraging a robust framework (e.g., FastAPI or Django REST Framework) to provide a scalable and maintainable API.

### 3.1. Core Application Logic

-   **Race Management:** Heat scheduling (PPC — see [Scheduling Algorithms](scheduling-algorithms.md)), championship advancement, and overall race progression. The rules live in `backend/domain/` as plain functions over plain values, with the database I/O in their callers.

-   **Data Processing:** Coalescing race results, calculating standings based on predefined rules.
-   **Configuration Management:** Handling global settings and race-specific configurations.

### 3.2. Data Storage

A relational database (e.g., PostgreSQL or SQLite for simpler deployments) will be used for persistence. An ORM (e.g., SQLAlchemy or Django ORM) will abstract database interactions.

**Key Entities:**

-   **`Group`**: Represents the racing organization (e.g., Cub Scout Pack).
    -   `id` (PK)
    -   `name`
-   **`Track`**: Configuration of the physical track.
    -   `id` (PK)
    -   `lane_count`
    -   `length_feet`
    -   `timer_type` (Enum: `FAKE`, `AUTO_DETECT_BACKEND`, `AUTO_DETECT_PROXY`)
    -   `serial_port` (for direct backend connection)
-   **`Race`**: Specific race event instance.
    -   `id` (PK)
    -   `group_id` (FK to Group)
    -   `track_id` (FK to Track, optional)
    -   `name` (unique)
    -   `date_time` (optional)
    -   `location` (optional)
    -   `car_numbering_strategy` (Enum: `PER_GROUP`, `GLOBAL`, `MANUAL`)
    -   `global_start_number` (if GLOBAL, default 1)
    -   `championship_trophies` (int, number of top finishers for championship, default 3)
    -   `scoring_strategy` (Enum: `TIMED`, `POINTS` - default `TIMED`)
    -   `rules_configuration` (JSON string, optional)
    -   `auto_advance_heat` (Boolean — move to the next heat on a countdown after a result)
    -   Note: Per-race `scheduling_strategy` was moved to the `Round` level. Rounds each have their own scheduling strategy.
-   **`Den`**: Sub-divisions within a race. Called `RacingGroup` in the early design; the implementation uses `Den` throughout, and the vestigial `racing_groups` table was dropped once it turned out to be written on every racer save and read by nothing.
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `name`
    -   `color` (hex color for branding)
    -   `rank` (Enum: `LION`, `TIGER`, `WOLF`, `BEAR`, `WEBELOS`, `ARROW_OF_LIGHT`, `OTHER`, optional)
    -   `car_number_range_start` (if PER_GROUP)
    -   `car_number_range_end` (if PER_GROUP)

-   **`Racer`**: Participant details.
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `den_id` (FK to Den, optional) — the primary grouping
    -   `first_name`
    -   `last_name`
    -   `car_number` (unique per race)
    -   `car_name` (optional)
    -   `car_weight` (optional)
    -   `car_passed_inspection` (Boolean, default `false`)
    -   `racer_image_url` (optional)
    -   `car_image_url` (optional)
-   **`Round`**: A collection of heats within a race (e.g., "Den Round", "Championship").
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `den_id` (FK to Den, optional — a round scoped to one den)
    -   `round_number`
    -   `name` (optional display name)
    -   `scheduling_strategy` (Enum: `PPC`)
    -   `advancement_source` (optional: `PACK`, `DEN`, or `ROUND:<id>`)
    -   `advancement_num_racers` (optional — **per den** when the source is `DEN`, absolute otherwise)

-   **`Heat`**: Individual race instances. Official heats belong to a round; free race heats do not.
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `round_id` (FK to Round, **nullable** — null for a free race heat)
    -   `kind` (Enum: `OFFICIAL`, `FREE`)
    -   `heat_number`
    -   `lane_results` (JSON string: `[{lane, racer_id, time, place}]`)
    -   `created_at` — when the row was written. For an official heat that is when its *round* was generated, not when it ran.
    -   `recorded_at` — when a result was last recorded, cleared on a re-run. The only field the two heat kinds can be ranked on together.
-   **`HeatLane`**: A normalized projection of `lane_results`, one row per lane.
    -   `heat_id` (FK to Heat), `lane`, `racer_id`, `placeholder_slot`, `time`, `place`, `skipped`
    -   The blob remains the source of truth and everything writes it; a SQLAlchemy session listener projects those writes into this table, so no write site has to know it exists. Reads — including the whole GraphQL read path — come from here.

**Not implemented:** a `User` entity with authentication and roles. Mutations
are unauthenticated and CORS is open, which is a deliberate deferral for a
single-operator machine on a venue LAN — see issue #15.

### 3.3. API Design

The backend exposes a **GraphQL API** at `/graphql` (using Strawberry) for all data operations and mutations. A small set of REST endpoints handle binary/file responses that GraphQL is unsuitable for.

**GraphQL Queries:**

-   `races(skip, limit)` — List all races.
-   `race(raceId)` — Get a single race with nested `racers`, `dens`, `rounds`, `heats`, `leaderboard`.
-   `racers(raceId, skip, limit)` — List racers.
-   `racer(racerId)` — Get a single racer.
-   `tracks()` — List configured tracks.
-   `groups()` — List organization groups.
-   `initialConfig()` — Initial configuration status (group + track).
-   `rounds(raceId)` — List rounds for a race.
-   `advancementStatus(raceId, roundId)` — Check round advancement eligibility.
-   `raceStats(raceId)` — Lane fairness, per-racer aggregates, top moments, den comparison.
-   `timerStatus(trackId)` — Device state for a track's timer.
-   `heatSession(trackId, heatId)` — What is on the track right now (see below).
-   `freeRaceHeats(raceId)`, `activeFreeRaceHeat(raceId)`, `randomFreeRaceLanes(raceId)`
-   `version` — Running application version.

**GraphQL Mutations:**

-   Race: `createRace`, `updateRace`, `deleteRace`
-   Racer: `createRacer`, `updateRacer`, `deleteRacer`, `checkInRacer`
-   Bulk racer actions: `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToDen`, `bulkDeleteRacers`, `bulkCheckIn`, `bulkAssignPhotos`
-   Den: `createDen`, `updateDen`, `deleteDen`
-   Track: `createTrack`, `updateTrack`, `deleteTrack`
-   Round/schedule: `createRoundWizard`, `createRound`, `regenerateRound`, `deleteRound`, `deleteHeat`, `advanceRound`, `reorderHeats`
-   Heat: `updateHeatResult` (takes `[HeatLaneInput!]!` — the same shape the read path returns)
-   Timer: `prepareHeat`, `abortHeat`, `forceResults`, `resetTimer`, `reconnectTimer`, `fakeTimerStart`, `fakeTimerFinish`
-   Free race: `startFreeRaceHeat`, `recordFreeRaceResult`, `deleteFreeRaceHeat`
-   Config: `createInitialConfig`, `updateInitialConfig`
-   Data: `importRacers` (CSV), `uploadImage` (base64), `populateRace` (test data)

**REST Endpoints (binary responses):**

-   `POST /upload/` — File upload, returns URL.
-   `GET /printables/barcode/{racer_id}.png` and `GET /api/printables/barcode/{racer_id}.png` — the check-in QR code. Registered at both paths because the Vite dev proxy strips the `/api` prefix; the payload is `TT1:<race_id>:<racer_id>`.

The driver's licence and pit pass have **no endpoint**. They are HTML the
browser prints, rendered by the frontend at `/race/:raceId/print` — there is no
PDF toolchain on a Raspberry Pi, the branding already lives in the frontend,
and a sheet of sixty is a CSS grid rather than a page-composition problem. The
QR code is the one part a page cannot draw for itself, which is why it is the
only part the server renders.

**GraphQL Subscriptions (real-time observation):**

Delivered over the existing `/graphql` endpoint using the `graphql-ws` subprotocol. Clients use urql's `useSubscription` hook; no separate WebSocket URL is needed.

-   `subscription raceStateChanged(raceId)` — Anything that changed the race, for cache invalidation.
-   `subscription leaderboard(raceId)` — Current standings, pushed on every heat result.
-   `subscription onDeck(raceId)` — Next-up racers.
-   `subscription currentlyRacing(raceId)` — Current heat racers and lane assignments.
-   `subscription timingStats(raceId)` — Per-lane timing for the most recently recorded heat, official or free.
-   `subscription heats(raceId)` — Full round/heat list with completion status.
-   `subscription timerStatus(trackId)` — Device state.
-   `subscription heatSession(trackId, heatId)` — The merged live view; see below.
-   `subscription freeRaceHeat(heatId)`, `subscription activeFreeRaceHeat(raceId)`

**`heatSession` is where "what is on the track" is decided**, on the server.
It merges the stored heat with the timer's pending lane times and reports a
phase — `NO_HEAT`, `NOT_READY`, `WAITING`, `RUNNING`, `RECORDED` — so no screen
has to re-derive it. A recorded heat ignores the timer, and a time that is only
in the timer is flagged as pending rather than presented as final.

## 4. Frontend Design (React)

The frontend will be built using React, providing a dynamic and responsive user experience across various devices.

### 4.1. Technology Stack

-   **Framework:** React 19
-   **Language:** TypeScript
-   **Build Tool:** Vite
-   **Styling:** Plain CSS with CSS custom properties (BSA color palette defined as variables).
-   **State Management:** React Context API (`AlertContext` for notifications); component-local state via hooks. The race-day flow between heats is a pure state machine (`features/racing/raceFlow.ts`) rather than effects.
-   **Routing:** React Router for navigation between pages.
-   **API Client:** `urql` with `@urql/exchange-graphcache` — subscriptions carry typed payloads into a normalized cache. Native `fetch` for file uploads.
-   **Types:** `src/gql/` and `schema.graphql` are generated from the backend schema; CI fails if they are stale.
-   **Testing:** Vitest + React Testing Library for unit/component tests; Playwright for end-to-end tests and for the documentation screenshots.

### 4.2. User Interfaces

The frontend will provide distinct interfaces tailored for different user journeys and device types:

-   **Admin/Configuration Interface:**
    -   Responsive layout for laptops, desktops, tablets.
    -   Forms for initial configuration, race setup, racer details (manual entry, CSV upload).
    -   Tables for managing racers and racing groups with editing capabilities.
    -   Printable generation interface.
-   **Check-In Interface:**
    -   Optimized for tablets and mobile phones.
    -   Camera scanning of printed check-in codes, using the browser's own `BarcodeDetector` — Chromium-only, with car-number entry alongside it on every browser.
    -   Quick toggles for `car_passed_inspection`.
    -   Forms for adding car name, racer/car pictures.
-   **Race Control Interface:**
    -   Designed for laptops/desktops.
    -   Heat scheduling visualization.
    -   Buttons to start/stop heats.
    -   Real-time feedback on heat progress.
-   **Observation Interfaces (Kiosks/Large Displays):**
    -   Minimalist, high-contrast "Projector Mode" designs.
    -   Dedicated views for "On Deck," "Currently Racing," "Timing Stats," "Leaderboard," and "Heats."
    -   Utilizes WebSocket for real-time updates without page refreshes.

### 4.3. UI & Branding Adherence

The UI will strictly follow the BSA Official Guidelines outlined in `SPEC.md`:

-   **Primary Colors:**
    -   Scouting Blue (`#003F87`): Used for headers, navigation, and primary buttons.
    -   Cub Scouting Gold (`#FCD116`): Used for check-in status indicators and call-to-action elements.
-   **Typography:**
    -   Headers: `Roboto Condensed Bold`
    -   Body: `Roboto Regular`
    -   Fonts will be loaded from a reliable source (e.g., Google Fonts).
-   **Design Elements:**
    -   Rounded corners (12px radius) will be applied consistently to interactive elements and containers.
    -   High-contrast themes will be available, particularly for observation views ("Projector Mode"), to ensure readability in various lighting conditions and on large displays.

## 5. Remote Proxy Design

Remote proxies facilitate communication between physical timing devices and the backend API, especially when direct serial connections are not feasible.

### 5.1. Proxy Functionality

-   **Serial/USB Communication:** Interface with timing devices (e.g., DerbyTimer compatible devices) to read race timing data.
-   **Data Forwarding:** Transmit timing data and device status to the backend API via WebSockets or HTTP POST requests.
-   **Command Relay:** Receive commands from the backend (e.g., "start race", "reset timer") and translate them into device-specific instructions.

### 5.2. Implementation Options

-   **Dedicated Device (e.g., Raspberry Pi):** A lightweight Python application (e.g., using `pyserial` and a WebSocket client library) running on a Raspberry Pi directly connected to the timing device. This provides a robust, standalone solution.
-   **Repurposed Frontend Device:** A frontend application running on a laptop could potentially host a small local server (e.g., using Electron or a similar framework that allows local serial port access) to act as a temporary proxy. This is more complex due to cross-platform compatibility for serial access. The preferred approach will be a dedicated Python application.

## 6. Data Models (Detailed)

(Already covered in Backend Design - 3.2. Data Storage, which includes key entities and their attributes).

## 7. API Design (Detailed)

(Already covered in Backend Design - 3.3. API Design, which includes key endpoints and interaction types).

## 8. UI/UX Considerations

The design emphasizes intuitive user journeys and accessibility.

-   **Initial Configuration:** Guided wizard-like flow with clear steps and reasonable defaults.
-   **Race Configuration:** Interactive forms with real-time feedback on proposed changes (e.g., car numbering strategy impact).
-   **Racer Details:** Flexible input options (bulk CSV, manual per-racer) with optional image uploads and auto-cropping.
-   **Race Check-In:** Streamlined process using camera-based scanning for quick racer lookup.
-   **Printables:** Sheet-first. The print page renders the whole sheet at paper size and the browser prints it; the operator's selection carries over from the roster, and an empty selection means the whole roster. Only the QR code comes from the backend.
-   **Race Operation:** Clear visualization of race progression and simple controls.
-   **Race Observation:** Real-time updates and high-visibility displays for various audience needs.

## 9. Future Considerations

Since built: automated testing (backend and frontend suites plus Playwright,
all gating CI) and a Docker image. Still open:

-   **BSA Integration:** Potential integration with BSA systems for roster import/export.
-   **Advanced Reporting:** More detailed race analytics and customizable reports.
-   **Internationalization (i18n):** Support for multiple languages.
-   **Accessibility (WCAG):** Ensure all UI components adhere to WCAG guidelines for inclusive design.
-   **Security:** Authentication and authorization on mutations, and a CORS policy narrower than `*`. Deferred by decision — it adds a prompt to a single-operator flow on a venue LAN — and tracked as issue #15.
