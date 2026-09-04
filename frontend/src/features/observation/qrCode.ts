/**
 * What the `QRCODE` display view points at, and what it says (#614).
 *
 * Pure, like the other display rules in this directory (`recordBreak.ts`,
 * `resultsOverlay.ts`): a screen's own render only calls this and
 * `features/core/shareAddress.ts`'s `shareUrl`, so there is one place the
 * path and the headline text are decided rather than each caller working it
 * out inline.
 */

import type { QRTarget } from './displayView';

/** The path (no origin) this target opens, for `shareUrl`'s `path` argument.
 *
 * A closed set of two rather than an arbitrary URL — the same reasoning
 * `backend/api/main.py::voting_qr`'s allowed-paths list gives: a display
 * holds no PIN (#15), and this is not a way to point a kiosk at anything. */
export function qrTargetPath(target: QRTarget, raceId: number): string {
  return target === 'VOTE' ? `/race/${raceId}/vote` : `/race/${raceId}/observation`;
}

/** The call-to-action shown above the code when the race has not set its
 * own — DerbyNet's own kiosk names these two cases directly ("Scan to Vote
 * for Best in Show!", "Live Race Results on Your Phone"). */
export function defaultQrHeadline(target: QRTarget): string {
  return target === 'VOTE' ? 'Scan to Vote for Awards' : 'Live Race Results on Your Phone';
}

/** The race's own headline if it set one, otherwise the derived default.
 *
 * `customHeadline` arrives as `race.qrHeadline` — null, or an empty string
 * once an operator has explicitly cleared it back to the default (the
 * backend's `qr_headline`/`qr_wifi_note` fields treat an empty string as
 * "unset" rather than needing a separate clear flag, since neither field
 * has a legitimate empty-string value of its own) — so both are treated the
 * same way here rather than only checking for `null`. */
export function resolveQrHeadline(
  customHeadline: string | null | undefined,
  target: QRTarget,
): string {
  const trimmed = customHeadline?.trim();
  return trimmed ? trimmed : defaultQrHeadline(target);
}
