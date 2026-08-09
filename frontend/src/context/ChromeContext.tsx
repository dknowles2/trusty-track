/**
 * Whether the app's own furniture should be on screen (#175).
 *
 * `Navigation` used to decide this by reading `?projector=true` off the URL,
 * which was right while a display's view came only from its URL. Once a screen
 * could be *assigned* a view (#174) it stopped being right: an operator
 * switching a display to Projector from across the room got projector mode
 * with the navigation bar still painted across the top of it, because nothing
 * in the URL had changed. The slideshow would have arrived with the same bug.
 *
 * The alternative was to have the display rewrite its own URL when assigned,
 * which sounds tidier and is worse: the URL is the *fallback* the assignment
 * overrides, so writing to it means a reload briefly shows whatever the screen
 * was last told before the socket catches up.
 *
 * So the full-screen view says so, and the chrome listens. Deliberately not a
 * general "layout" context — it answers one question.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ChromeContextValue {
    /** True while a full-screen view is up. */
    hidden: boolean;
    setHidden: (hidden: boolean) => void;
}

const ChromeContext = createContext<ChromeContextValue>({
    hidden: false,
    setHidden: () => {},
});

export function ChromeProvider({ children }: { children: ReactNode }) {
    const [hidden, setHiddenState] = useState(false);
    const setHidden = useCallback((next: boolean) => setHiddenState(next), []);
    const value = useMemo(() => ({ hidden, setHidden }), [hidden, setHidden]);
    return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useChrome(): ChromeContextValue {
    return useContext(ChromeContext);
}
