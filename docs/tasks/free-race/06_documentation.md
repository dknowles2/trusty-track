# Task 6: Documentation — Free Race Mode [COMPLETED]

> Written as `docs/free-race.md`, with screenshots under
> `docs/assets/screenshots/free-race/` rather than `docs/img/`, matching where
> every other guide keeps them.
>
> **The screenshots are captured by a Playwright spec**
> (`frontend/e2e/docs/screenshot-free-race.spec.ts`), not taken by hand as the
> steps below describe. It builds its own race and its own fake-timer track, so
> a re-run reproduces the same sheet rather than whatever happened to be in the
> database — which is what makes a regenerated screenshot a real diff.
>
> The draft prose below was written from the plan rather than the screen and
> got two things wrong: the button after a heat is **Next Heat**, not "Run
> Another Free Race Heat", and there is **no free-race history list** — the
> `freeRaceHeats` query exists but nothing renders it. `docs/race-day.md` had
> repeated that second claim and has been corrected.

## Goal

Write end-user documentation for the Free Race feature in `docs/free-race.md`, following the same style as existing docs (e.g., `docs/fake-timer.md`). The doc must include real screenshots of the running application.

## Output Files

| File                                       | Purpose                                         |
| ------------------------------------------ | ----------------------------------------------- |
| `docs/free-race.md`                        | User-facing documentation                       |
| `docs/img/free_race_lane_setup_random.png` | Screenshot: random lane assignment UI           |
| `docs/img/free_race_lane_setup_manual.png` | Screenshot: manual lane picker UI               |
| `docs/img/free_race_execution.png`         | Screenshot: heat in progress / results          |
| `docs/img/free_race_tab.png`               | Screenshot: the "Free Race" tab in Race Control |

---

## Steps

### 1. Ensure the Application Is Running

Start the backend and frontend dev servers if they are not already running:

```bash
# Terminal 1 — backend
cd /home/dknowles/src/trusty-track
.venv/bin/uvicorn backend.api.main:app --reload --port 8000

# Terminal 2 — frontend
cd /home/dknowles/src/trusty-track/frontend
npm run dev
```

Verify the app is accessible at `http://localhost:5173`.

### 2. Prepare a Race with Checked-In Racers

The screenshots need real data. Use the **Populate Test Data** feature (available on the Race Details page) to add racers and check them in, or use an existing race that already has checked-in racers.

Confirm at least 4 racers are checked in (i.e., `car_passed_inspection = true`) before taking screenshots.

### 3. Take Screenshots

Navigate to **Race Control** for a race that has checked-in racers. Use the browser's built-in screenshot tool or a system screenshot utility (e.g., `gnome-screenshot`, `scrot`, or the browser DevTools "Capture screenshot" option) to take each screenshot. Crop to show only the relevant UI area.

#### Screenshot 1 — Free Race Tab

- Click the **"Free Race"** tab in Race Control.
- Take a screenshot of the full Race Control page showing the tab bar with "Free Race" selected.
- Save as `docs/img/free_race_tab.png`.

#### Screenshot 2 — Random Lane Setup

- In the Free Race tab, ensure **Random** mode is selected (default).
- The lane assignments should be populated with randomly chosen racers.
- Take a screenshot of the lane setup panel.
- Save as `docs/img/free_race_lane_setup_random.png`.

#### Screenshot 3 — Manual Lane Setup

- Switch to **Manual** mode.
- Assign a racer to at least two lanes using the dropdowns.
- Take a screenshot of the lane setup panel showing the dropdowns.
- Save as `docs/img/free_race_lane_setup_manual.png`.

#### Screenshot 4 — Heat Execution / Results

- Click **"Start Free Race Heat"** (in either mode).
- If using the Fake Timer: click **Start Timer**, then **Finish Heat** to generate results.
- Take a screenshot of the results view showing times and places.
- Save as `docs/img/free_race_execution.png`.

### 4. Write `docs/free-race.md`

Use the following structure and embed the screenshots taken above:

```markdown
# Free Race Mode

Free Race is an informal, non-competitive race mode available in **Race Control**.
Results from Free Race heats are **never** included in official standings or the
leaderboard — they are purely for practice, exhibition, or testing.

## Opening Free Race

Navigate to **Race Control** for your race and click the **Free Race** tab.

![Free Race tab in Race Control](img/free_race_tab.png)

## Setting Up Lanes

### Random Assignment

By default, Free Race uses **Random** mode. The system automatically selects
checked-in racers and assigns them to lanes. Click **Re-shuffle** to generate a
new random assignment.

![Random lane assignment](img/free_race_lane_setup_random.png)

### Manual Assignment

Switch to **Manual** mode to choose a specific racer for each lane. Use the
dropdown for each lane to select a racer, or leave a lane empty.

![Manual lane assignment](img/free_race_lane_setup_manual.png)

## Running the Heat

Click **Start Free Race Heat** when the lanes are configured. The heat runs
exactly like a normal heat — use the Fake Timer controls (if configured) or
wait for the physical timer to fire.

Results are displayed immediately after the heat completes. You can manually
edit times using the **Edit** button if needed.

![Free race heat results](img/free_race_execution.png)

## Running Another Heat

After results are displayed, click **Run Another Free Race Heat** to return to
the lane setup screen and configure a new heat.

## Tips

- Free Race works with both the Fake Timer and real hardware timers.
- Only checked-in racers (car passed inspection) appear in the racer lists.
- Free Race results are stored separately and can be reviewed in the backend,
  but they do not appear on the Leaderboard or Standings pages.
```

### 5. Review the Documentation

- Read through the rendered markdown to ensure all image links resolve correctly.
- Verify the screenshots are clear and show the correct UI state.
- Check that the prose is accurate against the implemented feature.

---

## Verification

```bash
# Confirm all image files exist
ls docs/img/free_race_*.png

# Confirm the doc file exists and is non-empty
wc -l docs/free-race.md
```

Optionally render the markdown locally (e.g., with `grip` or VS Code preview) to verify image embedding before committing.
