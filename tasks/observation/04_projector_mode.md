# Task: Projector Mode (High-Contrast Observation Display)

## Goal

Add a "Projector Mode" to the observation views designed for large-format displays, kiosks, and projectors. This mode should be high-contrast, fullscreen-ready, and free of navigation chrome.

## Background

SPEC.md specifies:

> **Design Elements:** Rounded corners (12px) and high-contrast "Projector Mode" race observation views.

DESIGN.md states:

> **Observation Interfaces (Kiosks/Large Displays):** Minimalist, high-contrast "Projector Mode" designs.

The current `Observation.tsx` is designed for a regular browser window and includes standard navigation. A projector/kiosk mode would be optimized for full-screen display with large text and no navigation chrome.

## Steps

1. **Add `?projector=true` URL Parameter**
   - When the `projector` query parameter is present, `Observation.tsx` enters Projector Mode.
   - Example URL: `/observation/1?view=leaderboard&projector=true`
   - This allows operators to open a dedicated browser window for the display/projector without modifying the main operator interface.

2. **Projector Mode Visual Design**
   - Hide all navigation elements (top nav, tabs, etc.) — just the content.
   - Use a dark background (near-black: `#0A0A0A` or `#111`) with high-contrast text.
   - Use very large font sizes: racer names at 2.5-3rem, times at 3-4rem, header at 4-5rem.
   - Use the BSA Gold (`#FCD116`) for accent highlights, top-3 highlights, and the current heat indicator.
   - Auto-cycle between views (leaderboard → currently racing → on deck → timing stats) on a configurable interval, or display a single fixed view based on the `view` URL parameter.

3. **Auto-View Cycling (Optional)**
   - Add a `?cycle=true` URL parameter that causes the view to automatically rotate between observation views every 10 seconds (or configurable via `?cycle_interval=15`).

4. **Fullscreen Button**
   - In non-projector mode, add a "Projector Mode" button to `Observation.tsx` that:
     - Opens a new browser window/tab with `?projector=true`.
     - Or triggers the browser's Fullscreen API on the current window.

5. **Custom Projector CSS**
   - Add a `projector-mode` CSS class that overrides the standard layout.
   - All observation sub-components (`Leaderboard`, `TimingStats`, etc.) should respond to this class with appropriate large-screen styling.

## Verification

- Open `Observation.tsx` with `?projector=true` and verify the navigation is hidden.
- Verify text is large and readable from across a room.
- Verify high-contrast dark theme is applied.
- Verify the "Projector Mode" button in the standard view opens a new window in projector mode.
