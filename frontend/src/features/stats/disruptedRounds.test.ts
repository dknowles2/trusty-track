import { describe, expect, it } from 'vitest';
import { RoundSummary, excludedRounds, exclusionNotice, roundLabel } from './disruptedRounds';

const prelim: RoundSummary = { id: 1, name: 'Prelims', roundNumber: 1 };
const disruptedPrelim: RoundSummary = { ...prelim, id: 2, disrupted: true };
const disruptedFinal: RoundSummary = {
  id: 3,
  name: 'Finals',
  roundNumber: 2,
  advancementSource: 'PACK',
  disrupted: true,
};

describe('which rounds stop counting', () => {
  it('none of them under TIMED', () => {
    // Averages are scale-free, so a round where a lane died is still good
    // evidence.
    expect(excludedRounds([disruptedPrelim], 'TIMED')).toEqual([]);
  });

  it('a disrupted prelim round under POINTS', () => {
    expect(excludedRounds([prelim, disruptedPrelim], 'POINTS')).toEqual([
      disruptedPrelim,
    ]);
  });

  it('never an undisrupted round', () => {
    expect(excludedRounds([prelim], 'POINTS')).toEqual([]);
  });

  it('never a championship round, which is not in the standings anyway', () => {
    // Telling the operator a final was "excluded" describes a consequence that
    // does not exist — #17 keeps championship heats out regardless.
    expect(excludedRounds([disruptedFinal], 'POINTS')).toEqual([]);
  });
});

describe('what the operator is told', () => {
  it('nothing, when nothing was excluded', () => {
    expect(exclusionNotice([prelim], 'POINTS')).toBeNull();
    expect(exclusionNotice([disruptedPrelim], 'TIMED')).toBeNull();
  });

  it('names the round, and says why points are the reason', () => {
    const notice = exclusionNotice([disruptedPrelim], 'POINTS');
    expect(notice).toContain('Prelims');
    expect(notice).toContain('lane went out of service');
    expect(notice).toContain('points');
  });

  it('names all of them when more than one went', () => {
    const second: RoundSummary = { id: 4, name: 'Semis', roundNumber: 2, disrupted: true };
    const notice = exclusionNotice([disruptedPrelim, second], 'POINTS');
    expect(notice).toContain('Prelims, Semis');
    expect(notice).toContain('are not counted');
  });
});

describe('naming a round', () => {
  it('uses its name', () => {
    expect(roundLabel(prelim)).toBe('Prelims');
  });

  it('falls back to the number, including for a blank name', () => {
    expect(roundLabel({ id: 9, name: null, roundNumber: 3 })).toBe('Round 3');
    expect(roundLabel({ id: 9, name: '  ', roundNumber: 3 })).toBe('Round 3');
  });
});
