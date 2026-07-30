# Race Day Operations Guide

This guide covers the full race day workflow: checking in racers, scheduling heats, running the race, and viewing final standings.

> [!NOTE]
> **Prerequisite:** Your roster should already be set up before race day. See the [Race Setup Guide](race-setup.md) if you still need to add racers or configure dens.

---

## Race Day Overview

On race day, two operators typically work side by side:

| Role | Primary Page | What They Do |
|------|-------------|--------------|
| **Check-In Operator** | Race Details | Verifies cars passed inspection, records car weight, adds photos |
| **Race Control Operator** | Race Control | Schedules heats, starts heats, records results |
| **Audience / Spectators** | Observation | View live standings and currently-racing heats |

The check-in and race control functions can be handled by the same person for smaller events, or split across two devices for larger packs.

---

## Part 1: Check-In

### Opening the Check-In View

Check-in happens on the **Race Details** page — the same page used to manage the roster before the event. On race day, you work through the racer list and mark each car as inspected before it races.

![Race Details with Check-In Status](assets/screenshots/race-day/01-check-in-status.png)
_The Race Details page on race day — some racers are checked in (green), others are pending (yellow). The inspection status column shows progress at a glance._

---

### Checking In a Racer

1. Find the racer in the list. You can scroll through the list or use the search/filter controls.
2. Click the racer's row to open the **Check-In** modal.
3. Toggle **Car Passed Inspection** to mark the car as cleared to race.
4. Optionally enter or update the **Car Name** if not already provided.
5. Optionally enter the car's **weight** (in ounces) for documentation purposes.
6. Optionally upload or capture a **Racer Photo** and/or **Car Photo** using the camera or file picker.
7. Click **Save**.

![Check-In Modal — Inspection Toggled On](assets/screenshots/race-day/02-check-in-modal-inspected.png)
_The check-in modal for a racer, with "Car Passed Inspection" toggled ON._

![Check-In Modal — With Photo](assets/screenshots/race-day/03-check-in-modal-with-photo.png)
_A racer photo loaded in the check-in modal. Photos appear on the live audience display during the race._

![Racer List After Check-In](assets/screenshots/race-day/04-racer-list-after-check-in.png)
_After saving, the racer's status updates to "Inspected" (green) in the list._

---

### Tracking Check-In Progress

The racer list shows inspection status for every racer. Use the sort controls to group racers by status — this makes it easy to see who still needs to be checked in.

![Racer List Filtered by Inspection Status](assets/screenshots/race-day/05-check-in-progress.png)
_Sort by inspection status to bring unchecked racers to the top. Here you can see a mix of inspected (green) and pending (yellow) rows._

---

### Uploading Photos in Bulk

If a photographer takes portraits or car photos before the race, you can upload and assign all of them at once using the **Upload Photos** button — without opening each racer's check-in form individually.

**When to use this:** After a pre-race photo session where you have a folder of racer or car images to associate with the correct racers.

![Upload Photos button in the toolbar](assets/screenshots/race-day/19-upload-photos-button.png)
_The **Upload Photos** button sits in the toolbar above the racer list, between Bulk Actions and Add Racer._

1. Click **Upload Photos** in the toolbar above the racer list.
2. The **Upload & Assign Photos** modal opens. Click **Choose Photos** and select one or more image files from your device.

![Empty upload modal](assets/screenshots/race-day/20-bulk-upload-modal-empty.png)
_The modal before any photos are selected. Click "Choose Photos" to pick files from your device._

3. Each image uploads immediately and appears as a thumbnail card. The footer shows how many photos have been assigned so far.

![Photos loaded in the modal](assets/screenshots/race-day/21-bulk-upload-photos-loaded.png)
_Three photos loaded and ready to assign. Each card shows the filename, an assignment search box, and a Racer/Car photo toggle. The footer tracks progress ("0 of 3 uploaded photo(s) assigned")._

4. Click the search box on a card and start typing a racer's name or car number. A filtered list appears as you type.

![Combobox open showing full racer list](assets/screenshots/race-day/22-bulk-upload-combobox-open.png)
_Clicking the search box shows all racers sorted by car number. Scroll or start typing to narrow the list._

![Combobox filtered to a single racer](assets/screenshots/race-day/23-bulk-upload-combobox-filtered.png)
_Typing "jax" immediately filters to matching racers. Press Enter or click the name to assign._

5. Use the **Racer photo** / **Car photo** radio buttons on each card to indicate what the image shows (default is Racer photo).
6. After assigning all photos, click **Apply N Assignment(s)** to save.

![Modal with assignments made and Apply button active](assets/screenshots/race-day/24-bulk-upload-assigned.png)
_With one photo assigned, the Apply button becomes active and shows the count. The footer updates to "1 of 3 uploaded photo(s) assigned." Continue assigning the remaining cards before clicking Apply._

