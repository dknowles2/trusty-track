# Trusty Track - Technical Design Document

## 1. Introduction

This document outlines the technical design for Trusty Track, a Cub Scout Pinewood Derby race management system. It details the architectural choices, component designs, data structures, and API specifications to meet the product vision and basic requirements described in `SPEC.md`. The system aims for ease of use, fairness, accuracy, and aesthetic appeal across various user interfaces and device types.

## 2. Architectural Overview

Trusty Track will follow a client-server architecture, comprising a Python-based backend API, a React-based frontend application, and optional remote proxy services for hardware interaction.

-   **Backend (Python):** Serves as the core application logic, data plane, and control plane. It will manage configuration, racer information, race scheduling, and result processing.
-   **Frontend (React):** Provides user interfaces for various device types (laptops, desktops, mobile phones, tablets, kiosks, large-format displays). It will consume data and interact with the backend via a well-defined API.
-   **Remote Proxies:** Optional services (e.g., Raspberry Pi) to bridge physical timing devices with the backend, especially when the backend is cloud-hosted or physically remote from the track.

```mermaid
graph LR
    A[Timing Device] -- Serial/USB --> RP((Remote Proxy))
    RP -- WebSocket/HTTP --> B[Backend API (Python)]
    F1[Frontend (React) - Admin] -- HTTP/WebSocket --> B
    F2[Frontend (React) - Observer] -- HTTP/WebSocket --> B
    B -- Data Storage --> DB[(Database)]
    F3[Frontend (React) - Kiosk/Display] -- HTTP/WebSocket --> B
```

## 3. Backend Design (Python)

The backend will be developed in Python, leveraging a robust framework (e.g., FastAPI or Django REST Framework) to provide a scalable and maintainable API.

### 3.1. Core Application Logic

-   **Race Management:** Scheduling algorithms for heats (Lane Rotation, Perfect-N), championship runoffs, and overall race progression.

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
    -   `timer_type` (Enum: `SKIP`, `FAKE`, `AUTO_DETECT_BACKEND`, `AUTO_DETECT_PROXY`)
    -   `serial_port` (for direct backend connection)
-   **`Race`**: Specific race event instance.
    -   `id` (PK)
    -   `group_id` (FK to Group)
    -   `name` (unique)
    -   `date_time` (optional)
    -   `location` (optional)
    -   `car_numbering_strategy` (Enum: `PER_GROUP`, `GLOBAL`, `MANUAL`)
    - `global_start_number` (if GLOBAL)
    - `scheduling_strategy` (Enum: `LANE_ROTATION`, `PERFECT_N`, `CHAOTIC` - default `LANE_ROTATION`)
    - `scoring_strategy` (Enum: `TIMED`, `POINTS` - default `TIMED`)
    - `rules_configuration` (JSON, optional parameters for the chosen strategies)
-   **`RacingGroup`**: Sub-divisions within a race (e.g., Den).
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `name`
    -   `rank` (Enum: `LION`, `TIGER`, etc., if Cub Scouts)
    -   `car_number_range_start` (if PER_GROUP)
    -   `car_number_range_end` (if PER_GROUP)
-   **`Racer`**: Participant details.
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `first_name`
    -   `last_name`
    -   `car_number` (unique per race)
    -   `car_name` (optional)
    -   `car_passed_inspection` (Boolean, default `false`)
    -   `racer_image_url` (optional)
    -   `car_image_url` (optional)
    -   `racing_group_id` (FK to RacingGroup, optional)
-   **`Heat`**: Individual race instances within a round.
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `round_number`
    -   `heat_number`
    -   `lane_results` (JSON or separate table, containing `racer_id`, `lane_number`, `time`, `place`)
-   **`User`**: (Implicit requirement for authentication/authorization if multi-user)
    -   `id` (PK)
    -   `username`
    -   `hashed_password`
    -   `role` (e.g., `ADMIN`, `OPERATOR`, `OBSERVER`)

### 3.3. API Design

The API will be RESTful over HTTP, with WebSocket support for real-time updates (e.g., race observation).

**Key Endpoints:**

-   `/api/config`:
    -   `GET /api/config/initial`: Retrieve initial configuration status.
    -   `POST /api/config/initial`: Submit initial setup (Group, Track details).
    -   `GET /api/config/global`: Retrieve global settings.
    -   `PUT /api/config/global`: Update global settings.
