# Race Stats Guide

The Stats page gives you a deeper look at race performance — beyond just the final standings. It shows per-racer statistics, lane fairness analysis, den comparisons, memorable moments from the event, and CSV exports for your records.

> [!NOTE]
> **Prerequisite:** At least one heat must be completed before the Stats page shows data. If no heats have been run yet, the page will display "No heat results recorded yet."

> [!NOTE]
> [Free race](free-race.md) heats never appear here. Practice and exhibition
> runs are excluded from every number on this page.

---

## Navigating to the Stats Page

Click the **Stats** tab in the race navigation bar at the top of any race page. The Stats page is read-only — it shows results that were recorded on the Race Control page.

![Stats Tab in Navigation](assets/screenshots/race-stats/01-stats-tab-nav.png)
_Click the Stats tab in the race navigation bar to open the Stats page._

---

## Overview Cards

At the top of the page, three summary cards give you a quick snapshot of the race:

- **Scoring** — the scoring method in use (e.g., "TIMED" for fastest average time).
- **Racers** — the total number of registered racers.
- **Heats Completed** — how many heats have been run out of the total scheduled (e.g., "12 / 16").

![Overview Cards](assets/screenshots/race-stats/02-overview-cards.png)
_The three overview cards at the top of the Stats page show scoring strategy, racer count, and heat completion progress._

---

## Lane Fairness

Pinewood Derby tracks sometimes have lanes that are slightly faster or slower due to small variations in the track surface or construction. The Lane Fairness section helps you see if any lane has a consistent advantage or disadvantage.

- The **bar chart** shows each lane's performance relative to the overall average. A bar above the centre line (blue) means that lane runs faster than average; a bar below it (gold) means slower than average.
- The **table** below shows each lane's average finish time, how many heats were run in that lane, and the percentage advantage or disadvantage.

A small difference (less than 1%) between lanes is completely normal. A larger difference may be worth noting for future track maintenance.

> [!TIP]
> This section is most meaningful after a full qualifying round, where every racer has run in every lane — which is exactly how Trusty Track's automatic scheduling works.

![Lane Fairness Section](assets/screenshots/race-stats/03-lane-fairness.png)
_The Lane Fairness section. Blue bars rise above the line for faster-than-average lanes; gold bars drop below it for slower ones._

---

## Per-Racer Stats

The Per-Racer Stats table shows detailed performance numbers for every racer. Every column except **Den** sorts: click its header to sort by it, and click again to reverse the order.

| Column | What It Means |
|--------|---------------|
| **#** | Car number |
| **Name** | Racer's full name |
| **Den** | The den they belong to |
| **Heats** | Number of heats completed |
| **Min** | Their single fastest heat time |
| **Avg** | Their average time across the heats they have run. A car that started but never finished counts as 9.999s, so one bad run does not wipe out a racer's average. In a timed race this is the same measure the standings use — but note this table counts every heat, where the standings cover the preliminary rounds only |
| **Max** | Their single slowest heat time |
| **Std Dev** | How consistent their times were — a low number means very consistent; a high number means variable results. Shown as "—" if fewer than 2 heats are recorded. |

![Per-Racer Stats Table](assets/screenshots/race-stats/04-per-racer-stats.png)
_The Per-Racer Stats table sorted by average time (the default). Click a sortable column header to re-sort._

---

## Top Moments

The Top Moments section highlights two memorable heats from the event:

- **Fastest Heat** — the single quickest recorded time of the entire event, with the racer's name and which heat it occurred in.
- **Closest Race** — the heat where the margin between the fastest and slowest finisher was smallest (the most exciting race of the day), with the time gap in seconds.

These cards appear automatically once enough heats have been completed.

![Top Moments Cards](assets/screenshots/race-stats/05-top-moments.png)
_The Top Moments section highlights the fastest heat of the day and the closest finish._

---

## Den Comparison

The Den Comparison section shows how each den performed as a group — useful for pack leadership who want to recognize standout dens at the awards ceremony.

- The **bar chart** plots each den's average score, with bars colored in the den's assigned color.
- The **table** shows each den's racer count, group average score, and the name of that den's best-performing racer.

![Den Comparison Section](assets/screenshots/race-stats/06-den-comparison.png)
_The Den Comparison section. Each bar is colored in the den's assigned color, making it easy to match the chart to the table below._

---

## Exporting Results

Two **Export** buttons at the bottom of the page let you download race data as CSV files that can be opened in Excel, Google Sheets, or any spreadsheet application.

### Export Heat Results

Downloads one row for every lane in every completed heat. Columns:

`Round, Heat #, Global Heat #, Lane, Car #, First Name, Last Name, Time (s), Place`

Use this for a complete record of the event — every race, every car, every finishing time.

### Export Racer Stats

Downloads one row per racer with their aggregated statistics. Columns:

`Car #, First Name, Last Name, Den, Heats, Min (s), Avg (s), Max (s), Std Dev`

Use this for awards, records, or sharing results with the pack after the event.

![Export Buttons](assets/screenshots/race-stats/07-export-buttons.png)
_The Export section at the bottom of the page. Both buttons download CSV files that open in any spreadsheet application._

---

## Live Updates During the Race

The Stats page updates automatically while the race is in progress. As each heat is completed in Race Control, the charts and tables refresh within a few seconds — no manual refresh needed.

This means you can keep the Stats page open on a separate screen during the race and use it as a running analysis view for pack leadership, while the race operator uses the Race Control page to run heats.

The **Heats Completed** card at the top shows the current progress, so you always know how much of the race remains.

![Stats During Live Race](assets/screenshots/race-stats/08-stats-live-partial.png)
_The Stats page during an in-progress race, with the Heats Completed card showing partial completion. The page refreshes automatically as heats finish._
