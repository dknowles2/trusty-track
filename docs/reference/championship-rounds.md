# Championship rounds

The full rules for rounds whose racers are picked from results rather than
from the roster. For how to set one up, see
[Scoring & Championships](../scoring-and-championships.md#championship-options).

## Where the racers come from

A championship round names a source and a count:

### The fastest overall

The top cars in the whole pack's standings. The most common setup: one
final, three or four cars.

### The fastest from each den

The top cars from *every* den. The count is **per den** — "top 2" from six
dens is a twelve-car round. Good when dens race separately and the champions
have never met.

### The top finishers of another round

The top cars from one earlier championship or elimination round. This is how
rounds chain: top ten race a semifinal, the best three of *them* race the
final. In the Round Wizard, every championship round after the first draws
from the round before it automatically. The last cars standing from an
[elimination round](round-styles.md#elimination) can feed a final the same
way.

### The slowest cars

The same as the fastest overall, from the other end — the Slowest Race.

- A car that never recorded a time is left out. Not racing is not the same
  as being slow.
- The round's page on Standings lists the slowest car first, because the
  last one down the track is the winner. Nothing else about the standings
  changes.
- The pick count is free of the trophy minimum — a two-car turtle race is a
  fine turtle race.

## How the line-up fills in

- Until it fills in, an undecided lane reads differently depending on where
  you're looking: the schedule (Race Control → Schedule) shows
  **Placeholder 1**, **Placeholder 2** and so on; Race Control's heat view
  shows **Top 1**, **Top 2** (**Slowest 1**, **Slowest 2**… for
  [the Slowest Race](#the-slowest-cars)); and the printed
  [heat sheet](printing.md#the-heat-sheet) reads **To be decided** — it's the
  only one of the three meant to be written on.
- It fills itself the moment the racing that decides it is finished. There
  is no button.
- One created *after* its deciding racing already finished fills in
  immediately.
- If fewer cars qualify than the round asked for — "top four" from a den of
  three — the round is rebuilt for the cars that exist, rather than holding
  empty places forever.
- A round set up for more than one run per lane keeps that when its line-up
  refills: a two-run final stays a two-run final.

## When a time is corrected

Correcting (or clearing) any earlier result re-decides who advances.

- A championship round that has **not been raced** re-picks its cars
  automatically.
- One that **has been raced** is never quietly rewritten — its results are
  real. Instead the schedule shows a **Line-up out of date** badge: its cars
  were picked from standings that have since changed. Whether to re-run it
  or let the result stand is the operator's call.

## When a qualifier leaves

Un-check the racer at the check-in screen. If the championship round has not
been raced yet, the **next car in the standings steps up** and takes their
place. Their earlier results stay on the board — leaving does not rewrite
history. See
[Changes in the middle of a race](mid-race-changes.md#a-withdrawal).

## What championship results never do

A championship round's times **never feed back into the overall standings**.
Its cars were chosen from those standings, so feeding results back would be
circular — a final's time could change who was supposed to be in the final.
Each championship round has its own page in the Standings selector instead.

## The Championship Trophies number

**Championship Trophies** on the race settings decides how many cars the
wizard puts into the final — it is about the racing, not about how many
physical trophies you hand out. The trophies themselves live on the
[Awards](../awards.md) page.
