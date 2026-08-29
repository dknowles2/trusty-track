import { describe, expect, it } from 'vitest';
import {
  applyMapping,
  canImport,
  guessMapping,
  parseCsv,
  templateCsv,
  toCanonicalCsv,
  validate,
  type Mapping,
} from './csvMapping';

const mapping = (partial: Partial<Mapping>): Mapping => ({
  firstName: null,
  lastName: null,
  carNumber: null,
  carName: null,
  racingGroup: null,
  passedInspection: null,
  ...partial,
});

describe('parseCsv', () => {
  it('reads headers and rows', () => {
    const parsed = parseCsv('First,Last\nAlex,Rivera\nSam,Okafor');

    expect(parsed.headers).toEqual(['First', 'Last']);
    expect(parsed.rows).toEqual([
      { First: 'Alex', Last: 'Rivera' },
      { First: 'Sam', Last: 'Okafor' },
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    const parsed = parseCsv('name,car\nAlex,"Lightning, Jr."');

    expect(parsed.rows[0].car).toBe('Lightning, Jr.');
  });

  it('reads a doubled quote as one quote', () => {
    const parsed = parseCsv('name,car\nAlex,"The ""Rocket"""');

    expect(parsed.rows[0].car).toBe('The "Rocket"');
  });

  it('keeps a newline inside a quoted field', () => {
    const parsed = parseCsv('name,note\nAlex,"line one\nline two"');

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].note).toBe('line one\nline two');
  });

  it('handles CRLF line endings', () => {
    const parsed = parseCsv('First,Last\r\nAlex,Rivera\r\n');

    expect(parsed.rows).toEqual([{ First: 'Alex', Last: 'Rivera' }]);
  });

  it('strips the byte order mark Excel writes', () => {
    // Left in place it becomes part of the first header, so that column maps to
    // nothing and the operator sees a First Name dropdown that will not stick.
    const parsed = parseCsv('\uFEFFFirst Name,Last Name\nAlex,Rivera');

    expect(parsed.headers[0]).toBe('First Name');
    expect(guessMapping(parsed.headers).firstName).toBe('First Name');
  });

  it('pads a short row rather than dropping the racer', () => {
    const parsed = parseCsv('first,last,car\nAlex,Rivera');

    expect(parsed.rows[0]).toEqual({ first: 'Alex', last: 'Rivera', car: '' });
  });

  it('ignores blank lines', () => {
    const parsed = parseCsv('first,last\nAlex,Rivera\n\n\nSam,Okafor\n');

    expect(parsed.rows).toHaveLength(2);
  });

  it('trims surrounding whitespace', () => {
    const parsed = parseCsv(' first , last \n Alex , Rivera ');

    expect(parsed.headers).toEqual(['first', 'last']);
    expect(parsed.rows[0]).toEqual({ first: 'Alex', last: 'Rivera' });
  });

  it('refuses an empty file', () => {
    expect(() => parseCsv('')).toThrow(/empty/i);
    expect(() => parseCsv('\n\n')).toThrow(/empty/i);
  });
});

