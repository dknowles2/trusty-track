/**
 * The React wiring around `displayDensity.ts`'s pure rule (#1073 part 2) —
 * `densityFor` takes plain numbers so it is trivial to sweep in a test; this
 * hook is the only thing that reads `window.innerWidth`/`innerHeight` and
 * keeps them current across a resize. A display's window is not resized
 * while an event is running in practice, but the Displays panel's own live
 * preview and a developer's browser both are.
 *
 * `laneCount` is the caller's own — the track's configured lane count, not
 * something this hook can read off the window — since how dense a heat
 * card's own grid needs to be depends on it as much as the viewport does
 * (an 8-lane track needs a smaller tier than a 6-lane one at the identical
 * size). Passed straight through to `densityFor` on every render.
 */

import { useEffect, useState } from 'react';
import { densityFor, isPhoneWidth, type DisplayDensity } from './displayDensity';

function currentViewport(): { width: number; height: number } {
    if (typeof window === 'undefined') return { width: 1920, height: 1080 };
    return { width: window.innerWidth, height: window.innerHeight };
}

export function useDisplayDensity(laneCount: number): DisplayDensity {
    const [viewport, setViewport] = useState(currentViewport);

    useEffect(() => {
        const onResize = () => setViewport(currentViewport());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return densityFor(viewport.width, viewport.height, laneCount);
}

/**
 * The bare phone-tier boolean (#1144), for a caller with no lane count of
 * its own to hand `useDisplayDensity` — `AwardCeremony.tsx` shows no heat
 * cards and has no track loaded at all by the time it first renders. Reads
 * the identical `window.innerWidth` this file's other hook already does,
 * kept as a second small hook rather than a `laneCount?: number` default on
 * `useDisplayDensity` itself: this caller does not want the rest of
 * `DisplayDensity`'s shape, and a default lane count here would be a made-up
 * number with nothing to justify any particular value.
 */
export function usePhoneTier(): boolean {
    const [width, setWidth] = useState(() => currentViewport().width);

    useEffect(() => {
        const onResize = () => setWidth(currentViewport().width);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return isPhoneWidth(width);
}