-   `/api/races`:
    -   `GET /api/races`: List all races.
    -   `POST /api/races`: Create a new race.
    -   `GET /api/races/{race_id}`: Retrieve race details.
    -   `PUT /api/races/{race_id}`: Update race details.
    -   `DELETE /api/races/{race_id}`: Delete a race.
-   `/api/races/{race_id}/groups`:
    -   `GET /api/races/{race_id}/groups`: List racing groups for a race.
    -   `POST /api/races/{race_id}/groups`: Add racing groups.
    -   `PUT /api/races/{race_id}/groups/{group_id}`: Update a racing group.
-   `/api/races/{race_id}/racers`:
    -   `GET /api/races/{race_id}/racers`: List racers for a race.
    -   `POST /api/races/{race_id}/racers/bulk`: Bulk import racers (CSV upload).
    -   `POST /api/races/{race_id}/racers`: Add a single racer.
    -   `GET /api/races/{race_id}/racers/{racer_id}`: Retrieve racer details.
    -   `PUT /api/races/{race_id}/racers/{racer_id}`: Update racer details (e.g., `car_passed_inspection`).
    -   `DELETE /api/races/{race_id}/racers/{racer_id}`: Delete a racer.
-   `/api/races/{race_id}/checkin`:
    -   `POST /api/races/{race_id}/checkin/scan`: Scan barcode/QR for racer lookup.
-   `/api/races/{race_id}/operation`:
    -   `POST /api/races/{race_id}/operation/schedule`: Generate and confirm race schedule.
    -   `POST /api/races/{race_id}/operation/start_heat`: Trigger a heat start.
    -   `GET /api/races/{race_id}/operation/status`: Get current race status.
-   `/api/races/{race_id}/observation`: (WebSocket endpoints for real-time updates)
    -   `/ws/races/{race_id}/on_deck`: Real-time updates for next racers.
    -   `/ws/races/{race_id}/currently_racing`: Real-time updates for current heat.
    -   `/ws/races/{race_id}/timing_stats`: Real-time timing data.
    -   `/ws/races/{race_id}/leaderboard`: Real-time standings.
    -   `/ws/races/{race_id}/heats`: Real-time heat progression.
-   `/api/printables`:
    -   `GET /api/printables/barcode/{racer_id}`: Generate barcode/QR for racer.
    -   `GET /api/printables/drivers_license/{racer_id}`: Generate driver's license.
    -   `GET /api/printables/pit_pass/{racer_id}`: Generate pit pass.

## 4. Frontend Design (React)

The frontend will be built using React, providing a dynamic and responsive user experience across various devices.

### 4.1. Technology Stack

-   **Framework:** React
-   **Language:** TypeScript (for type safety and better maintainability)
-   **Styling:** CSS-in-JS (e.g., Styled Components or Emotion) or utility-first CSS (e.g., Tailwind CSS) to ensure consistent branding and responsive design.
-   **State Management:** React Context API or a library like Zustand/Jotai for managing global and race-specific state.
-   **Routing:** React Router for navigation between different views.
-   **API Client:** `fetch` API or Axios for HTTP requests, WebSocket API for real-time data.

### 4.2. User Interfaces

The frontend will provide distinct interfaces tailored for different user journeys and device types:

-   **Admin/Configuration Interface:**
    -   Responsive layout for laptops, desktops, tablets.
    -   Forms for initial configuration, race setup, racer details (manual entry, CSV upload).
    -   Tables for managing racers and racing groups with editing capabilities.
    -   Printable generation interface.
-   **Check-In Interface:**
    -   Optimized for tablets and mobile phones.
    -   Camera integration for barcode/QR scanning.
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
-   **Printables:** Backend generates print-ready PDFs/images; frontend provides preview and download options.
-   **Race Operation:** Clear visualization of race progression and simple controls.
-   **Race Observation:** Real-time updates and high-visibility displays for various audience needs.

## 9. Future Considerations

-   **BSA Integration:** Potential integration with BSA systems for roster import/export.
-   **Advanced Reporting:** More detailed race analytics and customizable reports.
-   **Cloud Deployment:** Dockerization and Kubernetes readiness for scalable cloud deployments.
-   **Internationalization (i18n):** Support for multiple languages.
-   **Accessibility (WACG):** Ensure all UI components adhere to WCAG guidelines for inclusive design.
-   **Automated Testing:** Comprehensive unit, integration, and end-to-end tests for both backend and frontend.
-   **Security:** Implement authentication, authorization, input validation, and secure communication (HTTPS) from the outset.
