/**
 * The React wiring around `sheetScale.ts` (#1142) — the same split
 * `raceFlow.ts`/`useRaceFlow.ts` and `imageEdit.ts`/`ImageCropModal.tsx` draw
 * between a pure rule and the DOM measurement that feeds it.
 *
 * Two elements, two different jobs:
 *
 * - `wrapRef` is a plain block that fills whatever width its own container
 *   gives it — the space actually available for the sheet.
 * - `sheetRef` is the sheet itself, and it must be `display: inline-grid`
 *   (or otherwise shrink-to-fit) rather than the ordinary `display: grid` a
 *   full-width block would use. A shrink-to-fit box's own `offsetWidth` is
 *   always its *natural* size — the space its content actually needs —
 *   never the space a narrower container happens to give it. That is
 *   exactly the distinction this bug needed: a `display: grid` sheet's own
 *   box is only ever as wide as its container, with `justify-content:
 *   center` centring the (wider) content *inside* that too-narrow box, so
 *   the overflow spills evenly off both edges and the left column ends up
 *   unreachable. `offsetWidth`/`offsetHeight` are used rather than
 *   `getBoundingClientRect()` for a second reason: they are layout
 *   measurements, unaffected by the very `transform: scale()` this hook
 *   goes on to apply to the same element — reading the *painted*,
 *   already-scaled box back would feed a shrunk number into `scaleFor` a
 *   second time.
 *
 * Both are **callback refs that measure and observe from inside the
 * callback itself**, not the `useRef` object plus `useLayoutEffect` pair
 * `ImageCropModal.tsx` uses for its own container — deliberately, for two
 * reasons together:
 *
 * 1. This page renders a `Loading…` paragraph in place of the whole sheet
 *    until its query resolves, so the wrap and sheet elements do not exist
 *    on the render that mounts this component. A `useRef` object never
 *    changes identity when its target later appears, so an effect keyed on
 *    `[]` fires once, while both refs are still `null`, and never runs
 *    again once the real sheet mounts. A callback ref fires exactly when
 *    the DOM node it is attached to appears or disappears, however deep in
 *    a conditional it is.
 * 2. `react-hooks`' `set-state-in-effect` rule (part of the React
 *    Compiler-oriented rules this project's `eslint.config.js` pulls in)
 *    flags a `useLayoutEffect`/`useEffect` body that reduces to nothing but
 *    a conditional `setState` call — the shape a `useState`-backed callback
 *    ref (`const [el, setEl] = useState(...)`, then measuring in a
 *    `useEffect` keyed on `el`) takes once reason 1 above rules out
 *    `useRef`. It does not flag the same measurement done directly inside
 *    the ref callback itself, which is also the more direct fix: nothing
 *    here needs `el` as a piece of React *state* at all, only as a value to
 *    read once, at the moment it attaches.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { scaleFor } from './sheetScale';

export interface SheetScale {
    wrapRef: (el: HTMLDivElement | null) => void;
    sheetRef: (el: HTMLDivElement | null) => void;
    /** `1` until something has been measured, or whenever the sheet already
     * fits — never above `1`. */
    scale: number;
    /** The sheet's own unscaled height, in pixels — what the wrapper
     * reserves (times `scale`) so the page below it does not overlap a
     * shrunk sheet the browser still thinks is full height. */
    naturalHeight: number;
}

/** Measures `el.offsetWidth`/`offsetHeight` immediately, then again on every
 * subsequent resize — of `el` itself, not just the window, since the sheet
 * is shrink-to-fit and its own natural size changes when the operator picks
 * a different document or the roster spills onto another sheet of paper.
 * Returns the observer so the ref callback can disconnect the *previous*
 * element's before attaching to a new one. */
function observe(
    el: HTMLDivElement,
    onMeasure: (width: number, height: number) => void,
): ResizeObserver | null {
    onMeasure(el.offsetWidth, el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return null;
    const observer = new ResizeObserver(() => onMeasure(el.offsetWidth, el.offsetHeight));
    observer.observe(el);
    return observer;
}

export function useSheetScale(): SheetScale {
    const [containerWidth, setContainerWidth] = useState(0);
    const [natural, setNatural] = useState({ width: 0, height: 0 });
    const wrapObserver = useRef<ResizeObserver | null>(null);
    const sheetObserver = useRef<ResizeObserver | null>(null);

    const wrapRef = useCallback((el: HTMLDivElement | null) => {
        wrapObserver.current?.disconnect();
        wrapObserver.current = el ? observe(el, (width) => setContainerWidth(width)) : null;
    }, []);

    const sheetRef = useCallback((el: HTMLDivElement | null) => {
        sheetObserver.current?.disconnect();
        sheetObserver.current = el
            ? observe(el, (width, height) => setNatural({ width, height }))
            : null;
    }, []);

    // Belt and braces for a component that unmounts without its ref
    // callbacks ever firing with `null` first (React does call them on
    // unmount, but nothing here should rely on that for correctness).
    useEffect(
        () => () => {
            wrapObserver.current?.disconnect();
            sheetObserver.current?.disconnect();
        },
        [],
    );

    return {
        wrapRef,
        sheetRef,
        scale: scaleFor(containerWidth, natural.width),
        naturalHeight: natural.height,
    };
}
