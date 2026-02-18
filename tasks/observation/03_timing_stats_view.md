# Task: Timing Stats Observation View

## Goal

Add a dedicated "Timing Stats" view to `Observation.tsx` showing the exact per-lane timing results from the last completed heat, with basic racer details.

## Background

SPEC.md describes:

> **Timing Stats** - The exact timing of the last / current heat. Basic details about the racers or their cars.

This view is intended for display on a screen near the track so spectators and participants can see the finish times and lane placements immediately after a heat.

## Steps

1. **Define Data Shape**
   - The timing stats view needs the following data for the most recently completed heat:
     - Heat number and round name
     - For each lane: lane number, racer name, car name, finish time, place
   - This data is already available via the `timing_stats` WebSocket channel (see `01_websocket_backend.md`) or can be derived from the current heat's `lane_results`.

2. **Add Timing Stats Tab/View to `Observation.tsx`**
   - Add a "Timing Stats" tab or view to the observation page navigation.
   - The view should display a large, easy-to-read table with:
     - Place (1st, 2nd, 3rd, etc.)
     - Lane number
     - Racer name (large text)
     - Car name (if available)
     - Finish time in seconds (e.g., `2.341s`) — monospace font for alignment
   - Sort by finish place (fastest first).
   - Show the heat identifier (e.g., "Round 1 / Heat 3").

3. **Animate on New Results**
   - When new timing data arrives (via WebSocket), animate the rows appearing (e.g., reveal top-to-bottom in place order).
   - Highlight the winner row with gold accent color.

4. **Fallback Display**
   - If no heat has been completed yet, show "Waiting for results..." centered on screen.

## Verification

- Record a heat result and verify the Timing Stats view updates immediately.
- Verify the display is readable from a distance (use large font sizes: 2rem+ for times).
- Verify the view handles heats with empty lanes gracefully.