describe('guessMapping', () => {
  it('matches the canonical headers', () => {
    const guess = guessMapping(['first_name', 'last_name', 'car_number', 'racingGroup']);

    expect(guess.firstName).toBe('first_name');
    expect(guess.lastName).toBe('last_name');
    expect(guess.carNumber).toBe('car_number');
    expect(guess.racingGroup).toBe('racingGroup');
  });

  it('ignores case, spaces and punctuation', () => {
    const guess = guessMapping(['First Name', 'LAST-NAME', 'Car #']);

    expect(guess.firstName).toBe('First Name');
    expect(guess.lastName).toBe('LAST-NAME');
    expect(guess.carNumber).toBe('Car #');
  });

  it('finds a hint inside a longer header', () => {
    // How a pack's own spreadsheet actually labels things.
    const guess = guessMapping(['Scout First Name', 'Racer Last Name', 'Pinewood Car Number']);

    expect(guess.firstName).toBe('Scout First Name');
    expect(guess.lastName).toBe('Racer Last Name');
    expect(guess.carNumber).toBe('Pinewood Car Number');
  });

  it('will not match a short hint as a substring', () => {
    // `no` would otherwise claim `Notes`, and a wrong guess the operator has to
    // spot and undo is worse than a dropdown left on "Not included".
    const guess = guessMapping(['Notes', 'Nominee']);

    expect(guess.carNumber).toBeNull();
  });

  it('does not let a loose hint steal a column another field matches exactly', () => {
    // `carNumber` hints on a bare `car`, which would otherwise claim `Car Name`
    // before `carName` is considered.
    const guess = guessMapping(['Car Name', 'Car']);

    expect(guess.carName).toBe('Car Name');
    expect(guess.carNumber).toBe('Car');
  });

  it('never maps one column to two fields', () => {
    // This header contains both `firstname` and `lastname`, so without the
    // claim check both fields would point at the one column and the import
    // would put the whole string in each. Better that Last Name stays empty:
    // `validate` then blocks the import and the operator has to split it.
    const guess = guessMapping(['First Name and Last Name']);

    expect(guess.firstName).toBe('First Name and Last Name');
    expect(guess.lastName).toBeNull();

    const used = Object.values(guess).filter((h) => h !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves a field unmapped when nothing resembles it', () => {
    const guess = guessMapping(['Scout', 'Troop']);

    expect(guess.firstName).toBeNull();
    expect(guess.carNumber).toBeNull();
  });
});

describe('validate', () => {
  const parsed = (csv: string) => parseCsv(csv);

  it('blocks the import when a name column is unmapped', () => {
    const file = parsed('who\nAlex Rivera');
    const problems = validate(applyMapping(file, mapping({ firstName: 'who' })), mapping({ firstName: 'who' }));

    expect(canImport(problems)).toBe(false);
    expect(problems[0].message).toMatch(/First Name and Last Name/);
  });

  it('warns about a row the backend would silently skip', () => {
    // This is the case that used to report "Successfully imported 1 racers"
    // with no hint that the other row vanished.
    const map = mapping({ firstName: 'first', lastName: 'last' });
    const problems = validate(applyMapping(parsed('first,last\nAlex,Rivera\nSam,'), map), map);

    expect(canImport(problems)).toBe(true);
    expect(problems).toEqual([{ line: 3, message: expect.stringMatching(/skipped/) }]);
  });

  it('reports a duplicate car number against the line it first appeared on', () => {
    const map = mapping({ firstName: 'first', lastName: 'last', carNumber: 'car' });
    const csv = 'first,last,car\nAlex,Rivera,7\nSam,Okafor,7';
    const problems = validate(applyMapping(parsed(csv), map), map);

    expect(problems).toEqual([{ line: 3, message: 'Car number 7 is already used on line 2.' }]);
  });

  it('reports a car number that is not a number', () => {
    const map = mapping({ firstName: 'first', lastName: 'last', carNumber: 'car' });
    const problems = validate(applyMapping(parsed('first,last,car\nAlex,Rivera,A12'), map), map);

    expect(problems[0].message).toMatch(/not a whole number/);
  });

  it('accepts the usual spellings of yes and no', () => {
    const map = mapping({ firstName: 'first', lastName: 'last', passedInspection: 'ok' });
    const csv = 'first,last,ok\nA,B,Yes\nC,D,n\nE,F,TRUE\nG,H,0\nI,J,x\nK,L,';

    expect(validate(applyMapping(parsed(csv), map), map)).toEqual([]);
  });

  it('warns about an inspection value it cannot read', () => {
    const map = mapping({ firstName: 'first', lastName: 'last', passedInspection: 'ok' });
    const problems = validate(applyMapping(parsed('first,last,ok\nA,B,maybe'), map), map);

    expect(problems[0].message).toMatch(/yes or no/);
  });

  it('blocks a file with headers and nothing else', () => {
    const map = mapping({ firstName: 'first', lastName: 'last' });

    expect(canImport(validate([], map))).toBe(false);
  });

  it('passes a clean file', () => {
    const map = mapping({ firstName: 'first', lastName: 'last', carNumber: 'car', racingGroup: 'racingGroup' });
    const csv = 'first,last,car,racingGroup\nAlex,Rivera,1,Wolves\nSam,Okafor,2,Bears';

    expect(validate(applyMapping(parsed(csv), map), map)).toEqual([]);
  });
});

describe('toCanonicalCsv', () => {
  it('writes the headers the backend reads', () => {
    const map = mapping({ firstName: 'A', lastName: 'B', carNumber: 'C' });
    const rows = applyMapping(parseCsv('A,B,C\nAlex,Rivera,7'), map);

    expect(toCanonicalCsv(rows, map)).toBe('first_name,last_name,car_number\nAlex,Rivera,7');
  });

  it('omits a column for an unmapped field', () => {
    // An empty Racing Group column would otherwise have the backend create a racing group named "".
    const map = mapping({ firstName: 'A', lastName: 'B' });
    const rows = applyMapping(parseCsv('A,B\nAlex,Rivera'), map);

    expect(toCanonicalCsv(rows, map)).not.toMatch(/racing_group/);
  });

  it('normalizes inspection values to yes and no', () => {
    const map = mapping({ firstName: 'A', lastName: 'B', passedInspection: 'C' });
    const rows = applyMapping(parseCsv('A,B,C\nAlex,Rivera,TRUE\nSam,Okafor,nope'), map);

    expect(toCanonicalCsv(rows, map).split('\n').slice(1)).toEqual([
      'Alex,Rivera,yes',
      'Sam,Okafor,no',
    ]);
  });

  it('re-quotes a value containing a comma', () => {
    const map = mapping({ firstName: 'A', lastName: 'B', carName: 'C' });
    const rows = applyMapping(parseCsv('A,B,C\nAlex,Rivera,"Lightning, Jr."'), map);

    expect(toCanonicalCsv(rows, map)).toContain('"Lightning, Jr."');
  });

  it('re-quotes a value containing a quote', () => {
    const map = mapping({ firstName: 'A', lastName: 'B', carName: 'C' });
    const rows = applyMapping(parseCsv('A,B,C\nAlex,Rivera,"The ""Rocket"""'), map);

    expect(toCanonicalCsv(rows, map)).toContain('"The ""Rocket"""');
  });

  it('round-trips through parseCsv', () => {
    const map = mapping({ firstName: 'A', lastName: 'B', carName: 'C' });
    const rows = applyMapping(parseCsv('A,B,C\nAlex,Rivera,"Lightning, Jr."'), map);

    const reparsed = parseCsv(toCanonicalCsv(rows, map));

    expect(reparsed.rows[0]).toEqual({
      first_name: 'Alex',
      last_name: 'Rivera',
      car_name: 'Lightning, Jr.',
    });
  });
});

describe('templateCsv', () => {
  it('is a file this module can read back', () => {
    const parsed = parseCsv(templateCsv());
    const guess = guessMapping(parsed.headers);

    expect(canImport(validate(applyMapping(parsed, guess), guess))).toBe(true);
    expect(validate(applyMapping(parsed, guess), guess)).toEqual([]);
  });
});
