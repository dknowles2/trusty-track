// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useElementWidth } from './useElementWidth';

afterEach(() => {
  cleanup();
  // @ts-expect-error test-only cleanup of a global a couple of tests stub
  delete global.ResizeObserver;
});

function elementWithWidth(getWidth: () => number): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'offsetWidth', { get: getWidth, configurable: true });
  return el;
}

describe('useElementWidth', () => {
  it('is null before any element is attached', () => {
    const { result } = renderHook(() => useElementWidth());

    expect(result.current[1]).toBeNull();
  });

  it('measures offsetWidth the instant an element attaches', () => {
    const { result } = renderHook(() => useElementWidth());
    const [ref] = result.current;

    act(() => ref(elementWithWidth(() => 312)));

    expect(result.current[1]).toBe(312);
  });

  it('reads 0 in jsdom, which has no ResizeObserver and no layout', () => {
    expect(typeof ResizeObserver).toBe('undefined');
    const { result } = renderHook(() => useElementWidth());
    const [ref] = result.current;

    act(() => ref(elementWithWidth(() => 0)));

    // Real jsdom offsetWidth, not a stubbed one — this is the shape every
    // other test in this tree measuring against a strip actually sees.
    expect(result.current[1]).toBe(0);
  });

  it('does not throw when detaching in an environment with no ResizeObserver', () => {
    const { result } = renderHook(() => useElementWidth());
    const [ref] = result.current;

    expect(() => {
      act(() => ref(elementWithWidth(() => 100)));
      act(() => ref(null));
    }).not.toThrow();
    expect(result.current[1]).toBe(100);
  });

  it('subscribes to ResizeObserver and updates on a later resize, when one exists', () => {
    let observedCallback: (() => void) | null = null;
    let disconnected = false;
    class FakeResizeObserver {
      constructor(cb: () => void) {
        observedCallback = cb;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    }
    // @ts-expect-error test-only global stub — jsdom defines none of its own
    global.ResizeObserver = FakeResizeObserver;

    let width = 312;
    const { result } = renderHook(() => useElementWidth());
    const [ref] = result.current;
    act(() => ref(elementWithWidth(() => width)));

    expect(result.current[1]).toBe(312);

    width = 640;
    act(() => observedCallback?.());

    expect(result.current[1]).toBe(640);
    expect(disconnected).toBe(false);
  });

  it('disconnects the previous observer when the ref moves to a new element', () => {
    let disconnectCount = 0;
    class FakeResizeObserver {
      observe() {}
      disconnect() {
        disconnectCount += 1;
      }
    }
    // @ts-expect-error test-only global stub
    global.ResizeObserver = FakeResizeObserver;

    const { result } = renderHook(() => useElementWidth());
    const [ref] = result.current;
    act(() => ref(elementWithWidth(() => 100)));
    expect(disconnectCount).toBe(0);

    act(() => ref(elementWithWidth(() => 200)));
    expect(disconnectCount).toBe(1);
    expect(result.current[1]).toBe(200);

    act(() => ref(null));
    expect(disconnectCount).toBe(2);
  });
});
