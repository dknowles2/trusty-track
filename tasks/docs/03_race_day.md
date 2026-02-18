# Documentation Task: Race Day Operations Guide

## Document Details

| Field | Value |
|-------|-------|
| **Output file** | `docs/user/race-day.md` |
| **Audience** | Check-in operators and race control operators on race day |
| **Goal** | Cover the full race day workflow: checking in racers, scheduling heats, running the race, and viewing final standings |
| **Prerequisite** | The roster has been prepared (see [Race Setup Guide](race-setup.md)) |

---

## Outline

### 1. Race Day Overview

Brief intro: what happens on race day, who does what, and which parts of the application each role uses.

| Role | Primary Page | What They Do |
|------|-------------|--------------|
| Check-In Operator | Race Details | Verify cars passed inspection, add photos |
| Race Control Operator | Race Control | Schedule heats, start heats, record results |
| Audience / Spectators | Observation | View live standings and currently-racing heats |

---

### 2. Part 1: Check-In

#### 2.1 Opening the Check-In View

Explain that check-in happens on the **Race Details** page — the same page used to manage the roster. On race day, the operator works through the racer list and marks each car as inspected.

**Screenshot required:** The Race Details page on race day — some racers inspected (green/checked), some not yet (yellow/pending). Annotate the inspection status column.

#### 2.2 Checking In a Racer

Walk through the check-in modal step by step:

1. Find the racer in the list (or search by name or car number).
2. Click the racer's row to open the check-in modal.
3. Toggle **Car Passed Inspection** to mark the car as cleared to race.
4. Optionally enter the **Car Name** if not already provided.
5. Optionally enter the car's **weight** (for documentation).
6. Optionally upload or capture a **Racer Photo** and/or **Car Photo**.
7. Click Save.

**Screenshot required:** The check-in modal open for a racer, with "Car Passed Inspection" toggled ON. Show the photo upload area.

**Screenshot required:** The check-in modal with a racer photo loaded (either uploaded or captured from camera).

**Screenshot required:** The racer list after check-in — the racer's status is now "Inspected" / green.

#### 2.3 Tracking Check-In Progress

Explain how to use the list to track overall check-in status — e.g., sort or filter by inspection status to see who hasn't been checked in yet.

**Screenshot required:** The racer list filtered or sorted to show "Not Inspected" racers at the top, with a mix of inspected and pending rows visible.

---

### 3. Part 2: Scheduling the Race

#### 3.1 Navigating to Race Control

Explain how to get to the Race Control page (navigation link or button from the Race Details page).

**Screenshot required:** The Race Control page in its initial state — no rounds scheduled yet. Show the "Create Round" button or equivalent.

#### 3.2 Creating a Round with the Round Wizard

Walk through the Round Wizard:

1. Choose which racers to include (all checked-in racers, a specific den, etc.).
2. Optionally configure championship / advancement settings.
3. Preview the generated heat schedule.
4. Confirm and start.

Explain the concept of a "round" (a full pass through the schedule where every racer competes) vs. a "heat" (a single race with N cars on the track).

**Screenshot required:** The Round Wizard step 1 — selecting which group of racers to include.

**Screenshot required:** The Round Wizard schedule preview — a list of heats with racer names and lane assignments visible.

**Screenshot required:** The Schedule Management view after confirming — showing the full list of pending heats.

#### 3.3 Reordering Heats (Optional)

Briefly explain that the operator can reorder heats before racing begins if needed.

**Screenshot required:** The heat list with drag handles or reorder controls visible (if implemented in the UI).

---

### 4. Part 3: Running the Race

#### 4.1 Starting a Heat

Explain the Race Execution view:

- The current heat is displayed with racer names and lane assignments.
- The operator places the cars on the track and signals "go."
- The timer records finish times automatically (or the operator enters them manually with the fake timer).

**Screenshot required:** The Race Execution view showing the current heat — racer names, lane numbers, and a "Start Heat" or "Record Results" button visible.

#### 4.2 Recording Results

Explain how results flow in:

- With a real timer: results appear automatically after the heat finishes.
- With the fake timer: the operator clicks to simulate finish times.

Show how results are confirmed and how the next heat loads automatically.

**Screenshot required:** The Race Execution view after a heat has finished — showing finish times for each lane, ordered by finish position.

**Screenshot required:** The fake timer UI (the small overlay / "mole" control) for test environments.

#### 4.3 Viewing the Live Leaderboard

Explain that the leaderboard updates after every heat. The operator can check current standings from the Race Control page.

**Screenshot required:** An in-progress leaderboard with 6–8 racers showing average times and placement.

---

### 5. Part 4: Championship Rounds (Optional)

Explain how championship / advancement rounds work:

- After all preliminary heats are complete, the operator can create a Championship round.
- The system automatically identifies the top N racers (based on standings) and schedules a final run.
- Results from the championship round determine final placement.

**Screenshot required:** The Round Wizard in championship mode — showing that only the top racers have been selected.

**Screenshot required:** The final standings after the championship round completes.

---

### 6. Part 5: Final Standings

Explain the Standings page:

- Shows the final ranked results for each den and overall.
- Can be displayed on a large screen for the award ceremony.

**Screenshot required:** The Standings page showing final results — sorted by placement, with den colors and racer names visible.

---

### 7. Common Race Day Scenarios

Short FAQ / troubleshooting section for common issues:

- **A racer arrived late and wasn't checked in.** → You can add them to the roster and check them in at any time; the next round will include them.
- **A racer had to withdraw.** → Mark them as not checked in, or remove them from the race. Existing heats they appeared in will still show their times.
- **A timer result came in wrong.** → Explain whether/how results can be manually corrected.
- **We need to run a practice heat that doesn't count.** → Use Free Race mode (see note below).

> **Note:** Free Race mode (for practice and exhibition heats) is a planned feature coming soon. It will allow running unofficial heats that don't affect standings.

---

## Notes for the Writer

- This guide covers two different operator roles; consider splitting "Check-In" and "Race Control" into separate top-level sections or even separate documents if the content grows long.
- The fake timer screenshots are important for users who are testing without a physical track — don't skip them.
- Avoid describing HTTP requests, API calls, or any backend behavior.
- Emphasize that the leaderboard and standings update automatically — no manual tallying needed.
