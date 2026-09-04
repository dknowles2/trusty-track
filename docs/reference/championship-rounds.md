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

## Picking a line-up by hand

Most of the time the standings should decide who advances. Sometimes they
shouldn't — a subjective award, a house rule the app has no setting for, a
car that had a mechanical problem the timer can't see. For those, an
operator can choose a championship round's cars directly instead of letting
the standings pick them.

**Two ways to reach it, same result either way:**

- **When adding the round.** On the Championship Round tab of **Add Round**
  (or the Round Wizard), check **I'll choose who races myself**. The round
  is still created and scheduled the usual way — this only skips filling it
  from the standings, and opens the picker right after so you can fill it
  yourself.
- **Any time before the round has been raced.** Its card on the Schedule tab
  gets a **Pick by hand** button next to Regenerate.

The picker starts with the standings' own current suggestion already
selected, so you can see what you're choosing to differ from — add or
remove racers, or use **Add another** for a line-up bigger than the round
asked for. There's no maximum, and no requirement to match the count the
round was set up with; the only rule is at least two cars.

**Only a checked-in car can be picked.** The same rule that keeps a
championship slot from going to a car that has left the building — see
[a withdrawal](mid-race-changes.md#a-withdrawal) — applies to a hand pick
too: if the car you want isn't in the list, check it in first.

**It sticks.** A hand-picked line-up is marked with a **Hand-picked** badge,
and — unlike a computed one — it does not get rebuilt or refilled as later
results come in. Correcting an earlier time, a car withdrawing, another
round finishing: none of it touches a round you've picked by hand. That's
the whole point of picking it yourself.

**Undoing it** is the **Use standings** button next to the badge. What
happens next depends on whether the round has been raced:

- **Not yet raced:** the round is rebuilt immediately from the standings as
  they stand right now, the same as a round that was never pinned.
- **Already raced:** only the pin comes off. The results you've already
  recorded stand — nobody rewrites a heat that happened — but if the
  hand-picked field doesn't match today's standings, the round now shows the
  ordinary **Line-up out of date** badge, same as any other raced round
  whose field has drifted.

A hand-picked round can't be re-raced into by mistake: **Pick by hand**
(shown as **Edit picks** once a pick exists) disappears the moment the round
has recorded results, the same as **Regenerate**. Clear the round's results
first if you really do want to change who's in it.

## When a time is corrected

Correcting (or clearing) any earlier result re-decides who advances.

- A championship round that has **not been raced** re-picks its cars
  automatically — unless it's [been picked by hand](#picking-a-line-up-by-hand),
  in which case nothing about it changes.
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
