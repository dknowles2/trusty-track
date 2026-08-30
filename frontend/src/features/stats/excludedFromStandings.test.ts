import { describe, expect, it } from 'vitest';
import { excludedCount, excludedNotice } from './excludedFromStandings';

describe('excludedCount', () => {
  it('counts flagged racers', () => {
    expect(
      excludedCount([
        { excludedFromStandings: true },
        { excludedFromStandings: false },
        { excludedFromStandings: true },
      ]),
    ).toBe(2);
  });

  it('is zero for an empty roster', () => {
    expect(excludedCount([])).toBe(0);
  });
});

describe('excludedNotice', () => {
  it('says nothing when nobody is excluded', () => {
    expect(excludedNotice(0, 'car', 'cars')).toBeNull();
  });

  it('uses the singular word and verb for one', () => {
    expect(excludedNotice(1, 'car', 'cars')).toBe(
      '1 car is racing but not ranked in these standings.',
    );
  });

  it('uses the plural word and verb for more than one', () => {
    expect(excludedNotice(3, 'car', 'cars')).toBe(
      '3 cars are racing but not ranked in these standings.',
    );
  });

  it('carries the resolved vehicle word', () => {
    expect(excludedNotice(2, 'racer', 'racers')).toBe(
      '2 racers are racing but not ranked in these standings.',
    );
  });
});
