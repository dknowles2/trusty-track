import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useIntermissionHighlights, type RawHighlightHeat } from './useIntermissionHighlights';
import { NONE as NO_INTERMISSION } from '../racing/intermission';

const HEATS: RawHighlightHeat[] = [
  {
    id: 1,
    heatNumber: 1,
    roundId: 10,
    recordedAt: '2026-01-01T00:00:00Z',
    lanes: [{ place: 1, time: 3.5, racerId: 100 }],
    replays: [{ cameraId: 'cam-1', url: '/replay/one.webm', durationMs: 4000, t0OffsetMs: 500 }],
  },
  {
    id: 2,
    heatNumber: 2,
    roundId: 10,
    recordedAt: '2026-01-01T00:05:00Z',
    lanes: [{ place: 1, time: 3.0, racerId: 101 }],
    replays: [{ cameraId: 'cam-1', url: '/replay/two.webm', durationMs: 4000, t0OffsetMs: 500 }],
  },
];

const ROUNDS = [{ id: 10, roundNumber: 1 }];
const RACERS = [
  { id: 100, firstName: 'Ada', lastName: 'Lovelace' },
  { id: 101, firstName: 'Grace', lastName: 'Hopper' },
];

const HIGHLIGHTS_ON = { ...NO_INTERMISSION, active: true, highlights: true };

describe('useIntermissionHighlights', () => {
  it('is null when highlights are off, even with a full reel available', () => {
    const { result } = renderHook(() =>
      useIntermissionHighlights({
        intermission: { ...NO_INTERMISSION, active: true, highlights: false },
        intermissionActive: true,
        heats: HEATS,
        rounds: ROUNDS,
        racers: RACERS,
        nameDisplay: 'FULL',
      }),
    );
    expect(result.current.highlightClip).toBeNull();
  });

  it('is null when there is no clip to show, even with highlights on', () => {
    const { result } = renderHook(() =>
      useIntermissionHighlights({
        intermission: HIGHLIGHTS_ON,
        intermissionActive: true,
        heats: [],
        rounds: [],
        racers: [],
        nameDisplay: 'FULL',
      }),
    );
    expect(result.current.highlightClip).toBeNull();
  });

  it('plays the fastest heat first, with a caption naming the winner', () => {
    const { result } = renderHook(() =>
      useIntermissionHighlights({
        intermission: HIGHLIGHTS_ON,
        intermissionActive: true,
        heats: HEATS,
        rounds: ROUNDS,
        racers: RACERS,
        nameDisplay: 'FULL',
      }),
    );
    expect(result.current.highlightClip).toEqual({
      url: '/replay/two.webm',
      caption: 'Heat 2 · Grace Hopper · 3.000 s',
    });
  });

  it('advances to the next clip, looping back to the first, on onHighlightEnded', () => {
    const { result } = renderHook(() =>
      useIntermissionHighlights({
        intermission: HIGHLIGHTS_ON,
        intermissionActive: true,
        heats: HEATS,
        rounds: ROUNDS,
        racers: RACERS,
        nameDisplay: 'FULL',
      }),
    );
    expect(result.current.highlightClip?.url).toBe('/replay/two.webm');

    act(() => result.current.onHighlightEnded());
    expect(result.current.highlightClip?.url).toBe('/replay/one.webm');

    act(() => result.current.onHighlightEnded());
    expect(result.current.highlightClip?.url).toBe('/replay/two.webm');
  });

  it('resets to the first clip when the break starts', () => {
    const { result, rerender } = renderHook(
      (props: { active: boolean }) =>
        useIntermissionHighlights({
          intermission: HIGHLIGHTS_ON,
          intermissionActive: props.active,
          heats: HEATS,
          rounds: ROUNDS,
          racers: RACERS,
          nameDisplay: 'FULL',
        }),
      { initialProps: { active: false } },
    );

    // Not active yet — highlightClip is null regardless of index, but
    // advance the (inert) index anyway to prove the reset below is real.
    act(() => result.current.onHighlightEnded());

    rerender({ active: true });
    expect(result.current.highlightClip?.url).toBe('/replay/two.webm');
  });

  it('falls back to no winner name when the winning racer is unknown', () => {
    const { result } = renderHook(() =>
      useIntermissionHighlights({
        intermission: HIGHLIGHTS_ON,
        intermissionActive: true,
        heats: [HEATS[1]],
        rounds: ROUNDS,
        racers: [],
        nameDisplay: 'FULL',
      }),
    );
    expect(result.current.highlightClip?.caption).toBe('Heat 2 · 3.000 s');
  });
});
