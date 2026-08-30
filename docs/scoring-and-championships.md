# Scoring & Championships

Two decisions shape your race day: **how scores are counted**, which you pick
when you create the race, and **what happens after everyone has raced** —
finals, a per-den championship, a fun round for the slowest cars, or nothing
at all. This page helps you choose, and shows how to set each one up.

The [Race Day guide](race-day.md) is the start-to-finish walkthrough. The
exact rules behind everything here are in the reference:
[Scoring](reference/scoring.md), [Round styles](reference/round-styles.md),
and [Championship rounds](reference/championship-rounds.md).

## Choosing how to score

### Timed — the usual choice

Every car's score is its **average time**, and the fastest average wins.
Pick this if you have an electronic timer (including the built-in practice
timer). It is the default for good reasons:

- The averages stay fair even when things go sideways — a late arrival, a
  lane that stops working — because an average does not care how many heats
  each car ran.
- Exact times make ties rare, and give every family a number to take home
  ("3.042 seconds!").

If a car leaves the gate but never reaches the finish — a wheel comes off, it
jumps the lane — that heat is counted as a slow time (9.999 seconds) rather
than being thrown away. One bad run hurts, but it does not ruin a whole
morning of good ones.

### Points — for racing without a timer

Every car's score is its **finishing places added up** — 1st place is 1
point, 2nd is 2, and the lowest total wins. Pick this if you have no timer:
all you need is somebody at the finish line calling the order, typed
straight into the race screen. Set the track's **Timer Type** to **No
timer** (see [Race and Track Settings](reference/race-settings.md#no-timer))
and that becomes the main way results are recorded, rather than a fallback
behind a timer that never arms.

Two things to know about points, both handled for you:

- A car that breaks down mid-heat, or sits out a heat you skipped, is counted
  as **last in that heat**. Without this, missing a heat would actually
  *improve* a score, since fewer places means a lower total.
- If some cars end up racing fewer heats than others — a lane stopped
  working mid-round, or a racer arrived late — that round is **set aside
  from the trophy standings**, and the Standings page tells you so. Timed
  races keep such rounds, because averages stay fair.

The exact rules for both are in [Scoring](reference/scoring.md).

### When two cars tie

They share the rank — 1st, 1st, 3rd — and the Standings page shows it that
way. Ties happen a lot with points and only rarely with times.

Whether anything beyond that gets decided is up to the race's **Tiebreaker**
setting, next to Scoring on the race form. The default, **Leave it shared**,
is a judgment call left to you, same as always: settle it with a race-off,
or by correcting a time if one was recorded wrong.

If you'd rather Trusty Track settle it automatically, which of the other
four to pick depends on how the race is scored:

- **Timed races** usually want **Fastest single heat** — the traditional
  pinewood answer, and what most packs mean by "fastest run wins" — or
  **Lowest total time** if consistency across every heat should count for
  more than one great run.
- **Points races with a timer running** can use either of those too, since
  a time is still being recorded even though it is not the score.
- **Points races on a track with no timer** — see
  [No timer](reference/race-settings.md#no-timer) — have no time to compare,
  so **Fastest single heat** and **Lowest total time** will never fire.
  **Countback** (most 1st places, then most 2nds…) is the one that works
  from places alone, which every points race has whether or not a timer is
  running.
- **Head-to-head** suits a small, close field — den-sized rounds where the
  tied cars are likely to have actually raced each other more than once.
  In a large field it resolves less often, since two tied cars may never
  have shared a heat.

Whichever is picked, a tie the method cannot settle — identical times, cars
that never met, no data at all — is reported rather than guessed at. The
full rules are in
[When two cars tie](reference/scoring.md#when-two-cars-tie).

## What the Standings page shows

The overall standings cover the rounds that **everyone** races. A final does
not feed back into them — the cars in the final were *chosen from* those
standings, so its times are shown separately: use the dropdown above the
table to look at any final on its own. Elimination rounds get the same
treatment, each with its own page in the dropdown. A round set aside in a
points race — where some cars ran fewer heats than others — is different:
it stays folded into Overall rather than getting a page of its own, and the
Standings page shows a banner explaining why it isn't counted. The full list
of what counts and what does not is in
[Scoring](reference/scoring.md#what-the-overall-standings-cover).

## Choosing how a round is raced

When you add a round that everyone races, the Add Round dialog asks **How
it's raced**. Three choices:

| Choice | How it works | Good for |
| --- | --- | --- |
| **Everyone races in every lane** | The whole schedule is made up front; every car gets a turn in every lane | Most races — the fairest comparison, and the one to pick if in doubt |
| **Balanced** | First heats are random; after that, cars doing about as well race each other | Making sure more children get a heat they can win |
| **Elimination** | Lose too many heats and you're out; last car left wins | Drama — or a fun second event after the main racing |

For both Balanced and Elimination, just run whatever heats are on the
screen; when they are done, the next set appears by itself. A racer who
checks in late is simply included in the next set. The
[Race Day guide](race-day.md#balanced-racing) shows how to set each one up,
and the full rules are in [Round styles](reference/round-styles.md).

## Championship options

After the main racing, you can hold one or more rounds for the best cars.
None of this is required — a race with no championship round simply ends
with the standings.

**Setting one up:** either in the [Round Wizard](race-day.md#step-2-championship-rounds-optional)
when you first build the schedule, or later with **Add Round** on the
Schedule tab — pick the **Championship Round** tab in the dialog. Either
way, you choose where its racers come from and how many:

- **The fastest overall** — the top cars in the whole pack race a final.
  The most common setup: one final, three or four cars.
- **The fastest from each den** — the top cars from *every* den race
  together. Good when dens race separately in the main rounds and the
  champions have never met.
- **The top finishers of another championship round** — this is how you
  build "top ten race a semifinal, then the best three of *them* race the
  final". In the wizard, every championship round after the first does this
  automatically; with Add Round, pick the earlier round from the list. The
  last cars standing from an elimination round can feed a final the same
  way.

You do not have to decide any of this before racing starts. A championship
round added part-way through the day works exactly the same — and if the
racing that decides it is already finished, it fills in with the right cars
immediately.

### Things the app takes care of

- **The right cars appear on their own.** An undecided lane is a
  placeholder rather than a blank — see
  [How the line-up fills in](reference/championship-rounds.md#how-the-line-up-fills-in)
  for what each screen shows — and it fills itself the moment the racing
  that decides it is finished, no button to press.
- **Fixing a time fixes the final.** A championship round not yet raced
  re-picks its cars; one already raced shows a **Line-up out of date** badge
  instead, so you decide.
- **If a qualifier leaves early**, un-check them at the check-in screen and
  the next car in the standings takes their spot — as long as that round has
  not been raced yet.

The full rules are in
[Championship rounds](reference/championship-rounds.md).

![The summary shown when a championship round's racers are decided](assets/screenshots/race-day/16-round-completion-modal.png)
_When the racing that decides a championship round finishes, this summary
lists who made it, with their scores._

### The Slowest Race

A crowd favorite to end the day: a round for the **slowest** cars, where the
last one down the track wins. Set it up like any championship round, but
choose **The slowest cars** instead of the fastest. Cars that never recorded
a time are left out — not racing is not the same as being slow — and its
page on the Standings dropdown lists the slowest car first, because that is
the winner. See [the Slowest Race](race-day.md#the-slowest-race) for the
walkthrough.

## Standings and trophies are different things

The Standings page is the ranking. The [Awards](awards.md) page is the
hardware — and it is where "how many trophies" actually lives. Speed awards
like Fastest Car or Fastest Wolf are always worked out from the standings as
they are *right now*, so correcting a time moves the trophy with it, right
up until you announce it. Judged awards like Best Paint are chosen by
people and never move on their own.

One number that trips people up: **Championship Trophies** on the race
settings decides how many cars go into the final — it is about the racing,
not about how many physical trophies you hand out. The trophies themselves
are whatever you create on the Awards page.
