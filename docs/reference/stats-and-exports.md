# Stats and exports

What every number on the Stats page means, and the columns in each CSV
export. For the tour of the page, see the [Race Stats guide](../race-stats.md).

[Free race](../free-race.md) heats appear in none of this — practice and
exhibition runs are excluded from every number on the page and every export.

## The Stats page, number by number

### Overview cards

- **Scoring** — the race's scoring method.
- **Racers** — total registered racers.
- **Heats Completed** — heats run out of heats scheduled.

### Lane fairness

Real tracks have slightly faster and slower lanes. The chart shows each
lane's average against the overall average — blue bars above the line are
faster than average, gold below are slower — and the table gives each lane's
average time, heat count, and percentage difference.

A difference under 1% is completely normal. Bigger is worth noting for
track maintenance. The numbers mean most after a full
everyone-in-every-lane round, where every car has run every lane.

### Per-racer stats

| Column | What it means |
| --- | --- |
| **#** | Car number |
| **Heats** | Heats completed |
| **Min** | Their single fastest time |
| **Avg** | Average across the heats they ran. A car that never finished a heat counts 9.999 s for it. Note this table counts **every** heat, where the standings cover the qualifying rounds only |
| **Max** | Their single slowest time |
| **Std Dev** | How consistent their times were — low is consistent. "—" until a racer has two heats |

### Top moments

- **Fastest Heat** — the single quickest time of the event, and whose it
  was. When the track has [scale speed](race-settings.md#scale-speed)
  turned on, a "Top scale speed" line underneath converts that time into a
  rough real-world MPH.
- **Closest Race** — the heat with the smallest gap between first and last.

### Den comparison

Each den's average score as a bar in the den's colour, with racer count and
the den's best performer in the table.

### The track record

The fastest cars a track has ever seen — across **every race run on it**,
not just today's. The rules:

- One entry per car, at its single best run. The list is the five fastest
  cars, not the five fastest runs, or one good car would fill it.
- Only real results count: official heats with a recorded time. A
  [free race](../free-race.md) heat is an exhibition run, and a car that
  started but never finished has no time to enter.
- **A record is worked out fresh on every look, never stored** — the same
  rule as the standings. Correcting a time moves the record, and deleting a
  race removes the records it set, along with the results themselves.
- Each entry names the race that set it. Entries from today's event are
  marked, which is how the page can say a record was just broken.
- **Records from before Trusty Track can be entered by hand** — on the
  track's card in Settings, under **Track records from past years**. They
  compete exactly as typed: a 2019 record at 2.89 seconds heads the board
  until a recorded 2.88 beats it. Hand-entered records are the one kind
  that is stored rather than worked out, because there is nothing in the
  app to work them out from — and the only kind you can edit or remove.
- **Breaking the record is announced** on the
  [audience displays](displays.md) — a gold banner on the projector's
  results overlay and the timing view. It fires only for a run that beats
  the record **as it stood before today's race**: earlier races on the
  track, plus any hand-entered records. A first event with no history
  celebrates nothing (there is nothing to beat), equalling the record is
  not breaking it, and an exhibition run never fires it — a free race heat
  cannot hold a record, so it cannot break one.
- The record belongs to the track, so a race with no track has none — and
  times from the [fake timer](../fake-timer.md) are made up, so a track
  that ran on it holds made-up records. The practice race uses a track of
  its own, which keeps rehearsal times off your real track's list.

## The CSV exports

All three open in Excel, Google Sheets, or any spreadsheet.

### Heat results (Stats page)

One row per lane in every completed heat — the complete record of the event.

`Round, Heat #, Global Heat #, Lane, Car #, First Name, Last Name, Time (s), Place`

### Racer stats (Stats page)

One row per racer, with the same numbers as the per-racer table.

`Car #, First Name, Last Name, Den, Heats, Min (s), Avg (s), Max (s), Std Dev`

### Standings (Standings page)

**Export CSV** beside the round selector. The file holds whatever the page
is showing: exporting a championship round gives that round's results, not
the overall ones.

`Rank, Car #, First Name, Last Name, Den, Average Time (s) or Points, Heats`

The score column is named for the race's scoring method.
