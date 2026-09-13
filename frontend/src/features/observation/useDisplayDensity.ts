/**
 * The React wiring around `displayDensity.ts`'s pure rule (#1073 part 2) —
 * `densityFor` takes a plain number so it is trivial to sweep in a test;
 * this hook is the only thing that reads `window.innerWidth` and keeps it
 * current across a resize. A display's window is not resized while an event
 * is running in practice, but the Displays panel's own live preview and a
 * developer's browser both are.
 */

import { useEffect, useState } from 'react';
import { densityFor, type DisplayDensity } from './displayDensity';

function currentWidth(): number {
    return typeof window !== 'undefined' ? window.innerWidth : 1920;
}

export function useDisplayDensity(): DisplayDensity {
    const [width, setWidth] = useState(currentWidth);

    useEffect(() => {
        const onResize = () => setWidth(currentWidth());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return densityFor(width);
}
