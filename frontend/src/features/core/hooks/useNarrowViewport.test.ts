// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useNarrowViewport } from './useNarrowViewport';

/** Sets `window.innerWidth` and fires the `resize` event a real browser
 * would — the hook only reads the width inside its listener, the same shape
 * `Navigation.tsx`'s own inlined check uses. */
function resizeTo(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => {
  cleanup();
  resizeTo(1024);
});

describe('useNarrowViewport', () => {
  it('reports narrow at or below the breakpoint', () => {
    resizeTo(390);
    const { result } = renderHook(() => useNarrowViewport(600));
    expect(result.current).toBe(true);
  });

  it('reports not narrow above the breakpoint', () => {
    resizeTo(1024);
    const { result } = renderHook(() => useNarrowViewport(600));
    expect(result.current).toBe(false);
  });

  it('is inclusive at exactly the breakpoint', () => {
    resizeTo(600);
    const { result } = renderHook(() => useNarrowViewport(600));
    expect(result.current).toBe(true);
  });

  it('updates on a resize after mount', () => {
    resizeTo(1024);
    const { result } = renderHook(() => useNarrowViewport(600));
    expect(result.current).toBe(false);

    act(() => resizeTo(390));
    expect(result.current).toBe(true);

    act(() => resizeTo(1024));
    expect(result.current).toBe(false);
  });

  it('defaults to a 600px breakpoint when none is given', () => {
    resizeTo(601);
    expect(renderHook(() => useNarrowViewport()).result.current).toBe(false);
    resizeTo(600);
    expect(renderHook(() => useNarrowViewport()).result.current).toBe(true);
  });
});