Photos that are uploaded but not assigned to any racer are silently skipped — only photos with a racer selected are saved. Assignments can be applied at any time during or after check-in; the photos will be visible on the audience display during the race.

> [!TIP]
> If an upload fails (for example, due to a slow network), a **Retry** link appears on that card. Other cards are not affected — you can assign and apply the successful uploads while retrying the failed ones.

> [!NOTE]
> Photos can also be added individually through each racer's check-in form (see [Checking In a Racer](#checking-in-a-racer) above). The bulk upload tool is most useful when photos were taken as a batch outside the app and you want to assign them all at once.

---

## Part 2: Scheduling the Race

### Navigating to Race Control

Once check-in is underway, the race control operator can move to the **Race Control** page to build the heat schedule. Click the **Control** link in the top navigation bar.

![Race Control — Empty State](assets/screenshots/race-day/06-race-control-empty.png)
_The Race Control page before any rounds have been added. Click "Start Round Creation Wizard" to begin._

---

### Understanding Rounds and Heats

Before building the schedule, it helps to know two terms:

- **Heat** — A single race run with N cars (one per lane). Each heat takes about 10–30 seconds on the track.
- **Round** — A complete set of heats where every racer competes. Trusty Track automatically generates the minimum number of heats needed so that every racer races in every lane exactly once.

A typical Pinewood Derby has one **qualifying round** (all racers) followed by one optional **championship round** (top finishers only).

---

### Creating a Round with the Round Wizard

The **Round Wizard** is the fastest way to set up your complete race schedule, including optional championship rounds. Click **Start Round Creation Wizard** to open it.

#### Step 1: General Rounds

Choose the format for your qualifying round:

- **All Pack** — Every racer races against everyone else. Best for events where den membership isn't important for heat grouping.
- **By Den** — Racers race only against others in their own den during the qualifying round.

Set **Runs Per Lane** (default: 1). Increasing this number means each racer runs in every lane more than once, which produces fairer averages but takes more time.

![Round Wizard — Step 1](assets/screenshots/race-day/07-round-wizard-step1.png)
_Step 1: choose the qualifying round type. "All Pack" is the most common choice._

#### Step 2: Championship Rounds (Optional)

Add one or more championship rounds. For each championship round, configure:

- **Round Name** (e.g., "Grand Finals")
- **Advancement Source**: Top N racers **overall** (Pack), or Top N racers from **each den**
- **Number of Finalists** (e.g., top 3 overall, or top 2 per den)
- **Runs Per Lane** for this round

Click **+ Add Round** to add more championship rounds if needed.

![Round Wizard — Step 2](assets/screenshots/race-day/08-round-wizard-step2.png)
_Step 2: configure optional championship rounds. Each round can advance a different number of racers._

#### Step 3: Review and Generate

The wizard shows an estimate of total heats and approximate run time. Review the schedule summary, then click **Generate Schedule** to create all rounds and heats at once.

![Round Wizard — Step 3 Review](assets/screenshots/race-day/09-round-wizard-step3.png)
_Step 3: the schedule preview shows total heats and estimated duration before you commit._

---

### Viewing the Schedule

After generating, the **Schedule** tab shows all rounds as columns, with each heat listed as a card. Each heat card shows the racer assigned to each lane.

![Schedule Management View](assets/screenshots/race-day/10-schedule-management.png)
_The full schedule after generation — rounds appear as columns, and each heat card shows lane assignments and completion status (green = done, gray = pending)._

---

### Reordering Heats (Optional)

If you need to adjust the heat order before racing begins (for example, to separate siblings or accommodate a late arrival), drag heat cards by the handle on the left side of each card to reorder them within a round.

> [!NOTE]
> Heat reordering is only available for heats that have not yet been run.

![Heat Reordering](assets/screenshots/race-day/11-heat-reordering.png)
_Drag the handle icon on the left side of a heat card to reorder it within the round._

> [!TIP]
> **Jumping Ahead:** If you want to run a future heat immediately, you can simply click the **Run** button on that heat in the Schedule view. Trusty Track will automatically move it to be the next heat in the order and take you directly to the **Race** tab.

---

## Part 3: Running the Race

### The Race Execution View

Switch to the **Race** tab in Race Control to enter the race execution view. This is where heats are started and results are recorded.

The view is split into two columns:

- **Left (main area)**: The current heat — racer names, lane assignments, and results.
- **Right (sidebar)**: The next 4 upcoming heats, so you can prepare cars in advance.

![Race Execution View](assets/screenshots/race-day/12-race-execution-current-heat.png)
_The Race Execution view showing the active heat with lane assignments. The upcoming heats sidebar helps the operator prepare the next cars._

