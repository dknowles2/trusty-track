# Race Scheduling Algorithms

This document describes the scheduling algorithms available in Trusty Track for Pinewood Derby races.

## 1. Lane Rotation (Perfect N-Stage)

**Goal:** Absolute Lane Neutrality.
**Best For:** Smaller packs or Den-level racing where fairness is the top priority.

### How it Works
Each racer runs exactly $N$ times, where $N$ is the number of lanes on the track. They rotate through every single lane once.

### The Algorithm
Given $P$ Participants and $L$ Lanes:
- Total Heats: $P$
- For any Heat $i$ (from 0 to $P-1$), the Participant assigned to Lane $j$ (from 0 to $L-1$) is the one at index $(i + j) \pmod P$ in the randomized roster.

### Example (4 Racers, 3 Lanes)
| Heat | Lane 1 | Lane 2 | Lane 3 |
| :--- | :--- | :--- | :--- |
| 1 | Racer A | Racer B | Racer C |
| 2 | Racer B | Racer C | Racer D |
| 3 | Racer C | Racer D | Racer A |
| 4 | Racer D | Racer A | Racer B |

**Social Variety:** Low. Racers often face the same opponents in multiple heats.

---

## 2. Partial Perfect Chart (PPC)

**Goal:** Lane Neutrality + Maximized Opponent Variety.
**Best For:** Large packs (50+ scouts) where you want participants to race against a wider variety of friends.

### How it Works
Uses combinatorial design (Balanced Incomplete Block Design) to ensure everyone races in every lane exactly once, while also facing as many different opponents as possible.

### The Algorithm (Greedy Optimization)
1. Fill Lane 1 with all participants in a randomized order.
2. For subsequent lanes, for each heat, select a participant who:
   - Has not yet raced in this specific lane.
   - Has not yet been assigned to this specific heat.
   - Has the lowest cumulative "Matchup Score" (number of times they've already faced the other participants in this heat).

**Social Variety:** High. Minimizes the number of times the same two racers face each other.

---

## Selecting an Algorithm in the UI

You can select the scheduling algorithm in the **Race Configuration** settings:

- **Lane Rotation (Perfect N):** Each racer runs once in every lane. Best for fairness.
- **Partial Perfect Chart (PPC):** High social variety; racers face many different opponents.
