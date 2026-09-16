/**
 * Race Control's own camera badges (#177 stage 1b) — "Finish line —
 * connected, last clip 2s ago", one per registered camera, so an operator
 * does not have to open the Displays page to know whether a camera is
 * actually listening.
 *
 * Reads the same `displays` query/subscription pair `DisplaysPanel.tsx`
 * already does, filtered to `role: 'CAMERA'` — a second, lighter query was
 * considered and rejected, since every camera is already a `Display` row
 * and `test_query_counts.py`'s own reasoning is "reuse a loader, don't add
 * a second query for the identical data."
 */

import { useQuery, useSubscription } from 'urql';
import { Icon } from '@mdi/react';
import { mdiVideo, mdiVideoOff } from '@mdi/js';
import { DISPLAYS_QUERY, DisplaysSubscription } from '../graphql/queries';

interface CameraRow {
    displayId: string;
    name: string;
    role: 'DISPLAY' | 'CAMERA';
    connected: boolean;
    trackId: number | null;
    lastClipAt: string | null;
}

/** "2s ago" / "3m ago" — the same rounded-elapsed-time shape
 * `Camera.tsx`'s own status line and `DisplaysPanel.tsx`'s `agoText` use.
 * Kept as its own small copy rather than a shared import across three
 * files for one four-line function. */
function agoText(iso: string | null): string | null {
    if (!iso) return null;
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return null;
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 1) return 'just now';
    if (seconds === 1) return '1s ago';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return minutes === 1 ? '1m ago' : `${minutes}m ago`;
}

export default function CameraBadges({ raceId }: { raceId: number }) {
    const [queryResult] = useQuery({ query: DISPLAYS_QUERY, variables: { raceId }, pause: !raceId });
    const [liveResult] = useSubscription({ query: DisplaysSubscription, variables: { raceId }, pause: !raceId });
    const displays: CameraRow[] = liveResult.data?.displays ?? queryResult.data?.displays ?? [];
    const cameras = displays.filter((d) => d.role === 'CAMERA');

    if (cameras.length === 0) return null;

    return (
        <div
            data-testid="camera-badges"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}
        >
            {cameras.map((camera) => {
                const lastClip = agoText(camera.lastClipAt);
                return (
                    <span
                        key={camera.displayId}
                        data-testid={`camera-badge-${camera.displayId}`}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 10px',
                            borderRadius: '20px',
                            fontSize: '0.8rem',
                            background: camera.connected ? 'var(--surface-strong-color)' : 'var(--surface-faint-color)',
                            color: camera.connected ? 'var(--text-color)' : 'var(--text-placeholder-color)',
                            border: '1px solid var(--border-color)',
                        }}
                    >
                        <Icon path={camera.connected ? mdiVideo : mdiVideoOff} size={0.65} />
                        {camera.name}
                        {' — '}
                        {camera.connected ? 'connected' : 'not connected'}
                        {lastClip ? `, last clip ${lastClip}` : ''}
                    </span>
                );
            })}
        </div>
    );
}
