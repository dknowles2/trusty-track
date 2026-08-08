import { describe, expect, it } from 'vitest';
import {
  PACK_SOURCE,
  describeSpeedAward,
  ordinal,
  racerLabel,
  roundLabel,
  sourceLabel,
} from './awardText';

const ROUNDS = [
  { id: 1, name: 'Prelims', roundNumber: 1 },
  { id: 2, name: null, roundNumber: 2 },
  { id: 3, name: '  ', roundNumber: 3 },
];
const DENS = [
  { id: 10, name: 'Wolves' },
  { id: 11, name: 'Bears' },
];

describe('ordinal', () => {
  it('handles the ordinary cases', () => {
    expect([1, 2, 3, 4, 5].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
  });

  it('handles the teens, which the naive rule gets wrong', () => {
    // A pack big enough to award 11th place is a pack big enough to notice
    // "11st".
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
  });

  it('goes back to the ordinary rule after the teens', () => {
    expect([21, 22, 23, 111, 112].map(ordinal)).toEqual([
      '21st',
      '22nd',
      '23rd',
      '111th',
      '112th',
    ]);
  });
});

describe('naming a round', () => {
  it('uses the name it was given', () => {
    expect(roundLabel(ROUNDS[0])).toBe('Prelims');
  });

  it('falls back to the number when there is none', () => {
    expect(roundLabel(ROUNDS[1])).toBe('Round 2');
  });

  it('treats a blank name as none', () => {
    // The round form lets a name be cleared, and " " is not a name.
    expect(roundLabel(ROUNDS[2])).toBe('Round 3');
  });
});

describe('naming a source', () => {
  it('calls the pack source what an operator calls it', () => {
    expect(sourceLabel(PACK_SOURCE, ROUNDS)).toBe('Overall standings');
  });

  it('names the round a source points at', () => {
    expect(sourceLabel('ROUND:1', ROUNDS)).toBe('Prelims');
  });

  it('says so when the round is gone', () => {
    // Deleting a round leaves any award drawn from it pointing at nothing. The
    // backend resolves that to no recipient; this is how the operator finds
    // out why.
    expect(sourceLabel('ROUND:99', ROUNDS)).toBe('A round that no longer exists');
  });
});

describe('describing a speed award', () => {
  it('calls first place fastest, which is what people say', () => {
    expect(describeSpeedAward({ source: PACK_SOURCE, place: 1 }, ROUNDS, DENS)).toBe(
      'Fastest overall',
    );
  });

  it('uses the ordinal for the rest of the podium', () => {
    expect(describeSpeedAward({ source: PACK_SOURCE, place: 2 }, ROUNDS, DENS)).toBe(
      '2nd overall',
    );
  });

  it('names the round when the award is drawn from one', () => {
    expect(describeSpeedAward({ source: 'ROUND:1', place: 3 }, ROUNDS, DENS)).toBe(
      '3rd in Prelims',
    );
  });

  it('names the den when the award is limited to one', () => {
    expect(
      describeSpeedAward({ source: PACK_SOURCE, place: 1, denId: 10 }, ROUNDS, DENS),
    ).toBe('Fastest in Wolves');
  });

  it('says when an award cannot be won', () => {
    // A row missing its rule. The backend resolves it to nobody rather than
    // raising; showing "undefined overall" would be worse than either.
    expect(describeSpeedAward({ source: null, place: null }, ROUNDS, DENS)).toBe(
      'Not set up — this award cannot be won',
    );
  });

  it('says when the den is gone', () => {
    expect(
      describeSpeedAward({ source: PACK_SOURCE, place: 1, denId: 99 }, ROUNDS, DENS),
    ).toBe('Fastest overall — a den that no longer exists');
  });
});

describe('naming a racer', () => {
  it('includes the car number, which is how an announcer reads it out', () => {
    expect(racerLabel({ firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 })).toBe(
      'Ada Lovelace (#42)',
    );
  });

  it('copes with a racer who has no number yet', () => {
    expect(racerLabel({ firstName: 'Ada', lastName: 'Lovelace', carNumber: null })).toBe(
      'Ada Lovelace',
    );
  });
});
