import { describe, expect, it } from 'vitest';
import {
  CUMULATIVE_TIME,
  FASTEST_TIME,
  POINTS,
  SCORING_STRATEGY_OPTIONS,
  TIMED,
  formatScore,
  scoreLabel,
} from './scoringStrategyText';

describe('SCORING_STRATEGY_OPTIONS', () => {
  it('offers all four strategies, in backend.domain.scoring.ALL_STRATEGIES order', () => {
    expect(SCORING_STRATEGY_OPTIONS.map((o) => o.value)).toEqual([
      TIMED,
      POINTS,
      CUMULATIVE_TIME,
      FASTEST_TIME,
    ]);
  });

  it('gives every option a non-empty label and description', () => {
    for (const option of SCORING_STRATEGY_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});

describe('scoreLabel', () => {
  it('names each strategy differently', () => {
    expect(scoreLabel('TIMED')).toBe('Avg Time');
    expect(scoreLabel('CUMULATIVE_TIME')).toBe('Total Time');
    expect(scoreLabel('FASTEST_TIME')).toBe('Best Time');
    expect(scoreLabel('POINTS')).toBe('Points');
  });
});

describe('formatScore', () => {
  it('formats a time-based score in seconds', () => {
    expect(formatScore(3.2016, 'TIMED')).toBe('3.202s');
    expect(formatScore(3.2016, 'CUMULATIVE_TIME')).toBe('3.202s');
    expect(formatScore(3.2016, 'FASTEST_TIME')).toBe('3.202s');
  });

  it('formats a Points score as a bare number', () => {
    expect(formatScore(7, 'POINTS')).toBe('7');
  });
});
