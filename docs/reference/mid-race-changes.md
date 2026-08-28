# Changes in the middle of a race

Race day never goes exactly to plan. This page holds the rules for what
Trusty Track does when it changes underneath you — a late arrival, a
withdrawal, a dead lane, a skipped heat, a wrong time.

One pattern covers the first three. What happens to a round depends on how
far it has got:

| The round | What happens |
| --- | --- |
| Not started | Rebuilt to match the new situation — nothing is at risk, so everybody gets an equal schedule |
| Part-way through | **Every recorded heat is kept.** Only the heats still to come change |
| Finished | Left alone |

## A late arrival

Add the racer to the roster and check them in. **Checking them in is what
puts them in the racing** — there is nothing else to press.

- A round that has not started is rebuilt with them in it.
- A round part-way through keeps every recorded heat, and new heats are
  added at the end so the newcomer gets one turn in each lane — the same
  spread everybody else got.
- A finished round is left alone; they join from the next round.

The added heats need other cars in their lanes, so a few racers run once
more than their peers. A timed race shrugs that off; a points race
[sets that round aside](scoring.md#rounds-that-are-set-aside) and the
Standings page says so. Two children arriving together share their extra
heats rather than each pulling in a separate set of veterans.

- In a [Balanced or Elimination round](round-styles.md), a latecomer simply
  joins the next set of heats — on a clean record in elimination, and never
  a race that is already decided.
- A championship round is never joined directly: a latecomer qualifies for
  it by racing.
- **No heats** against a checked-in racer on the roster means they arrived
  after the round they would have been in had finished. They will be in the
  next round created.

## A withdrawal

Open the racer's check-in entry and turn **Passed Inspection / Checked In**
off.

- A round that has not started is rebuilt without them.
- A round part-way through keeps every recorded heat; their lanes in the
  remaining heats are emptied. Nobody else's schedule changes, and nothing
  is set aside — an empty lane gives nobody extra heats.
- A finished round keeps their results.
- A championship spot they held in an unraced round goes to the
  [next qualifier](championship-rounds.md#when-a-qualifier-leaves).

If it was a mistake, check them back in — they get their place back the same
way a latecomer does.

## A lane stops working

**Settings → Tracks → Lanes in service** — untick the lane. It applies the
moment you click it, not when you press Save, because a lane dies mid-event
rather than by appointment.

- Every round generated from then on is scheduled around it: the remaining
  lanes are used, everybody still races the same number of times, and heats
  name the lanes that actually exist rather than renumbering them.
- A round already under way follows the table above: recorded heats keep
  their results, and the dead lane is dropped from the heats still to come.
  The cars that lose a heat this way make the round
  [set aside](scoring.md#rounds-that-are-set-aside) in a points race.
- Tick the lane again when it is fixed and the next round uses it. A track
  with no working lanes generates no schedule at all, and the settings page
  says so.

## Turning down a track's lane count

**Settings → Tracks → Lanes** — lowering the number and pressing
**Save Settings** is brought into line the same way a lane going out of
service is, following the same table above: a round nobody has raced is
rebuilt for the lanes that remain, a round part-way through keeps its
recorded heats and has the lane it no longer has dropped from what is still
to come (set aside in a points race, same as above), and a finished round is
untouched.

## Skipping a heat

**Skip Heat** passes over the current heat without racing it — for when
every car in it has scratched.

- The schedule moves on. A skipped heat holds nothing up: the round still
  finishes, and a championship round waiting on it still fills.
- It can be raced later with **Run** if the cars turn up after all.
- In a points race its cars are scored as last in it; in a timed race it is
  simply not part of anyone's average. See [Scoring](scoring.md).
- In an elimination round a skipped heat is neither a win nor a loss for
  anyone.

## A wrong result

- **Edit** on a recorded heat corrects individual times.
- **Re-Run** clears the whole heat so it can race again.
- Either way, [who advances is re-decided](championship-rounds.md#when-a-time-is-corrected)
  from the corrected results.
- If the schedule changes while a heat is armed on the timer — a rebuild, a
  reorder, a deleted round — the timer disarms itself and says so, rather
  than recording times against cars that have moved. Re-arm the heat and run
  it again.
