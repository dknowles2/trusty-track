# Documentation Task: Observation & Audience Displays Guide

## Document Details

| Field | Value |
|-------|-------|
| **Output file** | `docs/user/observation-displays.md` |
| **Audience** | Event organizers setting up audience-facing screens, display operators |
| **Goal** | Explain how to open and use the Observation page on a projector, large display, or tablet so spectators can follow the race in real-time |
| **Prerequisite** | A race is in progress or about to begin |

---

## Outline

### 1. What Is the Observation View?

Explain that Trusty Track includes a dedicated audience display — a page designed to be shown on a projector, large monitor, TV, or tablet. It updates automatically as the race progresses.

**Screenshot required:** The full Observation page in a realistic state — showing "Currently Racing" and "On Deck" panels, plus the live leaderboard. Use sample data with racer photos and den colors.

---

### 2. Opening the Observation View

Step-by-step instructions for getting the page on screen:

1. Open a browser on the display device (laptop, tablet, kiosk).
2. Navigate to the Trusty Track observation URL: `http://<server-address>/race/<race-id>/observation`
3. The page will connect automatically and begin showing live data.

Explain that the display device does not need to be the same device running race control — you can open the observation view on any device on the same network.

**Screenshot required:** A browser address bar showing the observation URL, with the page loading behind it.

---

### 3. What the Observation Page Shows

#### 3.1 Currently Racing

The "Currently Racing" panel shows which cars are on the track right now. For each racer it shows:

- Racer name
- Car number
- Lane number
- Racer photo (if available)

**Screenshot required:** The "Currently Racing" panel with 4 racers, each showing a placeholder avatar and their names/car numbers. Annotate the lane number display.

#### 3.2 On Deck

The "On Deck" panel shows which racers will race in the next heat, so they can line up and be ready.

**Screenshot required:** The "On Deck" panel showing the next heat's racers.

#### 3.3 Live Leaderboard

The leaderboard shows current standings for all racers as of the last completed heat. It updates after each heat finishes.

Columns: placement, racer name, den, car number, average time (seconds), number of heats run.

**Screenshot required:** The live leaderboard with 8–10 racers showing realistic times (e.g., 2.8–3.5 seconds), den color indicators, and clear rank positions.

---

### 4. Recommended Display Setups

Brief guidance on how to use the observation page effectively in different setups:

#### Large Projector or TV

- Open a full-screen browser window on the display device.
- Use the browser's full-screen mode (F11 on most browsers).
- Place the display where most of the audience can see it (end of track, along the side, etc.).

**Screenshot required:** The Observation page in a simulated full-screen / kiosk layout, cropped to show what it looks like on a wide display.

#### Tablet at the Track

- Open the observation page in a tablet browser.
- Works well as a secondary display near the starting gate for the race operator to confirm who's on deck.

#### Multiple Displays

- You can open the observation page on as many devices as you want simultaneously.
- All devices show the same live data.

---

### 5. Tips for a Great Audience Experience

- **Add racer photos** during check-in. The "Currently Racing" panel shows photos if they've been uploaded — this makes the display much more engaging for parents and spectators.
- **Position the display** at the end or side of the track where it's visible to the whole crowd.
- **Leave it running** — the page updates automatically; no one needs to manually refresh it.

---

### 6. Coming Soon: Projector Mode

> **Note:** A dedicated high-contrast "Projector Mode" is planned for a future release. It will offer larger text, higher contrast colors, and a layout specifically optimized for large-format displays and bright rooms. See `tasks/observation/04_projector_mode.md` for details.

**Screenshot required (when implemented):** Side-by-side comparison of the standard observation view and Projector Mode.

---

## Notes for the Writer

- This is the most audience-visible part of the application — screenshots should look polished and use realistic race data.
- Note that the observation page currently updates via polling (every ~5 seconds), so there may be a brief delay between a heat finishing and the display updating. This is worth mentioning so spectators aren't confused.
- Do not mention WebSockets, GraphQL subscriptions, or any networking internals.
- If racer photos haven't been added, the display still works — show both states in screenshots (with and without photos) so organizers know what to expect.