---

### Starting a Heat

How a heat starts depends on your track timer:

- **With a hardware timer**: Trusty Track automatically prepares the timer for the next heat. Place the cars on the track and release them as normal — the timer records finish times automatically.
- **With the fake timer** (for testing without a physical track): A **Fake Timer Controls** panel appears in the bottom-right corner. Click **Start Timer** when cars are "on the track," then **Finish Heat** to simulate the race completing.

![Fake Timer Controls](assets/screenshots/race-day/13-fake-timer-controls.png)
_The Fake Timer Controls panel used for testing. "Start Timer" arms the race, "Finish Heat" records simulated results._

---

### Recording Results

When a heat finishes:

- **Hardware timer**: Results appear automatically in the lane cards, showing each racer's finish time and placement.
- **Fake timer**: Click **Finish Heat** — the system generates simulated finish times.
- **Manual override**: Click **Override** (before the heat) or **Edit** (after) to enter times by hand.

![Heat Results After Finish](assets/screenshots/race-day/14-heat-results.png)
_After a heat completes, each lane shows the racer's finish time and placement (1st, 2nd, 3rd, etc.). The 1st-place racer is highlighted in gold._

After reviewing results, click **Next Heat** to advance to the next heat — or enable **Auto-advance** to move forward automatically after 10 seconds.

> [!TIP]
> The **Auto-advance** toggle is in the lower section of the active heat card. When on, the display counts down and advances without any button click.

---

### Correcting a Result

If a timer result is wrong (for example, a photo-finish dispute or a false start):

1. Click **Edit** on the completed heat card.
2. Update the time for each lane as needed.
3. Click **Save Results**.

To completely re-run a heat, click **Re-Run** — this clears the results and returns the heat to "pending" so it can race again.

---

### Viewing the Live Leaderboard

The leaderboard updates automatically after every heat. During the race, you can check current standings at any time from the Race Control page. The audience can follow standings live on the Observation page (see the [Observation Displays Guide](observation-displays.md)).

![In-Progress Leaderboard](assets/screenshots/race-day/15-live-leaderboard.png)
_The live leaderboard updates after every heat, showing current average times and placements for all racers._

---

## Part 4: Championship Rounds (Optional)

After all qualifying heats are complete, Trusty Track will show a round-completion summary with the current standings. If you configured a championship round, click **Start Next Round** to advance.

The championship round schedule is generated automatically based on who qualified — only the top racers from the qualifying round are included.

![Round Completion — Advancement Summary](assets/screenshots/race-day/16-round-completion-modal.png)
_When a round finishes, the standings summary shows who advances to the championship. Advancing racers are highlighted._

Run the championship heats the same way as the qualifying round. Championship results determine final placement.

![Championship Round Schedule](assets/screenshots/race-day/17-championship-schedule.png)
_The championship round schedule includes only the top qualifiers. Their lane assignments are auto-generated for fairness._

---

## Part 5: Final Standings

After all heats are complete, the **Standings** page shows the final ranked results. Navigate there from the top nav bar.

The Standings page is designed for the award ceremony — it can be displayed on a large screen or projector so everyone can see the final results.

![Final Standings Page](assets/screenshots/race-day/18-final-standings.png)
_The final standings show placement, racer name, den, and average time for every racer. Den colors help organize the results._

---

## Common Race Day Scenarios

### A racer arrived late and wasn't checked in

You can add them to the roster and check them in at any time. The **next round** you create will include all currently checked-in racers — so if you add a late arrival before creating a new round, they'll be included automatically.

### A racer had to withdraw

Open their check-in entry and uncheck **Car Passed Inspection** to mark them as not participating. Heats they already appeared in will retain their recorded times — only future rounds will exclude them.

### A timer result came in wrong

Click **Edit** on the completed heat in the Race Execution view to manually correct any time value. If the entire heat needs to be re-run, click **Re-Run** to clear all results and race it again.

### We need to run a practice heat that doesn't count

Use **Free Race**. A free race heat runs on the timer and appears on the audience display like any other, but it is invisible to standings, scheduling, advancement and statistics — so it cannot disturb the event.

It is the right tool for a shake-down run before doors open, a parent's or sibling's car, a demonstration for a scout who wants to see the track work, and the fun heats at the end.

From **Race Control**, switch to the Free Race view and choose who is in each lane. **Random** fills the lanes from the checked-in roster, which is usually what you want for an impromptu run; you can also pick racers by hand, and lanes may be left empty. Run it exactly as you would an official heat.

Free race results are kept and listed newest first, so you can look back at what a car did in practice. Delete a heat when you no longer want it in the list. Nothing you do here changes anyone's standing.
