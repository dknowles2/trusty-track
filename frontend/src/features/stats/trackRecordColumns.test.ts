import { describe, expect, it } from 'vitest';
import { hideRaceColumn } from './trackRecordColumns';

describe('hideRaceColumn (#1147)', () => {
  it('hides the column when every record belongs to the race on screen', () => {
    expect(
      hideRaceColumn(
        [{ raceId: 2 }, { raceId: 2 }, { raceId: 2 }],
        2,
      ),
    ).toBe(true);
  });

  it('keeps the race name (as a muted line) when a record is from another race', () => {
    expect(
      hideRaceColumn(
        [{ raceId: 2 }, { raceId: 1 }],
        2,
      ),
    ).toBe(false);
  });

  it('keeps it when a record is a hand-entered historical one (raceId null)', () => {
    expect(hideRaceColumn([{ raceId: 2 }, { raceId: null }], 2)).toBe(false);
  });

  it('is false for an empty list rather than vacuously true', () => {
    expect(hideRaceColumn([], 2)).toBe(false);
  });

  it('hides for a single-record list that matches', () => {
    expect(hideRaceColumn([{ raceId: 5 }], 5)).toBe(true);
  });
});
