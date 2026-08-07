# Race Scheduling Algorithm

Trusty Track uses the **Partial Perfect Chart (PPC)** algorithm for scheduling race heats. This algorithm is designed to ensure maximum fairness and variety for all participants.

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

## Technical Implementation
The algorithm lives in `backend/domain/scheduling.py` (`generate_ppc`), which is pure — it takes a list of racer IDs and a lane count, and imports no database code. `crud.generate_heats_for_round` decides who is in the field and persists the result.

Because it is pure, `backend/tests/test_domain_scheduling.py` exercises every racer count from 2 to 20 against every lane count from 2 to 8 with no fixtures, in about a second. That is how #26 was found.
