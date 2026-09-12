/**
 * "Which screen shows what" — the race navigation row's own page (#958).
 *
 * It used to be a sub-tab under Race Control, two clicks from the row an
 * operator actually lands on, while its other half — launching Live itself —
 * sat on the Live page instead. Moving it into the race row, in the slot Live
 * used to occupy, puts every "which screen shows what" control (the
 * registry, assignment, scenes, and the two shortcuts to launch Live and
 * Projector Mode) on one page. `DisplaysPanel` and `ScenesPanel` are
 * unchanged — this is a route move, not a rewrite of either.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import DisplaysPanel from '../components/DisplaysPanel';
import ScenesPanel from '../components/ScenesPanel';

export default function DisplaysPage() {
  const { raceId } = useParams<{ raceId: string }>();
  const id = parseInt(raceId || '0');

  // Whether any audience display is known for this race (#850) — read off
  // `DisplaysPanel`, which already asks the question for its own list,
  // rather than a second query here answering the same thing. Drives
  // whether Scenes is offered as live.
  const [hasDisplays, setHasDisplays] = useState(false);

  return (
    <div className="container" style={{ padding: '20px' }}>
      <h1 style={{ margin: '0 0 20px' }}>Displays</h1>
      {/* Displays leads (#850): it is the thing that is actually there — the
          operator's live list of screens, and the address to give a screen
          that has not connected yet — where Scenes is a power tool for
          reconfiguring several of them at once and has nothing to do until
          at least one exists. */}
      <div style={{ maxWidth: '900px', margin: '0 auto', width: '100%' }}>
        <DisplaysPanel raceId={id} onDisplaysChange={setHasDisplays} />
        <ScenesPanel raceId={id} disabled={!hasDisplays} />
      </div>
    </div>
  );
}
