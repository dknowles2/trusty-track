# Race Scheduling Algorithm

Trusty Track uses the **Partial Perfect Chart (PPC)** algorithm for scheduling race heats. This algorithm is designed to ensure maximum fairness and variety for all participants.

## Partial Perfect Chart (PPC)

**Goal:** Lane Neutrality + Maximized Opponent Variety.
**Best For:** All race sizes.

### Benefits
- **Fairness:** Every racer runs in every lane exactly once.
- **Variety:** Racers face as many different opponents as possible during the race.
- **Social Engagement:** Maximizes the number of unique "matchups" between different scouts.

### How it Works
The PPC algorithm uses a greedy optimization strategy to balance lane usage and opponent variety:

1. **Randomized Start:** Lane 1 is filled with all participants in a randomized order.
2. **Greedy Optimization:** For subsequent lanes, for each heat, the algorithm selects a participant who:
   - Has not yet raced in this specific lane.
   - Has not yet been assigned to this specific heat.
   - Has the lowest cumulative "Matchup Score" (number of times they've already faced the other participants already assigned to this heat).
3. **Fallback:** If no candidate meets all primary criteria (e.g., in very small races), the algorithm prioritizes ensuring everyone gets to race over the matchup score.

### Example
In a race with 4 racers and 4 lanes:
- Every racer will appear in one heat for each of the 4 lanes.
- The algorithm ensures that you don't keep racing against the same person in every heat.

---

## Technical Implementation
The implementation can be found in `backend/crud.py` under the `_generate_ppc` function. It maintains a matchup matrix to track how many times racers have faced each other and uses this to make optimal assignments for each heat.
