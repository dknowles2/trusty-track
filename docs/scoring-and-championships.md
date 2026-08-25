# Scoring & Championships

Two decisions shape your race day: **how scores are counted**, which you pick
when you create the race, and **what happens after everyone has raced** —
finals, a per-den championship, a fun round for the slowest cars, or nothing
at all. This page helps you choose, and shows how to set each one up. The
[Race Day guide](race-day.md) is the start-to-finish walkthrough; come here
when you are deciding, or when a parent asks why the standings look the way
they do.

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
all you need is somebody at the finish line calling the order.

Two things to know about points, both handled for you:

- A car that breaks down mid-heat, or sits out a heat you skipped, is counted
  as **last in that heat**. Without this, missing a heat would actually
  *improve* a score, since fewer places means a lower total.
- If some cars end up racing fewer heats than others — a lane stopped working
  mid-round, or a racer arrived late — that round is **set aside from the
  trophy standings**, and the Standings page tells you so. The round still
  runs and everyone still sees its results; it just does not decide who wins.
  (Timed races keep such rounds, because averages stay fair.)

### When two cars tie

They share the rank — 1st, 1st, 3rd — and the Standings page shows it that
way. Trusty Track never breaks a tie for you, because that is a judgment
call: settle it with a race-off, or by correcting a time if one was recorded
wrong. Ties happen a lot with points and only rarely with times.

## What the Standings page shows

The overall standings cover the rounds that **everyone** races. A final does
not feed back into them — the cars in the final were *chosen from* those
standings, so its times are shown separately: use the dropdown above the
table to look at any final on its own.

Two kinds of round keep their results out of the overall standings on
purpose:

- A round that was **set aside** in a points race (see above).
- An **elimination round** — cars knocked out early race fewer heats, so
  there is no fair way to average them. Pick the round from the dropdown to
  see its own result: who survived, and who lasted longest.

## Choosing how a round is raced

When you add a round that everyone races, the Add Round dialog asks **How
it's raced**. Three choices:

| Choice | How it works | Good for |
| --- | --- | --- |
| **Everyone races in every lane** | The whole schedule is made up front; every car gets a turn in every lane | Most races — the fairest comparison, and the one to pick if in doubt |
| **Balanced** | First heats are random; after that, cars doing about as well race each other | Making sure more children get a heat they can win |
| **Elimination** | Lose too many heats and you're out; last car left wins | Drama — or a fun second event after the main racing |

A little more on the second two:

- **Balanced** exists because when the fastest cars are spread across every
  heat, they win every heat. Matching the winners against each other means
  the other heats are winnable. Everyone still races the same number of
  times, and times and points still count toward the standings as usual. You
  pick how many times each car races; once per lane is a good rule of thumb
  and is the suggestion offered.
- **Elimination** is the classic "lose twice and you're out" — with no
  bracket to draw and nothing to reprint when somebody doesn't show up. You
  pick how many losses a car is allowed (three is a good default). A loss is
  any heat a car does not win, second place included. New heats appear on
  their own as results come in, and cars still racing are matched against
  cars with the same record — the undefeated race the undefeated.

For both Balanced and Elimination, just run whatever heats are on the
screen; when they are done, the next set appears by itself. A racer who
checks in late is simply included in the next set.

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

- **The right cars appear on their own.** A championship round starts out
  showing "To be decided" in each lane, and fills itself in the moment the
  racing that decides it is finished — no button to press.
- **Fixing a time fixes the final.** Correct a result from earlier in the
  day, and any championship round that has not yet been raced re-picks its
  cars from the corrected results. One that has *already* been raced is
  never quietly rewritten — the schedule shows a **Field out of date** badge
  so you can decide what to do, which beats discovering it after the
  trophies.
- **If a qualifier leaves early**, un-check them at the check-in screen and
  the next car in the standings takes their spot — as long as that round has
  not been raced yet. Their earlier results stay on the board.

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
