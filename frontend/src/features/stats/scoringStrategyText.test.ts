import { describe, expect, it } from 'vitest';
import {
  CUMULATIVE_TIME,
  DNF_PENALTY_SECONDS,
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

  // #763: this used to be reimplemented privately in Observation.tsx at
  // four decimals, disagreeing with this module's three and with the
  // projector view's own copy of the same private reimplementation.
  it('drops the trailing unit when the caller labels it separately', () => {
    expect(formatScore(3.2016, 'TIMED', { unit: false })).toBe('3.202');
    expect(formatScore(7, 'POINTS', { unit: false })).toBe('7');
  });

  it('labels a score equal to the DNF penalty sentinel as DNF, not 9.999s', () => {
    expect(formatScore(DNF_PENALTY_SECONDS, 'TIMED')).toBe('DNF');
    expect(formatScore(DNF_PENALTY_SECONDS, 'CUMULATIVE_TIME')).toBe('DNF');
  });

  it('does not relabel an ordinary Points score that happens to equal 9.999', () => {
    // POINTS never produces a fractional score, but the guard is a strict
    // equality on the raw number regardless of strategy, so this pins that
    // the check is scoped to time-based strategies and not to the literal
    // value alone.
    expect(formatScore(DNF_PENALTY_SECONDS, 'POINTS')).toBe('9.999');
  });
});
