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

  // #873: #779 removed exactly this magnitude test from the backend
  // (`services/stats.py`), on the reasoning that 9.999s is a *penalty*
  // substituted for a real DNF, never a sentinel a genuine finish cannot
  // reach — a long track, a slow rocket, or a Space Derby boat routinely
  // finishes at or past 9.999s. `formatScore` must not disagree with that:
  // a score of exactly `DNF_PENALTY_SECONDS` prints as an ordinary time,
  // the same way `formatLaneTime` already treats only a non-positive time
  // (never a magnitude) as the DNF marker.
  it('does not relabel a genuine 9.999s-or-slower score as DNF', () => {
    expect(formatScore(DNF_PENALTY_SECONDS, 'TIMED')).toBe('9.999s');
    expect(formatScore(DNF_PENALTY_SECONDS, 'CUMULATIVE_TIME')).toBe('9.999s');
    expect(formatScore(12.5, 'TIMED')).toBe('12.500s');
  });

  it('does not relabel an ordinary Points score that happens to equal 9.999', () => {
    expect(formatScore(DNF_PENALTY_SECONDS, 'POINTS')).toBe('9.999');
  });
});
