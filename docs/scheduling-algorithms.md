# Race Scheduling Algorithm

Trusty Track schedules a general round's heats with the **Partial Perfect Chart (PPC)** algorithm by default. Two more are also available — **Lane rotation**, and now the **Perfect-N chart** — and the round wizard does not offer a choice yet ([part D of #1090](https://github.com/dknowles2/trusty-track/issues/1090) is the wizard step; every one of these algorithms already produces the same shared guarantees — lane neutrality and equal run counts — just with a different opponent pattern.

## Partial Perfect Chart (PPC)

**Goal:** Lane Neutrality + Maximized Opponent Variety.
**Best For:** All race sizes.

### Benefits
- **Fairness:** Every racer runs in every lane exactly once. With fewer racers than the track has lanes — three racers on a four-lane track, say — the spare lanes simply go unused, and everyone still runs the same number of heats.
- **Variety:** Racers face as many different opponents as possible during the race.
- **Social Engagement:** Maximizes the number of unique "matchups" between different scouts.

### How it Works

1. **Randomized Start:** Lane 1 is filled with all participants in a randomized order. This is what fixes the heat count at one heat per racer.
2. **Greedy Optimization:** For each subsequent lane, the algorithm works through the heats in turn and picks a participant who is not already in that heat, preferring whoever has the lowest cumulative "Matchup Score" — the number of times they have already faced the racers assigned to this heat.
3. **Repair:** Greedy alone can paint itself into a corner, leaving a lane empty. Filling a lane is really a bipartite matching between heats and racers, and a greedy pass finds a *maximal* matching rather than a *maximum* one. Any heat the greedy pass strands is then filled by an augmenting path, which displaces an earlier assignment down a chain ending at a racer nobody has claimed.

