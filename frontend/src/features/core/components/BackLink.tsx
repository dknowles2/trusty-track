/**
 * One back-link component for the three install pages (#959, #1077).
 *
 * Settings, Timer check and Activity each used to find their own way back —
 * Activity had "← Back to settings" at the top, Timer check had an unstyled
 * "Back to System Settings" at the bottom, and Settings had neither. All
 * three now render this, top-left, and it has exactly three states, checked
 * in this order:
 *
 * - the router carries `state.from` (a path a caller navigated here with,
 *   set by `ReadinessStrip`'s "Check it" link from *inside* a race) — "←
 *   Back to {remembered race name}", linking straight back to that exact
 *   path. This has to outrank everything below it: it is the one signal
 *   that says where the operator's browser actually came from, rather than
 *   a guess built from a stored device-wide preference;
 * - otherwise, the caller passed a `destination` — Timer check and Activity
 *   are reachable only from Settings (a nav link, a `?section=` deep link,
 *   or a track card's `#timer-<id>` link), so they always want "← Back to
 *   settings" here, a race remembered from an earlier tab or an earlier
 *   session notwithstanding (#1077 — before this, `readLastRace()` won
 *   unconditionally, so once an operator had been in any race this
 *   session, "Back to settings" was unreachable from either sub-page even
 *   though Settings was the only place either is linked from);
 * - otherwise, a race is remembered (`readLastRace`, in `lastRace.ts`): "←
 *   Back to {race name}" — this is Settings' own case, since Settings is
 *   reachable with no race in view (from Home, say) and has no fixed
 *   `destination` of its own to fall back to;
 * - none of the above — Settings again, with no race remembered and
 *   nowhere sensible to send an operator, so this renders nothing, exactly
 *   as it does today.
 *
 * The remembered race is still read once at mount (`useState(() =>
 * readLastRace())`), not subscribed to storage: this is a fresh page on
 * every navigation, so a value read as the page loads is the right one. A
 * race deleted while this exact page happens to be open is `Navigation.tsx`'s
 * own job to un-remember for the *next* page, not this component's to
 * notice live.
 */

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '@mdi/react';
import { mdiArrowLeft } from '@mdi/js';
import { readLastRace } from '../lastRace';

export interface BackLinkDestination {
  to: string;
  label: string;
}

interface BackLinkLocationState {
  /** Set by a Link that navigated here from inside a race — see
   *  `ReadinessStrip.tsx` — so this page can go back to the exact page the
   *  operator left rather than guessing from `readLastRace()`. */
  from?: string;
}

const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: 'var(--scouting-blue)',
  fontSize: '0.85rem',
  marginBottom: '1rem',
} as const;

export default function BackLink({ destination }: { destination?: BackLinkDestination }) {
  const location = useLocation();
  const [remembered] = useState(() => readLastRace());
  const from = (location.state as BackLinkLocationState | null)?.from;

  if (from) {
    return (
      <Link to={from} style={linkStyle} data-testid="back-link">
        <Icon path={mdiArrowLeft} size={0.7} /> Back to {remembered?.name ?? 'the race'}
      </Link>
    );
  }

  if (destination) {
    return (
      <Link to={destination.to} style={linkStyle} data-testid="back-link">
        <Icon path={mdiArrowLeft} size={0.7} /> {destination.label}
      </Link>
    );
  }

  if (remembered) {
    return (
      <Link to={`/race/${remembered.id}`} style={linkStyle} data-testid="back-link">
        <Icon path={mdiArrowLeft} size={0.7} /> Back to {remembered.name}
      </Link>
    );
  }

  return null;
}
