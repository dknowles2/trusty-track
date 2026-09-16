# Race Scheduling Algorithm

Trusty Track schedules a general round's heats with the **Partial Perfect Chart (PPC)** algorithm by default. A second algorithm, **Lane rotation**, is also available — the round wizard does not offer a choice yet, but every one of these algorithms produces the same shared guarantees (lane neutrality and equal run counts), just with a different opponent pattern.

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

## Technical Implementation
Both algorithms are pure functions over plain values — a list of racer IDs and a list of usable lanes in, a schedule out, no database code involved — registered in `backend/domain/schedulers/__init__.py` and selected by a round's own `algorithm` column. `crud.generate_heats_for_round` decides who is in the field, looks up which algorithm the round asked for, and persists the result.

- PPC lives in `backend/domain/scheduling.py` (`generate_ppc`).
- Lane rotation lives in `backend/domain/schedulers/rotation.py` (`generate_rotation`).

Both take *which* lanes rather than how many ([issue #171](https://github.com/dknowles2/trusty-track/issues/171)). On an undamaged track that is every lane, and nothing changes; when a lane is out of service it is the remaining ones, and the schedule names the lanes that exist rather than renumbering them. Every property above is stated over the usable lanes — including the one that matters most, that every heat is full and everybody runs the same number of times.

Because they are pure, `backend/tests/test_domain_scheduling.py` exercises every racer count from 2 to 20 against every lane count from 2 to 8 with no fixtures, in about a second, plus a set of gapped tracks, for both algorithms. That is how #26 was found, and it is the same suite a new algorithm has to pass before it can be registered.
