import { describe, expect, it } from 'vitest';
import {
  ALL_SOURCE,
  awardHolderWarning,
  carLabel,
  describeSpeedAward,
  duplicateOfNote,
  forBallot,
  ordinal,
  racerLabel,
  rollDownNote,
  roundLabel,
  sourceLabel,
} from './awardText';

const ROUNDS = [
  { id: 1, name: 'Prelims', roundNumber: 1 },
  { id: 2, name: null, roundNumber: 2 },
  { id: 3, name: '  ', roundNumber: 3 },
];
const RACING_GROUPS = [
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
    expect(sourceLabel(ALL_SOURCE, ROUNDS)).toBe('Overall standings');
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
    expect(describeSpeedAward({ source: ALL_SOURCE, place: 1 }, ROUNDS, RACING_GROUPS)).toBe(
      'Fastest overall',
    );
  });

  it('uses the ordinal for the rest of the podium', () => {
    expect(describeSpeedAward({ source: ALL_SOURCE, place: 2 }, ROUNDS, RACING_GROUPS)).toBe(
      '2nd overall',
    );
  });

  it('names the round when the award is drawn from one', () => {
    expect(describeSpeedAward({ source: 'ROUND:1', place: 3 }, ROUNDS, RACING_GROUPS)).toBe(
      '3rd in Prelims',
    );
  });

  it('names the racingGroup when the award is limited to one', () => {
    expect(
      describeSpeedAward({ source: ALL_SOURCE, place: 1, racingGroupId: 10 }, ROUNDS, RACING_GROUPS),
    ).toBe('Fastest in Wolves');
  });

  it('says when an award cannot be won', () => {
    // A row missing its rule. The backend resolves it to nobody rather than
    // raising; showing "undefined overall" would be worse than either.
    expect(describeSpeedAward({ source: null, place: null }, ROUNDS, RACING_GROUPS)).toBe(
      'Not set up — this award cannot be won',
    );
  });

  it('calls the bottom of the standings slowest', () => {
    expect(
      describeSpeedAward({ source: ALL_SOURCE, place: 1, fromBottom: true }, ROUNDS, RACING_GROUPS),
    ).toBe('Slowest overall');
  });

  it('numbers the rest from the bottom too', () => {
    // "2nd slowest", never "1st slowest" — nobody announces it that way.
    expect(
      describeSpeedAward({ source: 'ROUND:1', place: 2, fromBottom: true }, ROUNDS, RACING_GROUPS),
    ).toBe('2nd slowest in Prelims');
  });

  it('narrows a slowest award to a racingGroup like any other', () => {
    expect(
      describeSpeedAward(
        { source: ALL_SOURCE, place: 1, racingGroupId: 10, fromBottom: true },
        ROUNDS,
        RACING_GROUPS,
      ),
    ).toBe('Slowest in Wolves');
  });

  it('says when the racingGroup is gone', () => {
    expect(
      describeSpeedAward({ source: ALL_SOURCE, place: 1, racingGroupId: 99 }, ROUNDS, RACING_GROUPS),
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

  it('defaults to a full name (#552) — the operator picker and management list never abbreviate', () => {
    expect(
      racerLabel({ firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 }, undefined),
    ).toBe('Ada Lovelace (#42)');
  });

  it('abbreviates when the caller passes a resolved name-display setting', () => {
    expect(
      racerLabel({ firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 }, 'LAST_INITIAL'),
    ).toBe('Ada L. (#42)');
  });
});

describe('naming a car in a vote tally', () => {
  it('never names the child, only the car', () => {
    // The whole point of this function: the tally shows who won, not whose
    // kid did.
    expect(carLabel({ carNumber: 7, carName: 'Blue Streak' })).toBe('#7 — Blue Streak');
  });

  it('copes with a car that has no name', () => {
    expect(carLabel({ carNumber: 7, carName: null })).toBe('#7');
  });

  it('copes with a car that has no number yet', () => {
    expect(carLabel({ carNumber: null, carName: 'Blue Streak' })).toBe(
      'Unnumbered car — Blue Streak',
    );
  });

  it('says so when the racer behind the vote has since been removed', () => {
    expect(carLabel(undefined)).toBe('A car that has since been removed');
  });

  it('uses the resolved vehicle word when one is given (#551)', () => {
    expect(carLabel(undefined, 'rocket')).toBe('A rocket that has since been removed');
    expect(carLabel({ carNumber: null, carName: 'Blue Streak' }, 'rocket')).toBe(
      'Unnumbered rocket — Blue Streak',
    );
  });
});

describe('ordering the ballot', () => {
  it('sorts by car number ascending', () => {
    const cars = [
      { id: 1, carNumber: 12 },
      { id: 2, carNumber: 3 },
      { id: 3, carNumber: 7 },
    ];
    expect(forBallot(cars).map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it('puts unnumbered cars last, ordered by id', () => {
    const cars = [
      { id: 1, carNumber: null },
      { id: 2, carNumber: 5 },
      { id: 3, carNumber: null },
    ];
    expect(forBallot(cars).map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it('does not mutate the array it was given', () => {
    const cars = [
      { id: 1, carNumber: 2 },
      { id: 2, carNumber: 1 },
    ];
    forBallot(cars);
    expect(cars.map((c) => c.id)).toEqual([1, 2]);
  });
});

describe('rollDownNote (#615)', () => {
  const jordan = { firstName: 'Jordan', lastName: 'Mitchell', carNumber: 7 };

  it('explains a roll with who was passed over and what they hold', () => {
    const note = rollDownNote(
      { place: 1 },
      2,
      [{ racer: jordan, award: { name: 'Fastest Car' } }],
    );
    expect(note).toBe(
      'Rolled down from Fastest — Jordan Mitchell (#7) already won Fastest Car.',
    );
  });

  it('names the requested place ordinally when it is not first', () => {
    const note = rollDownNote(
      { place: 2 },
      3,
      [{ racer: jordan, award: { name: 'Fastest Car' } }],
    );
    expect(note).toBe(
      'Rolled down from 2nd place — Jordan Mitchell (#7) already won Fastest Car.',
    );
  });

  it('counts from the slowest car when the award does', () => {
    const note = rollDownNote(
      { place: 1, fromBottom: true },
      2,
      [{ racer: jordan, award: { name: 'Slowest Car' } }],
    );
    expect(note).toBe(
      'Rolled down from Slowest — Jordan Mitchell (#7) already won Slowest Car.',
    );
  });

  it('joins several passed-over racers', () => {
    const ada = { firstName: 'Ada', lastName: 'Lovelace', carNumber: 3 };
    const note = rollDownNote(
      { place: 1 },
      3,
      [
        { racer: jordan, award: { name: 'Fastest Car' } },
        { racer: ada, award: { name: 'Fastest Wolf' } },
      ],
    );
    expect(note).toBe(
      'Rolled down from Fastest — Jordan Mitchell (#7) already won Fastest Car; Ada Lovelace (#3) already won Fastest Wolf.',
    );
  });

  it('names a deleted racer or award rather than rendering nothing', () => {
    const note = rollDownNote({ place: 1 }, 2, [{ racer: null, award: null }]);
    expect(note).toBe(
      'Rolled down from Fastest — A racer no longer on the roster already won an award that no longer exists.',
    );
  });

  it('is null when the position matches the place — nothing rolled', () => {
    expect(rollDownNote({ place: 1 }, 1, [])).toBeNull();
  });

  it('is null with no passedOver, even if position and place disagree', () => {
    // Shouldn't happen from the server, but the note should not invent an
    // explanation it cannot back up.
    expect(rollDownNote({ place: 1 }, 2, [])).toBeNull();
  });

  it('is null for an award with no rule, or no recipient', () => {
    expect(rollDownNote({ place: null }, null, [])).toBeNull();
    expect(rollDownNote({ place: 1 }, null, [])).toBeNull();
  });
});

describe('duplicateOfNote (#615)', () => {
  it('names the award a judged pick already holds', () => {
    expect(duplicateOfNote({ name: 'Fastest Car' })).toBe('Also holds “Fastest Car.”');
  });

  it('is null when there is no collision', () => {
    expect(duplicateOfNote(null)).toBeNull();
    expect(duplicateOfNote(undefined)).toBeNull();
  });
});

describe('awardHolderWarning (#615)', () => {
  const awards = [
    { id: 1, name: 'Fastest Car', recipient: { id: 10 } },
    { id: 2, name: 'Best Paint', recipient: null },
  ];

  it('warns when the picked racer already holds another award', () => {
    expect(awardHolderWarning(10, awards)).toBe(
      'Already won “Fastest Car.” Award this one too?',
    );
  });

  it('is null when nobody holds anything yet', () => {
    expect(awardHolderWarning(99, awards)).toBeNull();
  });

  it('is null with no racer picked', () => {
    expect(awardHolderWarning(null, awards)).toBeNull();
  });

  it('excludes the award being edited, so it does not warn about itself', () => {
    expect(awardHolderWarning(10, awards, 1)).toBeNull();
  });
});
