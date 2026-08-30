# Scoring

The full rules for how a score is worked out and what makes the standings.
For help *choosing* among the four methods, see
[Scoring & Championships](../scoring-and-championships.md).

## Timed

Each car's score is the **average of its recorded heat times**, and the
fastest average wins.

- Averages make heat counts irrelevant: a car with four heats and a car with
  five are compared on the same footing.
- A car that leaves the gate but never reaches the finish — a wheel comes
  off, it jumps the lane — is given **9.999 seconds** for that heat. One bad
  run hurts the average; it does not erase a morning of good ones.
- A heat that was skipped is simply not part of anyone's average.

## Points

Each car's score is its **finishing places added up** — 1st is 1 point, 2nd
is 2 — and the lowest total wins. Points exist for racing without a timer:
somebody at the finish line calls the order, and types it straight into
Override/Edit on the Race screen — see
[Race and Track Settings](race-settings.md#no-timer) for setting a track up
with no timer at all, which makes that the main way results get recorded
rather than a fallback.

Because points are a total, a car with fewer counted heats gets a *better*
score. Every rule below exists to stop a missing heat from becoming a
reward:

- A car that breaks down mid-heat is scored as **last in that heat** — last
  among the cars actually in it, not the number of lanes.
- The cars in a **skipped heat** are also scored as last in it. A scratch
  classifies last, the same as in any racing series.
- A heat where some cars ended up racing **fewer times than others** — a
  lane died mid-round, or a racer arrived late — is
  [set aside](#rounds-that-are-set-aside) from the standings entirely.
- A lane left blank in Override has **no place** and is not counted — a
  genuinely unfinished entry, not a result.
- A typed-in place has to make sense: **1st or better**, no higher than the
  number of cars in the heat, and not reused for two cars. Trusty Track
  refuses the save and says why, rather than storing a number that would
  score wrong — a `0` or a negative place would otherwise *subtract* from a
  car's total.

## Cumulative time

Each car's score is its **recorded heat times added together**, rather than
averaged, and the lowest total wins. While every car races the same number
of heats, this orders racers identically to Timed — it is a real third
method only because that condition can break: a lane going out of service, a
late arrival, or a track reconfigured to fewer lanes can all leave some cars
with a heat count the rest of the field does not share.

Because it is a total rather than an average, a car with one fewer heat has
one fewer time to add up — which sums to *less*, the same reward for a
missing heat that Points guards against. Cumulative time follows both of
Points's own protections for that reason:

- A car that never reaches the finish is given **9.999 seconds** for that
  heat, the same DNF penalty Timed uses — a bad time, not a vanished one.
- A round where some cars ended up racing fewer times than others is
  [set aside](#rounds-that-are-set-aside) from the standings entirely, the
  same as under Points.

## Fastest single run

Each car's score is its **single best recorded time** — the traditional
pinewood answer, and what most packs mean by "fastest run wins." A car that
is quick once and unlucky twice places on the once.

- A car that never reaches the finish is not a candidate at all for that
  heat: the DNF is **ignored outright**, not penalised. A bad run never
  drags a car's best time down, because it was never in the running to be
  the racer's score.
- A car whose *every* run is a DNF has no time to offer, and sorts **below
  every car that finished at least one heat** — worse than being left out
  of an average, the way a DNF is under Timed.
- Like Timed, it does not care how many heats each car ran: a round
  disrupted by a lane outage or a late arrival still counts toward the
  standings.

## Drop the worst run

An optional setting next to Scoring on the race form, off by default (`0`).
It is not a fifth method — it is a modifier over whichever of the four you
picked: each racer's worst counted results are set aside before scoring,
the same number for every racer.

- **It only fires when everyone who has raced has the same number of
  counted results**, and that number is at least one more than what is
  being dropped. Dropping one run from a racer with three heats and one
  from a racer with four still leaves them uneven — two against three —
  which is exactly the missing-heat reward every rule above exists to
  prevent. So when the field is uneven, nothing is dropped at all, and the
  standings say so rather than pretending the setting is off.
- **It is the honest version of the DNF penalty.** Under Timed and
  Cumulative time, a DNF is still recorded as 9.999 seconds; under Points,
  it is still last place — those inventions have not gone away, because a
  bad run is still a fact the scoring math has to hold a number for. What
  changes is what happens next: an invented penalty is usually the highest
  value a racer has, so it is usually the one that gets dropped. A racer
  whose one bad heat was a DNF ends up scored entirely on the heats they
  actually finished, as if the bad one had never been scheduled — no
  9.999 seconds, no invented last place, because it was never counted in
  the first place.
- A racer with more than one DNF still has the extras count. Dropping the
  worst run removes exactly as many results as the setting says, however
  many of a racer's results were bad ones.
- Under Fastest single run, dropping the worst run changes nothing: that
  method already keeps only a racer's single lowest time, and removing the
  *highest* of the rest can never be the value it was already using.

## When two cars tie

Tied cars **share the rank** — 1st, 1st, 3rd — and every page that shows
standings shows it that way. What happens beyond that is up to the race's
**Tiebreaker** setting, next to Scoring on the race form — see
[Ties](race-settings.md#ties) in Race and Track Settings — because how a tie
should be settled is the pack's call, not one Trusty Track can guess.

The default, **Leave it shared**, is today's behaviour and nothing more:
a tied slot in a final or a tied trophy stays a judgment call, settled with
a [race-off](#settling-a-tie-with-a-race-off) or by correcting a time that
was recorded wrong. Choose one of the other four and Trusty Track settles
it for you, wherever a tie actually decides something — the last qualifying
slot in a final, or who gets a speed trophy:

| Choice | Wins the tie |
| --- | --- |
| **Fastest single heat** | Whoever's best recorded heat time is lowest |
| **Lowest total time** | Whoever's heats add up to the least total time |
| **Countback** | Most 1st-place finishes; a tie on that goes to most 2nds, and so on |
| **Head-to-head** | Among the tied cars, whoever won more of the heats they actually shared |

None of the four invents an answer the data does not support. Identical
times, a race with no timer to compare, two cars that never actually raced
each other — every one of those leaves the tie **unresolved**, exactly as
if **Leave it shared** had been chosen. A row the chosen method did settle
says so on the standings — "2nd, on fastest single heat" — so the tie is
still visible even once it is decided. Where a tie decides who advances or
who wins a trophy and the chosen method could not settle it, the schedule
shows a **Tie unresolved** badge and the Awards page marks the recipient as
provisional — the round stays runnable and the trophy stays assignable
either way; both are just asking you to make the final call.

Cars that have not raced yet do not tie with each other; they are listed
below every car that has, in a stable order.

## Settling a tie with a race-off

A **Start run-off** button appears against a shared rank on the Standings
page, and beside a **Tie unresolved** badge on the schedule. Click it and
Trusty Track builds a heat holding exactly the tied cars; arm and record it
through the ordinary race-day screen, same as any other heat. Whoever wins
the run-off takes the tie — no need to change the Tiebreaker setting, and
no need to hand-edit anyone's time.

A run-off's own time never joins anybody's average, sum, or any other
number the standings compute. It settles one thing only — the shared rank
it was created against — and leaves everything else exactly as it was,
including a track's own speed records: a blazing-fast run-off lap does not
become the fastest car the track has ever seen, because it was never a
real qualifying run to begin with.

If a time is corrected afterward and the tie the run-off settled no longer
exists — the cars are not tied any more, or a different pair is now tied
instead — the run-off simply stops applying. Nothing is deleted; it just
has nothing left to decide, the same as if it had never been run. A fresh
one covers whatever the standings show now.

## What the overall standings cover

The overall standings — "Overall (qualifying rounds)" in the selector — are
built from the **qualifying rounds only**: the rounds the whole roster
races. Left out, each for its own reason:

| Left out | Why |
| --- | --- |
| **Championship rounds** | Their cars were *picked from* the standings, so feeding their times back in would be circular — a final's result could change who was supposed to be in the final. Each has its own page in the selector. |
| **Elimination rounds** | A car knocked out early races fewer heats, so there is no fair average or total. The round's own page shows its result in losses. |
| **Rounds set aside under Points or Cumulative time** | See below. |
| **Free race heats** | They count for nothing, by design. |

## Rounds that are set aside

Under **Points** or **Cumulative time**, a round where some cars raced fewer
heats than others is left out of the overall standings — both are totals, so
both are vulnerable to the same missing-heat reward. The round still runs —
its heats show on the schedule and are recorded as normal — but it does not
get a page of its own in the round selector; the Standings page instead
shows a banner naming the round and explaining why it isn't counted.

Three things cause it:

- a [lane went out of service](mid-race-changes.md#a-lane-stops-working)
  part-way through the round;
- a [racer arrived late](mid-race-changes.md#a-late-arrival) and heats were
  added for them;
- a latecomer joined a [Balanced round](round-styles.md#balanced) part-way
  through.

**Timed** and **Fastest single run** keep these rounds: an average and a
single best time don't care how many heats each car ran.

A withdrawal does *not* set a round aside — an absent car empties a lane, it
does not give anyone extra heats.

## Each round's own page

The selector above the standings table lists every championship and
elimination round beside the overall standings.

- A **championship round's** page shows that round's results, scored the
  same way as the race.
- An **elimination round's** page shows losses instead of times: cars still
  racing first, then the eliminated, in order of how long they lasted.
- A **Slowest Race** page lists the slowest car first, because in that round
  the last one down the track wins. Only the display is reversed — nothing
  else reads the standings differently.
