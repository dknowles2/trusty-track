import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPLAY_SETTINGS,
  INITIAL_PLAYBACK_STATE,
  afterClipEnded,
  readReplaySettings,
  writeReplaySettings,
} from './replayPlayback';
import { observeHeatResult } from './resultsOverlay';

// Ordering multiple cameras' clips moved server-side in #177 stage 4
// (`api/schema.py`'s `_order_replay_clips`) — see this module's own
// updated header docstring. `test_replays.py`'s
// `test_heat_replay_clips_are_ordered_by_camera_order` and
// `test_heat_replay_clips_with_no_order_set_fall_back_to_camera_id` are
// where that rule is pinned now; there is nothing left to order on this
// side, so there is no client-side test for it here any more.

describe('afterClipEnded', () => {
  it('replays the same clip until showings is reached', () => {
    const first = afterClipEnded(INITIAL_PLAYBACK_STATE, 2, 1);
    expect(first).toEqual({ clipIndex: 0, playCount: 1 });
  });

  it('stops after showings on a single clip', () => {
    const second = afterClipEnded({ clipIndex: 0, playCount: 1 }, 2, 1);
    expect(second).toBe('done');
  });

  it('advances to the next clip once showings is reached, resetting playCount', () => {
    const next = afterClipEnded({ clipIndex: 0, playCount: 1 }, 2, 2);
    expect(next).toEqual({ clipIndex: 1, playCount: 0 });
  });

  it('stops once every clip has had its showings', () => {
    const done = afterClipEnded({ clipIndex: 1, playCount: 1 }, 2, 2);
    expect(done).toBe('done');
  });

  it('stops immediately with no clips at all', () => {
    expect(afterClipEnded(INITIAL_PLAYBACK_STATE, 2, 0)).toBe('done');
  });

  it('showings of 1 advances straight to the next clip', () => {
    expect(afterClipEnded({ clipIndex: 0, playCount: 0 }, 1, 3)).toEqual({ clipIndex: 1, playCount: 0 });
  });
});

describe('replay settings storage', () => {
  const fakeStorage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  };

  it('falls back to the default with nothing stored', () => {
    expect(readReplaySettings('d-1', fakeStorage())).toEqual(DEFAULT_REPLAY_SETTINGS);
  });

  it('round-trips a written setting', () => {
    const storage = fakeStorage();
    writeReplaySettings('d-1', { showings: 3, rate: 1 }, storage);
    expect(readReplaySettings('d-1', storage)).toEqual({ showings: 3, rate: 1 });
  });

  it('is scoped per display id', () => {
    const storage = fakeStorage();
    writeReplaySettings('d-1', { showings: 3, rate: 1 }, storage);
    expect(readReplaySettings('d-2', storage)).toEqual(DEFAULT_REPLAY_SETTINGS);
  });

  it('falls back to the default on a malformed value', () => {
    const storage = fakeStorage();
    storage.setItem('trustytrack.replaySettings.d-1', 'not json');
    expect(readReplaySettings('d-1', storage)).toEqual(DEFAULT_REPLAY_SETTINGS);
  });

  it('falls back to the default when storage throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(readReplaySettings('d-1', throwing)).toEqual(DEFAULT_REPLAY_SETTINGS);
  });
});

describe('the seen === null playback rule (observeHeatResult reused for heatReplay)', () => {
  // heatReplay's own payload carries the identical {heatId, recordedAt}
  // pair a timingStats result does, so Observation.tsx keys a replay off
  // the same `observeHeatResult` edge-detector rather than a second copy of
  // the rule — this pins that the shared function behaves correctly for a
  // reconnecting screen, which is the whole point of #177's playback rule.
  it('does not treat the opening snapshot as a new replay to play', () => {
    const observation = observeHeatResult(null, { heatId: 5, recordedAt: '2026-01-01T00:00:05Z' });
    expect(observation.isNew).toBe(false);
  });

  it('treats a genuinely new heat replay as new', () => {
    const seenAfterFirst = observeHeatResult(null, { heatId: 5, recordedAt: 'a' }).seen;
    const second = observeHeatResult(seenAfterFirst, { heatId: 6, recordedAt: 'b' });
    expect(second.isNew).toBe(true);
  });

  it('does not replay the same heat replay twice', () => {
    const seen = observeHeatResult(null, { heatId: 5, recordedAt: 'a' }).seen;
    const repeat = observeHeatResult(seen, { heatId: 5, recordedAt: 'a' });
    expect(repeat.isNew).toBe(false);
  });
});