Step 3 was added to fix [issue #26](https://github.com/dknowles2/trusty-track/issues/26). Without it roughly one in four schedules on a four-lane track left a heat a car short, so one racer ran fewer heats than everyone else — and because `POINTS` scoring **sums** finishing places, running one fewer heat made that racer's score *better*.

The repair is strictly additive: where the greedy pass already produced a full schedule, the output is byte-for-byte identical.

### Example
In a race with 4 racers and 4 lanes:
- Every racer appears in one heat for each of the 4 lanes.
- Every heat is full.
- The algorithm avoids racing the same pair against each other repeatedly.

Opponent variety remains a heuristic — this is a *partial* perfect chart, not an optimal one. Lane neutrality and equal run counts are guaranteed; minimum repeat matchups is best-effort.

---

## Lane rotation

**Goal:** Lane Neutrality + Simplicity.
**Best For:** A pack that wants the chart it used to run by hand, or that finds PPC's shuffled opponents harder to explain at the track.

### Benefits
- **Fairness:** Every racer runs in every lane exactly once, the same guarantee PPC makes — a field smaller than the track leaves the spare lanes unused rather than short-changing anybody.
- **Simplicity:** The whole chart is one rule — *your next heat puts you one lane further along than your last* — which reads off a printed sheet without an explanation of matchup scores.
- **Predictability:** An operator (or a racer) can say where they will be next without consulting the sheet again.

### How it Works

1. **Randomized order:** The roster is shuffled once, same as PPC's lane-1 seeding.
2. **A sliding window:** Read the shuffled roster as a circle. Each heat is the next `usable lane count` racers around that circle, one heat per racer in the field.
3. **The rotation:** A car's lane moves one place along the usable-lane list from one heat to the next, wrapping back to the first lane when it reaches the last — and wrapping the *roster*, not just the lane list, so the last heat borrows from the front of the circle rather than running short. Every heat stays full even when the field is not an exact multiple of the lane count.

There is no opponent-variety step, and none is attempted — that trade is the whole point of choosing this over PPC.

### Example
In a race with 4 racers and 4 lanes:
- Every racer appears in one heat for each of the 4 lanes, the same as PPC's example.
- A racer in lane 2 this heat is in lane 3 next, lane 4 after that, and lane 1 after that.
- Who races whom is decided entirely by the shuffle at the start, not re-optimized heat to heat.

---

## Perfect-N chart

**Goal:** Lane Neutrality + Equal Opposition, exactly rather than best-effort.
**Best For:** A field size the chart actually covers (below) — otherwise, the Partial Perfect Chart.

Named for, and attributed to, [Stan Pope](http://www.stanpope.net/)'s published Perfect-N charts — the method GPRM and DerbyNet both call "PPN"/"Perfect-N" too. Where PPC's opponent variety is a heuristic that gets close, a true Perfect-N chart guarantees every pair of cars meets the *same number of times*, not merely close counts — a balanced incomplete block design, not an approximation of one.

### Benefits
- **Fairness:** Every racer runs in every lane exactly once, the same guarantee PPC and Lane rotation make.
- **Exact equal opposition:** Every pair of cars races against each other the same number of times as every other pair — not "close," but identical, for every table this chart ships.
- **The fairest chart there is, when it exists:** unlike PPC, this is not a heuristic converging on fairness; it is fairness by construction.

### How it Works

A Perfect-N chart is only possible for certain (lane count, field size) combinations — the reason it is not PPC's unconditional replacement. `available_for(n_racers, n_lanes)` says which: it returns `None` when a chart is published for that exact shape, or a reason (recommending PPC) otherwise. Where a chart exists, `generate_perfect_n` maps a seeded shuffle of the field onto the chart's car positions and the track's usable lanes onto its lane columns — the chart shape itself is fixed data (`backend/domain/schedulers/perfect_n_tables.py`), not computed per race.

### Which field sizes have a chart

| Lanes | Field sizes (n) |
| --- | --- |
| 3 | 3, 4, 7 |
| 4 | 4, 5, 13 |
| 5 | 5, 6 |
| 6 | 6, 7 |

Every one of these is a *true* Perfect-N chart — constant pairwise meetings, not merely "close" — built from one of three constructions: the trivial case (`n == lanes`, a Latin square, since every heat necessarily holds the whole field), the "one absence" case (`n == lanes + 1`, one car sits out each heat), and a planar difference set for the two "meets exactly once" cases in range (`3` lanes/`7` cars is the Fano plane; `4` lanes/`13` cars is `PG(2,3)`). See that module's docstring for the mathematics, the honest account of why these were derived rather than transcribed from Pope's site (unreachable during this PR's authorship), and the comparison run against DerbyNet's own generator-based scheduler. This table is not exhaustive of every shape a Perfect-N chart could exist for — see the module docstring's "which necessary shapes exist but are not here" for the ones a future PR could add.

### Example
In a race with 5 racers and 4 lanes (`(4, 5)`, the "one absence" construction):
- Every racer appears in one heat for each of the 4 lanes.
- Each heat is the one heat a different car sits out of.
- Every pair of the 5 cars races against each other exactly 3 times — not "about" 3, exactly 3, for every pair.

### A latecomer

Adding one car to a Perfect-N chart already underway has no answer that keeps every pair meeting the chart's own constant number of times — there is no splice that preserves the guarantee, unlike PPC's per-newcomer appendix. `Round.algorithm`'s `absorbs_latecomer` is `False` for Perfect-N: admission regenerates the round if nothing has raced yet, or refuses (naming the round and why) once something has — the same rule Lane rotation already follows.

---

## Technical Implementation
All three algorithms are pure functions over plain values — a list of racer IDs and a list of usable lanes in, a schedule out, no database code involved — registered in `backend/domain/schedulers/__init__.py` and selected by a round's own `algorithm` column. `crud.generate_heats_for_round` decides who is in the field, looks up which algorithm the round asked for, and persists the result.

- PPC lives in `backend/domain/scheduling.py` (`generate_ppc`).
- Lane rotation lives in `backend/domain/schedulers/rotation.py` (`generate_rotation`).
- Perfect-N lives in `backend/domain/schedulers/perfect_n.py` (`generate_perfect_n`), reading its chart data from `backend/domain/schedulers/perfect_n_tables.py`.

All three take *which* lanes rather than how many ([issue #171](https://github.com/dknowles2/trusty-track/issues/171)). On an undamaged track that is every lane, and nothing changes; when a lane is out of service it is the remaining ones, and the schedule names the lanes that exist rather than renumbering them. Every property above is stated over the usable lanes — including the one that matters most, that every heat is full and everybody runs the same number of times.

Because they are pure, `backend/tests/test_domain_scheduling.py` exercises every racer count from 2 to 20 against every lane count from 2 to 8 with no fixtures, in about a second, plus a set of gapped tracks, for every registered algorithm — filtered through `available_for` first for Perfect-N, since (unlike PPC and Lane rotation) it genuinely refuses shapes it has no chart for. That sweep is how #26 was found, and it is the same suite a new algorithm has to pass before it can be registered — plus, for Perfect-N specifically, the constant-pairwise-meetings property that is its whole reason to exist.
