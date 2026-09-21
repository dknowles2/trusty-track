// @vitest-environment jsdom
/**
 * `usesFallbackFrameSource` (#1294) — the one place `startCapture` decides
 * between `MediaStreamTrackProcessor` and `capture.ts`'s own canvas
 * fallback. jsdom has no WebCodecs and no real camera, so this is as far as
 * a unit test can reach into the capture pipeline itself; the fallback
 * actually producing decodable frames is proven end to end by
 * `instantReplay.spec.ts` (`?noProcessor=1` and a deleted
 * `MediaStreamTrackProcessor` global, both against a real browser).
 */
import { describe, expect, it } from 'vitest';
import { usesFallbackFrameSource } from './capture';

describe('usesFallbackFrameSource', () => {
  it('picks the processor when it exists and no override is set', () => {
    const g = { MediaStreamTrackProcessor: class {} } as unknown as typeof globalThis;
    expect(usesFallbackFrameSource(false, g)).toBe(false);
  });

  it('picks the fallback when MediaStreamTrackProcessor is absent — every WebKit browser today', () => {
    const g = {} as unknown as typeof globalThis;
    expect(usesFallbackFrameSource(false, g)).toBe(true);
  });

  it('picks the fallback when forced, even though the processor exists — Camera.tsx\'s ?noProcessor=1', () => {
    const g = { MediaStreamTrackProcessor: class {} } as unknown as typeof globalThis;
    expect(usesFallbackFrameSource(true, g)).toBe(true);
  });

  it('picks the fallback when both forced and absent', () => {
    const g = {} as unknown as typeof globalThis;
    expect(usesFallbackFrameSource(true, g)).toBe(true);
  });
});
