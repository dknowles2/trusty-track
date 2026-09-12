import { describe, expect, it } from 'vitest';
import { defaultEliminationRound, isEliminationOnlyRace } from './eliminationScope';
import type { RoundSummary } from './disruptedRounds';

const round = (overrides: Partial<RoundSummary> & Pick<RoundSummary, 'id' | 'roundNumber'>): RoundSummary => ({
  advancementSource: null,
  schedulingStrategy: 'PPC',
  ...overrides,
});

describe('isEliminationOnlyRace', () => {
  it('is false for an empty race', () => {
    expect(isEliminationOnlyRace([])).toBe(false);
  });

  it('is false for an ordinary PPC preliminary round', () => {
    expect(isEliminationOnlyRace([round({ id: 1, roundNumber: 1 })])).toBe(false);
  });

  it('is false when a PPC general round exists alongside an elimination one', () => {
    expect(
      isEliminationOnlyRace([
        round({ id: 1, roundNumber: 1, schedulingStrategy: 'PPC' }),
        round({ id: 2, roundNumber: 2, schedulingStrategy: 'ELIMINATION' }),
      ]),
    ).toBe(false);
  });

  it('is true when the only round is elimination', () => {
    expect(
      isEliminationOnlyRace([round({ id: 1, roundNumber: 1, schedulingStrategy: 'ELIMINATION' })]),
    ).toBe(true);
  });

  it('is true across a chain of elimination rounds, championship ones included', () => {
    expect(
      isEliminationOnlyRace([
        round({ id: 1, roundNumber: 1, schedulingStrategy: 'ELIMINATION' }),
        round({
          id: 2,
          roundNumber: 2,
          schedulingStrategy: 'ELIMINATION',
          advancementSource: 'ROUND:1',
        }),
      ]),
    ).toBe(true);
  });

  it('is false when every round is a championship round with no elimination round anywhere', () => {
    // Degenerate, but the predicate should not claim "elimination-only" for
    // a race with no elimination round at all.
    expect(
      isEliminationOnlyRace([round({ id: 1, roundNumber: 1, advancementSource: 'ALL', schedulingStrategy: 'PPC' })]),
    ).toBe(false);
  });
});

describe('defaultEliminationRound', () => {
  it('is null with no elimination round', () => {
    expect(defaultEliminationRound([round({ id: 1, roundNumber: 1 })])).toBeNull();
  });

  it('picks the single elimination round', () => {
    const r = round({ id: 5, roundNumber: 1, schedulingStrategy: 'ELIMINATION' });
    expect(defaultEliminationRound([r])).toEqual(r);
  });

  it('picks the last of a chain, not the first', () => {
    const first = round({ id: 1, roundNumber: 1, schedulingStrategy: 'ELIMINATION' });
    const last = round({
      id: 2,
      roundNumber: 2,
      schedulingStrategy: 'ELIMINATION',
      advancementSource: 'ROUND:1',
    });
    expect(defaultEliminationRound([first, last])).toEqual(last);
    expect(defaultEliminationRound([last, first])).toEqual(last);
  });
});
