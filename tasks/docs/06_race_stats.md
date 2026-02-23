# Documentation Task: Race Stats Guide

## Document Details

| Field | Value |
|-------|-------|
| **Output file** | `docs/user/race-stats.md` |
| **Audience** | Race organizers and pack leaders reviewing results after (or during) a race |
| **Goal** | Explain what the Stats page shows, how to read each section, and how to export data |
| **Prerequisite** | A race with at least one completed round of heats |

---

## Outline

### 1. What Is the Stats Page?

Briefly introduce the Stats page as a post-race (and live-updating) analysis view that goes deeper than the standings leaderboard. It shows how individual racers performed across heats, whether any lanes are faster than others, den-level comparisons, and memorable moments from the event.

Explain how to navigate to it: click the **Stats** tab in the race navigation bar (or open `http://<server>/race/<id>/stats`).

**Screenshot required:** The Stats page with all sections visible, using realistic race data — at least 8 racers across 2–3 dens, with all heats completed. Show the Stats tab highlighted in the nav bar.

---

### 2. Overview Cards

Describe the summary cards at the top of the page:

- **Scoring** — the scoring strategy in use (`TIMED` or `POINTS`).
- **Racers** — total number of registered racers.
- **Heats Completed** — heats finished out of total scheduled (e.g., "12 / 16").

**Screenshot required:** Close-up of the three overview cards with realistic values.

---

### 3. Lane Fairness

Explain that Pinewood Derby tracks sometimes have lanes that are slightly faster or slower due to small variations in the track surface, incline, or construction. The Lane Fairness section helps you see if any lane has a consistent advantage or disadvantage.

- The **bar chart** shows each lane's relative advantage compared to the overall average. Bars pointing up (blue) indicate lanes that run faster than average; bars pointing down (gold) indicate slower-than-average lanes.
- The **table** below the chart shows the average finishing time, number of heats run, and the percentage advantage or disadvantage for each lane.

Note: This section is most meaningful after a full round of racing where every racer has run in every lane (which is how the Perfect-N scheduling algorithm works).

**Screenshot required:** The Lane Fairness section with the bar chart showing varied lane advantages, and the table below it with all four lanes populated.

---

### 4. Per-Racer Stats

Describe the sortable table that shows each racer's performance statistics:

| Column | What It Means |
|--------|---------------|
| **#** | Car number |
| **Name** | Racer's full name |
| **Den** | The den they belong to |
| **Heats** | Number of heats completed |
| **Min** | Their fastest single heat time |
| **Avg** | Their average time across all heats (the score used for standings) |
| **Max** | Their slowest single heat time |
| **Std Dev** | How consistent they were — a low number means very consistent lap times; a high number means variable performance. Shown as `—` if fewer than 2 heats completed. |

Explain that clicking any column header sorts the table by that column, and clicking again reverses the sort order.

**Screenshot required:** The Per-Racer Stats table sorted by Avg (default), showing at least 8 racers with all columns populated. Annotate the sort arrow on the Avg column header.

---

### 5. Top Moments

Describe the two highlight cards the page surfaces automatically:

- **Fastest Heat** — the single quickest time recorded across the entire event, along with the racer's name and which round and heat it occurred in.
- **Closest Race** — the heat where the gap between the fastest and slowest finisher was smallest (the most exciting race of the day), showing the margin in seconds.

These cards appear only once enough heats have been completed.

**Screenshot required:** Both highlight cards side by side, with realistic values (e.g., fastest heat at ~2.9s, closest race margin of ~0.05s).

---

### 6. Den Comparison

Explain that this section shows how each den performed as a group.

- The **horizontal bar chart** plots each den's average score, with bars colored in each den's assigned color.
- The **table** lists each den with its racer count, group average score, and the name of that den's best-performing racer.

This is useful for pack leadership who want to recognize which den had the strongest overall showing.

**Screenshot required:** The Den Comparison section with at least 3 dens, each bar a different color matching the den color badges. The table should show the best racer name column populated.

---

### 7. Exporting Results

Two export buttons at the bottom of the page let you download race data as CSV files that can be opened in Excel, Google Sheets, or any spreadsheet application.

#### Export Heat Results

Downloads a row for every lane in every completed heat. Columns:

`Round, Heat #, Lane, Car #, First Name, Last Name, Time (s), Place`

Use this for a complete record of the event — every race, every car, every finishing time.

#### Export Racer Stats

Downloads one row per racer with their aggregated statistics. Columns:

`Car #, First Name, Last Name, Den, Heats, Min (s), Avg (s), Max (s), Std Dev`

Use this for awards, records, or sharing results with the pack after the event.

**Screenshot required:** The Export section showing both buttons, and a second screenshot of the downloaded CSV opened in a spreadsheet application showing the column headers and sample data.

---

### 8. Live Updates

The Stats page updates automatically while the race is in progress. As each heat is completed in Race Control, the charts and tables on the Stats page refresh within a few seconds — no manual refresh needed.

This means the Stats page can be kept open on a separate screen during the race and used as a running analysis view for pack leadership, while race operators use the Race Control page to run heats.

**Screenshot required:** The Stats page in a partially-completed state (e.g., 8 of 16 heats done), showing the "Heats Completed" card with a partial count. Add a note overlay indicating "page updates automatically."

---

## Notes for the Writer

- Emphasize that the Stats page is **read-only** — it is for viewing results, not editing them. Heat results are entered via the Race Control page.
- The Std Dev column may be unfamiliar to non-technical readers. Keep the explanation simple: low = consistent, high = variable.
- For the Lane Fairness section: if there is no meaningful bias in the data, bars will all be near zero and roughly the same height. Reassure readers that a small difference (< 1%) is normal and not a concern.
- Do not mention GraphQL, recharts, subscriptions, or any implementation details.
- The page shows a "No heat results recorded yet" message if no heats have been completed — mention this briefly so organizers know what to expect before the race starts.
