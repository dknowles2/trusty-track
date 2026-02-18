# Documentation Task: Getting Started Guide [IN PROGRESS]

## Document Details

| Field            | Value                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| **Output file**  | `docs/user/getting-started.md`                                                   |
| **Audience**     | A pack admin or organizer running Trusty Track for the first time                |
| **Goal**         | Walk the user from "software is installed" to "ready to add racers"              |
| **Prerequisite** | Trusty Track is already installed and running (covered in `docs/development.md`) |

---

## Outline

### 1. Welcome to Trusty Track

Brief paragraph: what the app does, who it's for, and what a typical event looks like at a high level. No technical details.

### 2. Opening the App

- Explain that Trusty Track runs in a web browser.
- Show the URL format (e.g., `http://localhost:5173` or the address provided by whoever set up the software).
- Explain that multiple people can open it on different devices at the same time.

**Screenshot required:** The home screen / landing page on first launch (before any races exist). Should show the "no races yet" empty state.

### 3. First-Time Setup: System Settings

Explain that the first time you open the app, you'll be asked to provide some basic information about your organization and track. Walk through each field:

- **Organization / Pack Name** — the name of your pack or group.
- **Track: Number of Lanes** — how many lanes the physical track has.
- **Track: Length** — track length in feet.
- **Timer Type** — what device is timing the race. Options:
  - _Fake Timer_ — good for testing; generates simulated times.
  - _Auto-detect_ — for a real timer connected to the computer.

**Screenshot required:** System Settings form, filled in with sample data. Annotate the timer selection field.

**Screenshot required:** System Settings saved — confirmation state or redirect to home.

### 4. Creating Your First Race

After system settings are saved, show how to create a new race:

- Click "New Race" (or equivalent button on the home screen).
- Fill in the race form:
  - Race Name (e.g., "2026 Pack 42 Pinewood Derby")
  - Date and Location (optional but recommended)
  - Racing Groups / Dens (e.g., Lion, Tiger, Wolf, Bear, Webelos, Arrow of Light)
  - Car Numbering Strategy (Global, Per-Group, or Manual) — briefly explain each option.

**Screenshot required:** The "New Race" form, partially filled with sample data.

**Screenshot required:** The Den/Group setup section — show at least 3 dens added with rank colors displayed.

**Screenshot required:** The completed race view after saving — the race details page showing the race name and empty racer list.

### 5. What's Next

Brief summary with links to:

- [Race Setup Guide](race-setup.md) — adding racers and managing dens
- [Race Day Operations Guide](race-day.md) — check-in and running the race
- [Observation & Audience Displays Guide](observation-displays.md) — setting up kiosks and displays

---

## Notes for the Writer

- Keep steps numbered and concise. Each screenshot should immediately follow the step it illustrates.
- Do not mention GraphQL, the backend, or any technical infrastructure.
- The timer auto-detect section can note "your race administrator will have set this up for you" if the audience may not be the person who installed the software.
- If the "Initial Configuration" flow is skipped on subsequent visits (because it was already done), note that System Settings can be changed at any time via the navigation menu.
