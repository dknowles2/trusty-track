/**
 * Saying in words what an award is for (#170).
 *
 * A stored award is `{source: "ROUND:4", place: 1, denId: 3}`, which is exactly
 * the wrong thing to show somebody deciding which trophies their pack gives
 * out. This turns it into "Winner of Finals — Wolves".
 *
 * Pure and separate from the screen for the usual reason: it is a rule about
 * the vocabulary, it has edge cases worth pinning (11th, 12th, 13th), and the
 * presentation display will want the same sentences the operator screen shows.
 */

export const PACK_SOURCE = 'PACK';

export interface NamedRound {
  id: number;
  name?: string | null;
  roundNumber: number;
}

export interface NamedDen {
  id: number;
  name: string;
}

/** `1st`, `2nd`, `3rd`, `4th`… */
export function ordinal(place: number): string {
  // 11th, 12th and 13th are the exceptions the naive rule gets wrong, and a
  // pack big enough to award 11th place is a pack big enough to notice.
  const remainderOfHundred = place % 100;
  if (remainderOfHundred >= 11 && remainderOfHundred <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

/** A round's display name, falling back to its number. */
export function roundLabel(round: NamedRound): string {
  return round.name?.trim() || `Round ${round.roundNumber}`;
}

/** The label for a source in a picker: "Overall standings" or a round's name. */
export function sourceLabel(source: string, rounds: NamedRound[]): string {
  if (source === PACK_SOURCE) return 'Overall standings';
  const round = rounds.find((r) => `ROUND:${r.id}` === source);
  return round ? roundLabel(round) : 'A round that no longer exists';
}

export interface SpeedAwardParts {
  source?: string | null;
  place?: number | null;
  denId?: number | null;
  fromBottom?: boolean | null;
}

/**
 * "Fastest", "3rd", "Slowest", "3rd slowest".
 *
 * First place is named rather than numbered in both directions, because that
 * is what an operator calls it — nobody announces "1st slowest".
 */
export function positionLabel(place: number, fromBottom = false): string {
  if (fromBottom) return place === 1 ? 'Slowest' : `${ordinal(place)} slowest`;
  return place === 1 ? 'Fastest' : ordinal(place);
}

/**
 * What a speed award is for, in a sentence.
 *
 * "Fastest overall", "2nd in Finals", "Slowest overall", "Fastest in Wolves".
 * Deliberately says *fastest* rather than *1st* for the winner: that is what
 * an operator calls it, and it reads better on the presentation screen.
 */
export function describeSpeedAward(
  award: SpeedAwardParts,
  rounds: NamedRound[],
  dens: NamedDen[],
): string {
  if (!award.source || !award.place) {
    // A row missing its rule. The backend resolves it to nobody rather than
    // raising, and this says so rather than rendering "undefined".
    return 'Not set up — this award cannot be won';
  }

  const position = positionLabel(award.place, award.fromBottom ?? false);
  const where =
    award.source === PACK_SOURCE ? 'overall' : `in ${sourceLabel(award.source, rounds)}`;

  const den = award.denId ? dens.find((d) => d.id === award.denId) : undefined;
  if (award.denId && !den) return `${position} ${where} — a den that no longer exists`;
  if (den) return `${position} in ${den.name}`;

  return `${position} ${where}`;
}

/** A racer's name for a list: "Ada Lovelace (#42)". */
export function racerLabel(racer: {
  firstName: string;
  lastName: string;
  carNumber?: number | null;
}): string {
  const name = `${racer.firstName} ${racer.lastName}`.trim();
  return racer.carNumber ? `${name} (#${racer.carNumber})` : name;
}
