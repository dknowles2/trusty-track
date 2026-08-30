/**
 * A certificate, one per award (#306).
 *
 * Not a `DocumentSpec`: those are card geometry — `widthIn`, `columns`,
 * `perSheet` — for a document repeated to a grid, and a certificate is one
 * full-page document, the same shape problem the heat sheet had. This is its
 * sibling: its own pure module, sharing only the print stylesheet with
 * everything else in `printables/`.
 *
 * Sheet-first, same as the pit passes: nobody prints one certificate at a
 * time, they print the whole run before the ceremony. One certificate is
 * built per *award*, not per racer — an award nobody has decided yet still
 * gets one, printed with the winner's line left blank, the same choice the
 * results sheet's award lines make and for the same reason: skipping it would
 * mean reprinting the whole batch the moment judging finishes.
 *
 * Pure. What goes on a certificate, and which awards are worth printing, are
 * decisions worth testing without a browser.
 */

import { formatDisplayName, type NameDisplay } from '../core/displayName';

export interface CertificateAward {
  id: number;
  name: string;
  kind: string;
  sortOrder?: number | null;
  /** Which clipart to draw, or null for a plain certificate. */
  artworkKey?: string | null;
  recipient?: {
    firstName: string;
    lastName: string;
    carNumber?: number | null;
  } | null;
}

export interface CertificateRace {
  name: string;
  dateTime?: string | null;
  location?: string | null;
}

export interface Certificate {
  awardId: number;
  awardName: string;
  /** The recipient's name, or null when nobody has been decided yet. */
  recipientName: string | null;
  artworkKey: string | null;
  raceName: string;
}

function recipientName(
  award: CertificateAward,
  nameDisplay: NameDisplay | string,
): string | null {
  if (!award.recipient) return null;
  const name = formatDisplayName(nameDisplay, award.recipient.firstName, award.recipient.lastName);
  if (!name) return null;
  return award.recipient.carNumber == null ? name : `${name} (#${award.recipient.carNumber})`;
}

/**
 * One certificate per award, in the ceremony's own running order.
 *
 * Same ordering the ceremony and the operator's list use — `sortOrder` then
 * `id` — so a stack of printed certificates comes off in the order they get
 * handed out, and the operator does not have to resort a stack of paper to
 * match a running order they already set up.
 */
export function certificatesFor(
  race: CertificateRace,
  awards: readonly CertificateAward[],
  /** How much of the recipient's name a certificate prints (#552). Defaults
   * to `'FULL'`, today's only behaviour. */
  nameDisplay: NameDisplay | string = 'FULL',
): Certificate[] {
  return [...awards]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((award) => ({
      awardId: award.id,
      awardName: award.name,
      recipientName: recipientName(award, nameDisplay),
      artworkKey: award.artworkKey ?? null,
      raceName: race.name,
    }));
}
