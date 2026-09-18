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
 * holds no PIN (#15), and this is not a way to point a kiosk at anything.
 *
 * The `STANDINGS` (Live) target can carry `?spectator=1`
 * ([#1182](https://github.com/dknowles2/trusty-track/issues/1182)): a phone
 * that reached this page by scanning the wall's code is a spectator, not a
 * screen the operator meant to register — `Observation.tsx` reads the flag
 * to skip the `displayAssignment` subscription that is what actually makes
 * a tab appear in the Displays list. The vote target is untouched; a ballot
 * has no such registration to opt out of.
 *
 * `spectator` is **required**, not defaulted, deliberately: this path has
 * exactly two callers today with opposite answers — `QRCodeDisplayView.tsx`
 * (`true`, the audience-facing code a parent's phone scans) and
 * `ConnectDisplayAddress.tsx` (`false`, the Displays panel's own "connect a
 * genuinely new wall display or check-in tablet" address, `ops.md`'s "Race
 * Control → Displays gets the same address") — and a default silently
 * handing a third, future caller one of those two answers is exactly the
 * shape of bug ConnectDisplayAddress's own call was caught needing to avoid
 * by hand. Forcing the choice turns a silent behaviour change into a type
 * error instead. */
export function qrTargetPath(
  target: QRTarget,
  raceId: number,
  opts: { spectator: boolean },
): string {
  if (target === 'VOTE') return `/race/${raceId}/vote`;
  return opts.spectator ? `/race/${raceId}/observation?spectator=1` : `/race/${raceId}/observation`;
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
