/**
 * One back-link component for the three install pages (#959).
 *
 * Settings, Timer check and Activity each used to find their own way back —
 * Activity had "← Back to settings" at the top, Timer check had an unstyled
 * "Back to System Settings" at the bottom, and Settings had neither. All
 * three now render this, top-left, and it has exactly three states:
 *
 * - a race is remembered (`readLastRace`, in `lastRace.ts`): "← Back to
 *   {race name}", linking straight back to it — the state every page wants
 *   once an operator has actually been in a race;
 * - no race is remembered, and the caller passed a `fallback` — the two
 *   sub-pages want "← Back to settings" in that case;
 * - no race is remembered and no `fallback` was passed — Settings itself has
 *   nowhere sensible to send an operator who arrived with no race in view
 *   (from Home, say), so this renders nothing, exactly as it does today.
 *
 * Read once at mount, not subscribed to storage: this is a fresh page on
 * every navigation, so a value read as the page loads is the right one, the
 * same "read at page load" shape the issue describes. A race deleted while
 * this exact page happens to be open is `Navigation.tsx`'s own job to
 * un-remember for the *next* page, not this component's to notice live.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@mdi/react';
import { mdiArrowLeft } from '@mdi/js';
import { readLastRace } from '../lastRace';

export interface BackLinkFallback {
  to: string;
  label: string;
}

const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: 'var(--scouting-blue)',
  fontSize: '0.85rem',
  marginBottom: '1rem',
} as const;

export default function BackLink({ fallback }: { fallback?: BackLinkFallback }) {
  const [remembered] = useState(() => readLastRace());

  if (remembered) {
    return (
      <Link to={`/race/${remembered.id}`} style={linkStyle} data-testid="back-link">
        <Icon path={mdiArrowLeft} size={0.7} /> Back to {remembered.name}
      </Link>
    );
  }

  if (fallback) {
    return (
      <Link to={fallback.to} style={linkStyle} data-testid="back-link">
        <Icon path={mdiArrowLeft} size={0.7} /> {fallback.label}
      </Link>
    );
  }

  return null;
}
