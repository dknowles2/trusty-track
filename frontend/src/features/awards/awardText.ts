/**
 * Saying in words what an award is for (#170).
 *
 * A stored award is `{source: "ROUND:4", place: 1, racingGroupId: 3}`, which is exactly
 * the wrong thing to show somebody deciding which trophies their pack gives
 * out. This turns it into "Winner of Finals — Wolves".
 *
 * Pure and separate from the screen for the usual reason: it is a rule about
 * the vocabulary, it has edge cases worth pinning (11th, 12th, 13th), and the
 * presentation display will want the same sentences the operator screen shows.
 */

import { formatDisplayName, type NameDisplay } from '../core/displayName';

export const ALL_SOURCE = 'ALL';

export interface NamedRound {
  id: number;
  name?: string | null;
  roundNumber: number;
}

export interface NamedRacingGroup {
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
  if (source === ALL_SOURCE) return 'Overall standings';
  const round = rounds.find((r) => `ROUND:${r.id}` === source);
  return round ? roundLabel(round) : 'A round that no longer exists';
}

export interface SpeedAwardParts {
  source?: string | null;
  place?: number | null;
  racingGroupId?: number | null;
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
  racingGroups: NamedRacingGroup[],
  /** The lowercase racing-group word, for the "no longer exists" fallback.
   * Defaults to the built-in Scouting one (#496 stage 4). */
  groupWord = 'den',
): string {
  if (!award.source || !award.place) {
    // A row missing its rule. The backend resolves it to nobody rather than
    // raising, and this says so rather than rendering "undefined".
    return 'Not set up — this award cannot be won';
  }

  const position = positionLabel(award.place, award.fromBottom ?? false);
  const where =
    award.source === ALL_SOURCE ? 'overall' : `in ${sourceLabel(award.source, rounds)}`;

  const racingGroup = award.racingGroupId ? racingGroups.find((d) => d.id === award.racingGroupId) : undefined;
  if (award.racingGroupId && !racingGroup) return `${position} ${where} — a ${groupWord} that no longer exists`;
  if (racingGroup) return `${position} in ${racingGroup.name}`;

  return `${position} ${where}`;
}

/** A racer's name for a list: "Ada Lovelace (#42)".
 *
 * `nameDisplay` defaults to `'FULL'` — this helper is shared by the
 * operator's recipient picker (`AwardForm.tsx`) and management list
 * (`Awards.tsx`), neither of which may abbreviate (#552), and by the
 * audience-facing ceremony slide (`ceremony.ts`), which is the one caller
 * that passes the race's resolved setting through. */
export function racerLabel(
  racer: {
    firstName: string;
    lastName: string;
    carNumber?: number | null;
  },
  nameDisplay: NameDisplay | string = 'FULL',
): string {
  const name = formatDisplayName(nameDisplay, racer.firstName, racer.lastName);
  return racer.carNumber ? `${name} (#${racer.carNumber})` : name;
}

export interface TalliedCar {
  carNumber?: number | null;
  carName?: string | null;
}

/**
 * What a car in a vote tally is called, for the operator screen — never a
 * child's name, the same anonymity the ballot page itself keeps.
 */
export function carLabel(
  racer?: TalliedCar | null,
  /** The lowercase vehicle word, for the "removed"/"unnumbered" fallbacks.
   * Defaults to the built-in Scouting one (#551). */
  vehicleWord = 'car',
): string {
  if (!racer) return `A ${vehicleWord} that has since been removed`;
  const number = racer.carNumber != null ? `#${racer.carNumber}` : `Unnumbered ${vehicleWord}`;
  return racer.carName ? `${number} — ${racer.carName}` : number;
}

export interface BallotCar {
  id: number;
  carNumber?: number | null;
}

/**
 * Car number ascending, unnumbered last — the same shape
 * `printables/documents.ts`'s `inPrintOrder` uses, but with nothing to fall
 * back to but the id: the ballot never has a racer's name to sort by.
 */
export function forBallot<T extends BallotCar>(cars: T[]): T[] {
  return [...cars].sort((a, b) => {
    const hasA = a.carNumber != null;
    const hasB = b.carNumber != null;
    if (hasA && hasB) return (a.carNumber as number) - (b.carNumber as number);
    if (hasA) return -1;
    if (hasB) return 1;
    return a.id - b.id;
  });
}
