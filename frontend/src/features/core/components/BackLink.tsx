/**
 * One back-link component for the three install pages (#959, #1077).
 *
 * Settings, Timer check and Activity each used to find their own way back —
 * Activity had "← Back to settings" at the top, Timer check had an unstyled
 * "Back to System Settings" at the bottom, and Settings had neither. All
 * three now render this, top-left, and it has exactly three states, checked
 * in this order:
 *
 * - the router carries a same-app `state.from` (a path a caller navigated
 *   here with, set by `ReadinessStrip`'s "Check it" link from *inside* a
 *   race) — "← Back to {name}", linking straight back to that exact path.
 *   This has to outrank everything below it: it is the one signal that says
 *   where the operator's browser actually came from, rather than a guess
 *   built from a stored device-wide preference. Anything that is not a
 *   same-app absolute path — a string starting with `/` and *not* `//` — is
 *   ignored rather than trusted: `state` is whatever the router history
 *   entry happens to carry, not something this component controls, and a
 *   bad value must fall through rather than be handed to `<Link to>`.
 *   `//evil.example.com` passes a bare `startsWith('/')` check (it is
 *   protocol-relative, not path-relative) and `<Link to="//...">` renders
 *   an `href` the browser reads as cross-origin — caught in review on
 *   #1107 before it shipped. The *name* in that label still comes from
 *   `readLastRace()` (`lastRace.ts`), which is per-*device* storage rather
 *   than per-tab, and is only trusted when its remembered race id actually
 *   matches the one in `from` — a second tab open on a *different* race
 *   must not have this tab borrow that race's name (caught in review on
 *   #1107: the label and the link target were reading two different
 *   sources with no check that they agreed);
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
   *  operator left rather than guessing from `readLastRace()`. Trusted only
   *  when it is a string rooted at `/`; anything else is treated as absent. */
  from?: unknown;
}

const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: 'var(--scouting-blue)',
  fontSize: '0.85rem',
  marginBottom: '1rem',
} as const;

/** The race id embedded in a race-scoped path (`/race/7` or `/race/7/...`),
 *  or null if the path names something else. Used only to check that
 *  `readLastRace()`'s remembered race is actually the one `from` points at
 *  before borrowing its name for the label. */
function raceIdFromPath(path: string): number | null {
  const match = /^\/race\/(\d+)(?:[/?#]|$)/.exec(path);
  return match ? Number(match[1]) : null;
}

export default function BackLink({ destination }: { destination?: BackLinkDestination }) {
  const location = useLocation();
  const [remembered] = useState(() => readLastRace());
  const state = location.state as BackLinkLocationState | null;
  const from =
    typeof state?.from === 'string' && state.from.startsWith('/') && !state.from.startsWith('//')
      ? state.from
      : undefined;

  if (from) {
    const label = remembered && remembered.id === raceIdFromPath(from) ? remembered.name : 'the race';
    return (
      <Link to={from} style={linkStyle} data-testid="back-link">
        <Icon path={mdiArrowLeft} size={0.7} /> Back to {label}
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
