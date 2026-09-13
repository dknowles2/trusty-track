/**
 * The React wiring around `displayDensity.ts`'s pure rule (#1073 part 2) —
 * `densityFor` takes plain numbers so it is trivial to sweep in a test; this
 * hook is the only thing that reads `window.innerWidth`/`innerHeight` and
 * keeps them current across a resize. A display's window is not resized
 * while an event is running in practice, but the Displays panel's own live
 * preview and a developer's browser both are.
 */

import { useEffect, useState } from 'react';
import { densityFor, type DisplayDensity } from './displayDensity';

function currentViewport(): { width: number; height: number } {
    if (typeof window === 'undefined') return { width: 1920, height: 1080 };
    return { width: window.innerWidth, height: window.innerHeight };
}

export function useDisplayDensity(): DisplayDensity {
    const [viewport, setViewport] = useState(currentViewport);

    useEffect(() => {
        const onResize = () => setViewport(currentViewport());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return densityFor(viewport.width, viewport.height);
}
