/**
 * Reading a Slowest Race round's standings the way the room reads them.
 *
 * The leaderboard always ranks lower-is-better, which for a Slowest Race
 * bracket crowns exactly the wrong car: rank 1 would be the *fastest* of the
 * slow cars, and the trophy belongs to the last one down the track. This is a
 * display rule, not a scoring one — the stored standings stay honest, and
 * anything that chains off the round keeps reading them best-first.
 *
 * Pure, because the interesting part is who ends up first, and getting a
 * reversal wrong is the kind of thing that looks fine with three test racers.
 */

interface Rankable {
  score: number;
  heatsCompleted: number;
  rank: number;
}

/**
 * The entries with the slowest recorded car first, ranks restamped to match.
 *
 * Racers with no recorded result keep their place at the end — a car that
 * never ran is not the slowest car — and keep strictly increasing ranks after
 * the raced ones, exactly as the ordinary standings treat them.
 *
 * "Tied" is read off the server's own `rank`, not recomputed from `score`
 * (#540). Before a tiebreaker existed the two questions had the same answer
 * — equal score meant equal rank, always — so re-deriving it here cost
 * nothing. A resolved pair breaks that: the tiebreak chain can separate two
 * rows with the *same* score into different ranks, and a version of this
 * function that still asked "same score?" would silently re-merge them back
 * onto one shared rank the moment they came in reversed, undoing the
 * resolution this screen is supposed to be showing.
 */
export function slowestFirst<T extends Rankable>(entries: T[]): T[] {
  const raced = entries.filter((e) => e.heatsCompleted > 0);
  const unraced = entries.filter((e) => e.heatsCompleted === 0);

  const reversed = [...raced].reverse();
  const restamped: T[] = [];
  for (let i = 0; i < reversed.length; i++) {
    const tied = i > 0 && reversed[i].rank === reversed[i - 1].rank;
    restamped.push({
      ...reversed[i],
      rank: tied ? restamped[i - 1].rank : i + 1,
    });
  }

  let next = restamped.length;
  return restamped.concat(unraced.map((e) => ({ ...e, rank: ++next })));
}
