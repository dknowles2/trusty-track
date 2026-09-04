# Running order across groups

By default, each den runs its own round as a block: the Lions race straight
through their round, then the Tigers race theirs, and so on. Between blocks
somebody calls the next den forward, families move, cars are handed over —
and the track sits empty while that happens.

**Interleave heats across every den**, a race setting off by default, fixes
that by weaving every den's heats into one running order instead of one
block per den — heat 1 might be a Lion heat, heat 2 a Tiger heat, heat 3 a
Lion heat again — so the next den's cars are already staged while the
current den races.

## Turning it on

Tick **Interleave heats across every den** on the race form. It is not
offered while creating a race — there is nothing yet to interleave — so
create the race first and turn it on afterwards from the **Event** section of
the race's edit form, under the track. See [Race and track settings](race-settings.md#the-race).

Turning it on renumbers nothing by itself — clicking **Apply master order**,
below, is what weaves the heats together. What it does switch straight away
is how race day runs: the Race tab, the Schedule tab's Run buttons and the
audience displays all start following the running order rather than one
round's block at a time. See
[Race day under the running order](#race-day-under-the-running-order).

## Applying it

Build your rounds exactly as you would for any other race — one round per
den, raced however you like: every lane for everyone, Balanced, or
Elimination. See [Round styles](round-styles.md).

Once the setting is on, a **Master running order** panel appears on the
Schedule tab, above the ordinary per-round tables, listing every heat once
in running order with the den it belongs to. Click **Apply master order**
to weave the dens' current heats together into that order.

- **Heats already run keep the heat number they were called by.** Applying
  the order never touches a heat that already holds a result — an announcer
  who has already called heat 6 will still find it as heat 6.
- **It is a deliberate, repeatable action, not a one-time setup step.** Press
  it again any time — after adding a round by hand, say — and it recomputes
  the order from scratch over whatever heats are still pending. A round added
  or regenerated after the last apply numbers its own heats from 1 again, so
  re-apply once the schedule settles to weave it in properly.

## Race day under the running order

While the setting is on:

- **The Race tab follows the woven order.** After each heat, the next heat
  offered is the next one in the running order — usually another den's — and
  the **On Deck** panel shows that heat's line-up so the right cars are
  staged. The audience displays' Now Racing and On Deck follow the same
  order, so the wall always agrees with the operator's screen.
- **Any pending heat can be run from the Schedule tab.** Rounds progress
  side by side, so **Run** is no longer greyed out on a round that is
  waiting for an earlier one to finish.
- **Dragging heats within a round is switched off**, and the drag handle
  says so. A hand-reorder renumbers the round from 1, which would silently
  pull it to the front of the running order. Turn the setting off if you
  need to hand-reorder, then re-apply the master order.
- **A championship round still runs last.** Its field is drawn from the
  dens' standings, so it is never woven in between them — it runs in its own
  order after every den's round is finished, exactly as it would without
  this setting.

## What it does and does not change

- **Not a new way of scheduling.** Every heat in the running order is a heat
  its own round already produced. A den's schedule — its matchups, its lane
  balance — is exactly what [Round styles](round-styles.md) says it would be
  without this setting. All that changes is the *order* the heats run in.
- **Not a change to scoring.** Each den's standings are still worked out
  from that den's own heats. Interleaving never averages one den's times
  against another's — see [Scoring](scoring.md).
- **Not a merged round.** The rounds stay separate. Advancement, when a
  round counts as finished, and the round-complete summary all work exactly
  as they do without this setting.

## Two rules the order tries to follow

- **Every den finishes at roughly the same time.** A den of four and a den
  of twelve, interleaved turn for turn, would run through the four-car den
  in the first quarter of the schedule and leave the rest of the event to
  the twelve-car den alone — the same "one den waits on another" problem
  this setting exists to fix, just moved later. Instead, each den's share of
  the running order tracks its own size the whole way through.
- **The same car is not staged twice in a row where it can be avoided.** The
  point of interleaving is giving the crew that just ran a moment before
  their next heat, not sending them straight back to the line. This is
  best-effort, not a guarantee: if only one den still has heats left, there
  is nothing to weave it against, and a den's own schedule can already put
  the same car in back-to-back heats on its own (round styles do not
  promise otherwise). The running order never reorders heats *within* a
  den to fix that — it only decides which den's heat comes next.

## Repairing the order as the day changes

A late arrival or a dead lane can add heats to a den mid-event — see
[Changes in the middle of a race](mid-race-changes.md). On a race with
interleaving turned on, those new heats are woven into the running order
automatically, right after the change that created them:

- **New heats are added after everything already numbered**, never
  inserted in the middle. Nothing already on the board — run or still
  pending — ever gets a new heat number, so a heat you have already armed
  on the timer is never swapped out from under you.
- **Only the new heats are repaired.** This does not recompute the whole
  running order the way clicking **Apply master order** yourself does, so
  it never disturbs a heat the announcer has already called.
- Two dens that each gain heats from the same change — two latecomers
  checked in together, say — have their new heats woven together the same
  way the initial running order is, so they still finish at about the same
  time as each other.
