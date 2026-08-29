/**
 * Stepping through the awards in front of a room (#170).
 *
 * Separate from the audience display's cycling views on purpose. Standings and
 * timing rotate on a timer because nobody is driving them; an award ceremony is
 * paced by whoever is holding the microphone, and a screen that moved on by
 * itself would announce the next trophy over the applause for the last one.
 *
 * Pure, so the stepping rules can be tested without a screen and so the same
 * sentences the operator sees are the ones the audience sees.
 */

import {
  NamedRacingGroup,
  NamedRound,
  describeSpeedAward,
  racerLabel,
} from './awardText';

export interface CeremonyAward {
  id: number;
  name: string;
  kind: string;
  source?: string | null;
  place?: number | null;
  racingGroupId?: number | null;
  fromBottom?: boolean | null;
  artworkKey?: string | null;
  recipient?: {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
    racerImageUrl?: string | null;
  } | null;
}

export interface Slide {
  awardId: number;
  /** The trophy's name — the big text. */
  title: string;
  /** What it is for: "Fastest in Wolves", "Chosen by the judges". */
  subtitle: string;
  /** The winner's name, or null when there is nobody to announce. */
  winner: string | null;
  racerImageUrl: string | null;
  /** Which clipart to draw, or null for a plain slide (#306). */
  artworkKey: string | null;
  /** "3 of 8", for the operator's benefit rather than the audience's. */
  position: string;
}

/**
 * Move through the ceremony, clamped at both ends.
 *
 * Deliberately does not wrap. Wrapping past the last award puts the first one
 * back on the screen, which in a room reads as "we are starting again" rather
 * than "that was the end" — and the last slide is the one that should still be
 * up while people are taking photographs.
 */
export function stepIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(current + delta, 0), total - 1);
}

/**
 * What to put on the screen for one award.
 *
 * An award with no winner is still a slide. Most stay unresolved until the very
 * end of an event, and an announcer reading "Best Paint — and the winner is…"
 * off a screen that skipped it would be worse than one that says so.
 */
export function slideFor(
  awards: CeremonyAward[],
  index: number,
  rounds: NamedRound[],
  racingGroups: NamedRacingGroup[],
): Slide | null {
  const award = awards[index];
  if (!award) return null;

  return {
    awardId: award.id,
    title: award.name,
    subtitle:
      award.kind === 'SPEED'
        ? describeSpeedAward(award, rounds, racingGroups)
        : 'Chosen by the judges',
    winner: award.recipient ? racerLabel(award.recipient) : null,
    racerImageUrl: award.recipient?.racerImageUrl ?? null,
    artworkKey: award.artworkKey ?? null,
    position: `${index + 1} of ${awards.length}`,
  };
}

/** Which key presses move the ceremony, and by how much. */
export function deltaForKey(key: string): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'Enter':
      return 1;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return -1;
    default:
      return null;
  }
}
