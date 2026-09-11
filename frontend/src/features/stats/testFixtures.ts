/**
 * Leaderboard fixtures shared across the stats slice's component tests.
 *
 * `Leaderboard.test.tsx` and `Standings.test.tsx` each carried their own copy
 * of essentially this fixture, and the copies had already drifted from one
 * another. One shared fixture is what stops that happening again.
 *
 * `tiedLeaderboardEntries` gives two racers the same rank on purpose — no
 * fixture anywhere in the stats slice exercised the #226 tie rendering
 * (shared rank, both medalled) before this, so a regression there had no
 * component-level guard.
 */
import type { LeaderboardEntry } from './components/Leaderboard';

export const twoRacerLeaderboardEntries: LeaderboardEntry[] = [
  {
    racerId: 1,
    firstName: 'John',
    lastName: 'Doe',
    carNumber: 101,
    racingGroupName: 'Tigers',
    score: 3.5,
    heatsCompleted: 1,
    rank: 1,
    racerImageUrl: 'http://example.com/racer.jpg',
  },
  {
    racerId: 2,
    firstName: 'Jane',
    lastName: 'Smith',
    carNumber: 102,
    racingGroupName: 'Wolves',
    score: 4.2,
    heatsCompleted: 1,
    rank: 2,
  },
];

/** Four racers, ranks 1 through 4 (#941): the top three get a podium
 *  accent, the fourth does not. */
export const podiumLeaderboardEntries: LeaderboardEntry[] = [
  {
    racerId: 1,
    firstName: 'Zack',
    lastName: 'Zoom',
    carNumber: 300,
    racingGroupName: 'Wolves',
    score: 3.064,
    heatsCompleted: 3,
    rank: 1,
  },
  {
    racerId: 2,
    firstName: 'Coco',
    lastName: 'Quick',
    carNumber: 401,
    racingGroupName: 'Bears',
    score: 3.115,
    heatsCompleted: 3,
    rank: 2,
  },
  {
    racerId: 3,
    firstName: 'Gus',
    lastName: 'Shift',
    carNumber: 403,
    racingGroupName: 'Bears',
    score: 3.139,
    heatsCompleted: 3,
    rank: 3,
  },
  {
    racerId: 4,
    firstName: 'Kit',
    lastName: 'Quick',
    carNumber: 402,
    racingGroupName: 'Bears',
    score: 3.140,
    heatsCompleted: 3,
    rank: 4,
  },
];

/** Two racers tied for first (#226): same rank, different racers. */
export const tiedLeaderboardEntries: LeaderboardEntry[] = [
  {
    racerId: 1,
    firstName: 'John',
    lastName: 'Doe',
    carNumber: 101,
    racingGroupName: 'Tigers',
    score: 3.5,
    heatsCompleted: 1,
    rank: 1,
  },
  {
    racerId: 2,
    firstName: 'Jane',
    lastName: 'Smith',
    carNumber: 102,
    racingGroupName: 'Wolves',
    score: 3.5,
    heatsCompleted: 1,
    rank: 1,
  },
];
