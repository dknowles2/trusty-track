import { describe, it, expect } from 'vitest';
import { soleEliminationRoundId } from './championshipChaining';

function round(overrides: {
  id: number;
  advancementSource?: string | null;
  schedulingStrategy: string;
}) {
  return {
    id: overrides.id,
    advancementSource: overrides.advancementSource ?? null,
    schedulingStrategy: overrides.schedulingStrategy,
  };
}

describe('soleEliminationRoundId', () => {
  it('returns null with no rounds at all', () => {
    expect(soleEliminationRoundId([])).toBeNull();
  });

  it('returns null for an ordinary GENERAL general round', () => {
    const rounds = [round({ id: 1, schedulingStrategy: 'GENERAL' })];
    expect(soleEliminationRoundId(rounds)).toBeNull();
  });

  it('returns null for a Balanced general round — its heats feed the aggregate', () => {
    const rounds = [round({ id: 1, schedulingStrategy: 'BALANCED' })];
    expect(soleEliminationRoundId(rounds)).toBeNull();
  });

  it('returns the id of a sole Elimination general round', () => {
    const rounds = [round({ id: 5, schedulingStrategy: 'ELIMINATION' })];
    expect(soleEliminationRoundId(rounds)).toBe(5);
  });

  it('ignores championship rounds — only advancementSource == null counts as general', () => {
    const rounds = [
      round({ id: 5, schedulingStrategy: 'ELIMINATION' }),
      round({ id: 6, schedulingStrategy: 'GENERAL', advancementSource: 'ROUND:5' }),
    ];
    expect(soleEliminationRoundId(rounds)).toBe(5);
  });

  it('returns null for a mixed race — a GENERAL round alongside an Elimination one', () => {
    const rounds = [
      round({ id: 1, schedulingStrategy: 'GENERAL' }),
      round({ id: 2, schedulingStrategy: 'ELIMINATION' }),
    ];
    expect(soleEliminationRoundId(rounds)).toBeNull();
  });

  it('returns null for two Elimination general rounds (never happens today, still not "sole")', () => {
    const rounds = [
      round({ id: 1, schedulingStrategy: 'ELIMINATION' }),
      round({ id: 2, schedulingStrategy: 'ELIMINATION' }),
    ];
    expect(soleEliminationRoundId(rounds)).toBeNull();
  });
});
