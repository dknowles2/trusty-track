import { describe, expect, it } from 'vitest';
import {
  colorForLane,
  presetColors,
  presetForLaneCount,
  presetNameForColor,
  setLaneColor,
  STANDARD_4_LANE_COLORS,
  STANDARD_6_LANE_COLORS,
} from './laneColors';

describe('presetForLaneCount', () => {
  it('returns the standard four-lane scheme for four lanes', () => {
    expect(presetForLaneCount(4)).toEqual(STANDARD_4_LANE_COLORS);
  });

  it('returns the standard six-lane scheme for six lanes', () => {
    expect(presetForLaneCount(6)).toEqual(STANDARD_6_LANE_COLORS);
  });

  it('truncates the four-lane scheme for three lanes', () => {
    expect(presetForLaneCount(3)).toEqual(STANDARD_4_LANE_COLORS.slice(0, 3));
  });

  it('truncates the six-lane scheme for five lanes', () => {
    expect(presetForLaneCount(5)).toEqual(STANDARD_6_LANE_COLORS.slice(0, 5));
  });

  it('offers no preset past six lanes', () => {
    expect(presetForLaneCount(7)).toBeNull();
    expect(presetForLaneCount(8)).toBeNull();
  });

  it('offers no preset for zero or fewer lanes', () => {
    expect(presetForLaneCount(0)).toBeNull();
    expect(presetForLaneCount(-1)).toBeNull();
  });

  // Pinned against the backend's own values, the same "both pin the literal
  // payload" rule `domain/printables.py` and `scanning.ts` follow — this and
  // `backend/domain/lane_colors.py` must not silently drift apart.
  it('matches the backend module hex-for-hex', () => {
    expect(STANDARD_4_LANE_COLORS.map((c) => c.hex)).toEqual([
      '#E53935',
      '#FAFAFA',
      '#1E88E5',
      '#FDD835',
    ]);
    expect(STANDARD_6_LANE_COLORS.map((c) => c.hex)).toEqual([
      '#E53935',
      '#FAFAFA',
      '#1E88E5',
      '#FDD835',
      '#43A047',
      '#FB8C00',
    ]);
  });
});

describe('presetColors', () => {
  it('is the plain hex array a preset stores', () => {
    expect(presetColors(4)).toEqual(['#E53935', '#FAFAFA', '#1E88E5', '#FDD835']);
  });

  it('is empty when there is no preset for this lane count', () => {
    expect(presetColors(7)).toEqual([]);
  });
});

describe('colorForLane', () => {
  const colors = ['#E53935', '#FAFAFA', '#1E88E5', '#FDD835'];

  it('reads the track lane number one-based', () => {
    expect(colorForLane(colors, 1)).toBe('#E53935');
    expect(colorForLane(colors, 4)).toBe('#FDD835');
  });

  it('is null for lane zero or negative', () => {
    expect(colorForLane(colors, 0)).toBeNull();
    expect(colorForLane(colors, -1)).toBeNull();
  });

  it('is null past the end of the list', () => {
    expect(colorForLane(['#E53935'], 2)).toBeNull();
  });

  it('is null for a blank entry, not an empty string', () => {
    expect(colorForLane(['', '#1E88E5'], 1)).toBeNull();
    expect(colorForLane(['', '#1E88E5'], 2)).toBe('#1E88E5');
  });
});

describe('setLaneColor', () => {
  it('sets a lane already within the array', () => {
    expect(setLaneColor(['#E53935', '#FAFAFA'], 2, '#000000')).toEqual([
      '#E53935',
      '#000000',
    ]);
  });

  it('extends the array with blanks so an earlier gap is not shifted', () => {
    expect(setLaneColor([], 3, '#000000')).toEqual(['', '', '#000000']);
  });

  it('clears a lane by setting it to an empty string', () => {
    expect(setLaneColor(['#E53935', '#FAFAFA'], 1, '')).toEqual(['', '#FAFAFA']);
  });
});

describe('presetNameForColor', () => {
  it('names an exact preset match', () => {
    expect(presetNameForColor('#E53935')).toBe('Red');
    expect(presetNameForColor('#e53935')).toBe('Red');
  });

  it('is null for a custom colour', () => {
    expect(presetNameForColor('#123456')).toBeNull();
  });
});
