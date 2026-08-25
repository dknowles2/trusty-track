# Scoring & Championships

This page collects the rules in one place: how a score is worked out, what
makes the standings, how championship rounds choose their field, and the
different ways a round can be raced. The [Race Day guide](race-day.md) walks
through *doing* these things in order; this page is for the moment somebody
asks *why* — usually with a queue behind them.

## How scoring works

You choose the scoring style when you create the race, and every round uses
it.

### Timed (the default)

Each racer's score is the **average of their heat times** — lower is better.
Averages are fair even when racers end up with different numbers of heats,
which is why timed scoring shrugs off most of the complications below.

A car that left the gate but never reached the finish — a knocked wheel, a
jumped lane — gets a penalty time of 9.999 seconds for that heat instead of
no time at all. One bad run hurts, but it does not erase a whole morning of
good ones.

### Points

Each racer's score is their **finishing places added up** — 1st place is 1
point, 2nd is 2, and so on, and lower is better. It works without a timer:
somebody watches the finish line and records the order.

Because points *add up*, a racer with fewer heats would score better for
having raced less. Trusty Track closes every way that could happen:

- A car that never finished its heat, or sat out a heat you skipped, scores
  **last place in that heat** — the same as every racing series scores a
  scratch.
- A round where some racers genuinely ran fewer heats than others — a lane
  went out of service part-way through, or a latecomer joined mid-round — is
  **left out of the overall standings entirely**, and the standings page
  says so. The round still runs and its results are still there to look at;
  it just does not decide the trophies.

### Ties share a rank

Two racers with the same score both show the same rank, and the next rank
skips — 1st, 1st, 3rd. The app deliberately does not break the tie for you:
deciding one is a judgment call, and yours to make — a race-off, or a
corrected time. Ties are common in points-scored races and rare, but
possible, in timed ones.

## What counts toward the standings

**The overall standings cover the preliminary rounds only** — the rounds
everyone races. Championship rounds are left out on purpose: their field is
*picked from* the standings, so folding a final's times back in could change
who was supposed to be in the final. A championship round's own results are
shown by picking that round from the selector on the Standings page.

Also left out:

- **Disrupted rounds, in points-scored races** — see above. Timed races keep
  them; an average is fair either way.
- **Elimination rounds, always** — a car knocked out early raced fewer heats
  by design, so neither an average nor a sum over them is fair. An
  elimination round's result is survival, and it has its own view on the
  Standings page.

Balanced rounds count normally: everyone races the same number of times.

## Three ways to race a round

Every general round — one the whole field races — is run in one of three
styles, chosen when the round is created:

| Style | How heats are drawn | Ends when | Counts toward standings |
| --- | --- | --- | --- |
| **Everyone races in every lane** | The whole schedule up front; each car gets each lane once per run | The schedule is raced | Yes |
| **Balanced** | First heats random; each new set matches cars doing about as well | Each car has raced the chosen number of times | Yes |
| **Elimination** | Each new set matches cars with the same record; lose too many and you're out | One car is left standing | No — its result is survival |

The first is the classic derby format and the right default: everybody gets
the same fair spread of lanes, and the standings mean the most. **Balanced**
is for a pack that wants more children to win a heat — winners race winners,
so the other heats are winnable. **Elimination** is the "lose twice and
you're out" bracket, without the bracket. The [Race Day
guide](race-day.md#adding-a-round-later) shows how to set each one up.

## Championship rounds

A championship round holds the best cars from earlier racing. Its field can
come from:

- **Top overall** — the best N cars in the whole pack.
- **Top per den** — the best N from *each* den, so the field grows with the
  number of dens.
- **A previous championship round** — which is how you get "top ten race a
  semifinal, top three of *them* race the final". An elimination round can
  feed a final the same way: its last cars standing.

Three things the app handles so you do not have to:

- **The field fills itself.** A championship round waits as placeholder
  slots until the racing that decides it is finished, then fills in on its
  own — including a round you add *after* the deciding racing already
  finished.
- **Corrections flow forward.** Fix a time in an earlier round and any
  unraced championship round re-picks its field from the corrected
  standings. A championship round that has *already been raced* is never
  quietly rewritten — the schedule shows a **Field out of date** badge
  instead, and what to do about it is your call.
- **A withdrawal promotes the next qualifier.** If a qualifier is
  un-checked-in before the round runs, the next car in the standings steps
  up. Their recorded results stay; only their place in a race yet to run is
  given up.

![Round Completion — Advancement Summary](assets/screenshots/race-day/16-round-completion-modal.png)
_When the field for a championship round is decided, the summary lists the
racers who advance, with their finishing scores._

### The Slowest Race

A championship round can also pick from the *bottom* of the standings — a
just-for-fun bracket where the last car down the track wins. Cars that never
recorded a time are left out (not racing is not the same as being slow), and
its standings view lists the slowest car first, because that is the winner.
See [the Slowest Race](race-day.md#the-slowest-race) for setting one up.

## Standings are not trophies

The Standings page is the ranking; the [Awards](awards.md) page is the
hardware. Speed awards (Fastest Car, Fastest Wolf) are worked out from the
standings *every time they are looked at*, so a corrected time moves a
trophy automatically — right up until you announce it. Judged awards (Best
Paint, Most Original) are chosen by people and never move on their own. The
number of championship trophies configured on the race decides how many cars
advance to the final; it is a scheduling setting, not an award.
