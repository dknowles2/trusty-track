import { describe, it, expect } from 'vitest';
import { slowestFirst } from './slowestFirst';

const entry = (racerId: number, score: number, heatsCompleted = 1, rank = 0) => ({
  racerId,
  score,
  heatsCompleted,
  rank,
});

describe('slowestFirst', () => {
  it('puts the slowest recorded car first and restamps the ranks', () => {
    const standings = [
      entry(1, 3.0, 1, 1),
      entry(2, 3.5, 1, 2),
      entry(3, 4.0, 1, 3),
    ];
    const result = slowestFirst(standings);
    expect(result.map((e) => e.racerId)).toEqual([3, 2, 1]);
    expect(result.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('keeps cars with no recorded result at the end', () => {
    const standings = [
      entry(1, 3.0, 1, 1),
      entry(2, 4.0, 1, 2),
      entry(9, 0, 0, 3),
    ];
    const result = slowestFirst(standings);
    expect(result.map((e) => e.racerId)).toEqual([2, 1, 9]);
    expect(result.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('a tie is still a shared rank', () => {
    const standings = [
      entry(1, 3.0, 1, 1),
      entry(2, 4.0, 1, 2),
      entry(3, 4.0, 1, 2),
    ];
    const result = slowestFirst(standings);
    // Registration order within the tie is preserved by the reversal being
    // stable; what matters is the shared rank stays visible (#226).
    expect(result.map((e) => e.rank)).toEqual([1, 1, 3]);
    expect(result[2].racerId).toBe(1);
  });
});
