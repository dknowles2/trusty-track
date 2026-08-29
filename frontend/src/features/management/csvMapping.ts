/**
 * Reading an arbitrary roster CSV — parsing, guessing the columns, and
 * checking the result before anything is sent.
 *
 * Pure: no React, no urql. The modal renders what these functions return and
 * owns nothing but the current mapping. That is what lets `csvMapping.test.ts`
 * cover the awkward cases — quoted commas, an Excel BOM, ragged rows,
 * duplicate car numbers — without a DOM.
 *
 * The import mutation still takes a CSV string, so the last step here writes
 * one back out with the headers the backend knows. The operator's file is never
 * what gets sent: what gets sent is what they saw in the preview.
 */

/** A field a racer can be imported with. */
export type Field =
  | 'firstName'
  | 'lastName'
  | 'carNumber'
  | 'carName'
  | 'racingGroup'
  | 'passedInspection';

export const FIELDS: readonly Field[] = [
  'firstName',
  'lastName',
  'carNumber',
  'carName',
  'racingGroup',
  'passedInspection',
] as const;

export const FIELD_LABELS: Record<Field, string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  carNumber: 'Car Number',
  carName: 'Car Name',
  racingGroup: 'Racing Group',
  passedInspection: 'Passed Inspection',
};

/** The header each field is written out as — what `import_racers` reads. */
const CANONICAL_HEADER: Record<Field, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  carNumber: 'car_number',
  carName: 'car_name',
  racingGroup: 'racing_group',
  passedInspection: 'car_passed_inspection',
};

/**
 * Column name fragments that suggest a field, most specific first.
 *
 * Matched against the header with punctuation and spacing removed, so
 * `Car #`, `car_number` and `CarNumber` all reduce to `carnumber`.
 */
const HINTS: Record<Field, readonly string[]> = {
  firstName: ['firstname', 'first', 'givenname', 'forename'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  carNumber: ['carnumber', 'carno', 'carnum', 'car', 'number', 'no'],
  carName: ['carname', 'nameofcar', 'cartitle'],
  // Header aliases a real-world roster CSV might use — kept as the literal
  // words a Scouting-flavored spreadsheet contains, independent of what the
  // app calls the concept internally (#496).
  racingGroup: ['den', 'group', 'pack', 'rank', 'unit'],
  passedInspection: ['passedinspection', 'inspection', 'passed', 'inspected'],
};

/** A field with nothing mapped to it. */
export const UNMAPPED = null;

export type Mapping = Record<Field, string | null>;

export interface ParsedCsv {
  /** Header names exactly as they appear in the file. */
  headers: string[];
  /** One record per data row, keyed by header. */
  rows: Record<string, string>[];
}

const normalize = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Split CSV text into fields, honouring quotes.
 *
 * A hand-rolled parser rather than a dependency: this reads one small file
 * chosen by the operator, and the rules that matter are quoted fields and the
 * doubled quotes inside them. Anything stranger than that is a file we should
 * be showing an error for, not silently interpreting.
 *
 * The BOM Excel writes needs no handling of its own: `parseCsv` trims every
 * header, and `String.prototype.trim` counts U+FEFF as whitespace. There is a
 * test for the whole path because that is a surprising thing to rely on.
 */
function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // CRLF splits twice and leaves an empty row; the filter at the end of
      // this function drops it, along with blank lines mid-file.
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // A trailing newline leaves one empty row; so does a blank line mid-file.
  return rows.filter((r) => r.some((value) => value.trim() !== ''));
}

/** Parse CSV text into headers and keyed rows. Throws on an empty file. */
export function parseCsv(text: string): ParsedCsv {
  const rows = splitRows(text);
  if (rows.length === 0) throw new Error('That file is empty.');

  const headers = rows[0].map((h) => h.trim());
  if (headers.every((h) => h === '')) throw new Error('That file has no column headers.');

  return {
    headers,
    // Ragged rows are normal in hand-edited files: a short row leaves the
    // remaining fields empty rather than dropping the racer.
    rows: rows.slice(1).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? '').trim()])),
    ),
  };
}

/**
 * A best guess at which column feeds which field.
 *
 * Two passes, and no column is ever used twice. The first takes only exact
 * matches, in `HINTS` order, so a file with both `Car` and `Car Name` does not
 * let `carNumber`'s loose `car` hint eat the column `carName` wanted — every
 * field's first hint is its own label, which is what makes that ordering safe.
 * The second allows a hint to appear inside a longer header.
 */
export function guessMapping(headers: readonly string[]): Mapping {
  const mapping = Object.fromEntries(FIELDS.map((f) => [f, UNMAPPED])) as Mapping;
  const taken = new Set<string>();

  const claim = (field: Field, header: string) => {
    mapping[field] = header;
    taken.add(header);
  };

  const available = (header: string) => !taken.has(header) && header !== '';

  for (const field of FIELDS) {
    for (const hint of HINTS[field]) {
      const match = headers.find((h) => available(h) && normalize(h) === hint);
      if (match) {
        claim(field, match);
        break;
      }
    }
  }

  // A hint appearing *inside* the header, which is how real rosters are
  // labelled — `Scout First Name`, `Racer Last`, `Pinewood Car Number`.
  //
  // Only hints of four characters or more: `no` and `car` as substrings would
  // match almost anything, and a wrong guess the operator has to notice and
  // undo is worse than a dropdown left on "Not included".
  for (const field of FIELDS) {
    if (mapping[field] !== UNMAPPED) continue;
    for (const hint of HINTS[field]) {
      if (hint.length < 4) continue;
      const match = headers.find((h) => available(h) && normalize(h).includes(hint));
      if (match) {
        claim(field, match);
        break;
      }
    }
  }

  return mapping;
}

export interface RacerRow {
  firstName: string;
  lastName: string;
  carNumber: string;
  carName: string;
  racingGroup: string;
  passedInspection: string;
}

/** The rows as they would import, in file order. */
export function applyMapping(parsed: ParsedCsv, mapping: Mapping): RacerRow[] {
  const read = (row: Record<string, string>, field: Field): string => {
    const header = mapping[field];
    return header === UNMAPPED ? '' : (row[header] ?? '');
  };

  return parsed.rows.map((row) => ({
    firstName: read(row, 'firstName'),
    lastName: read(row, 'lastName'),
    carNumber: read(row, 'carNumber'),
    carName: read(row, 'carName'),
    racingGroup: read(row, 'racingGroup'),
    passedInspection: read(row, 'passedInspection'),
  }));
}

export interface Problem {
  /** 1-based row number as the operator sees it in a spreadsheet, header included. */
  line: number;
  message: string;
}

const TRUTHY = new Set(['y', 'yes', 'true', '1', 'x', 'passed', 'pass']);
const FALSY = new Set(['', 'n', 'no', 'false', '0', 'failed', 'fail']);

/**
 * What is wrong with this import, in the order the operator would find it.
 *
 * Reported before anything is sent, because the backend's answer to a row it
 * cannot use is to skip it and return a count — so a file whose names are in
 * one `Name` column imports zero racers and says only "Successfully imported 0".
 */
export function validate(rows: readonly RacerRow[], mapping: Mapping): Problem[] {
  const problems: Problem[] = [];

  if (mapping.firstName === UNMAPPED || mapping.lastName === UNMAPPED) {
    problems.push({
      line: 0,
      message: 'First Name and Last Name have to be mapped — a racer needs both.',
    });
    return problems;
  }

  if (rows.length === 0) {
    problems.push({ line: 0, message: 'That file has headers but no rows.' });
    return problems;
  }

  const seenNumbers = new Map<string, number>();

  rows.forEach((row, index) => {
    const line = index + 2; // 1-based, and the header is line 1.

    if (!row.firstName || !row.lastName) {
      problems.push({ line, message: 'Missing a first or last name — this row will be skipped.' });
    }

    if (row.carNumber !== '') {
      if (!/^\d+$/.test(row.carNumber)) {
        problems.push({
          line,
          message: `Car number "${row.carNumber}" is not a whole number — it will be left blank.`,
        });
      } else {
        const first = seenNumbers.get(row.carNumber);
        if (first !== undefined) {
          problems.push({
            line,
            message: `Car number ${row.carNumber} is already used on line ${first}.`,
          });
        } else {
          seenNumbers.set(row.carNumber, line);
        }
      }
    }

    if (row.passedInspection !== '') {
      const value = row.passedInspection.toLowerCase();
      if (!TRUTHY.has(value) && !FALSY.has(value)) {
        problems.push({
          line,
          message: `Cannot read "${row.passedInspection}" as yes or no — it will be treated as no.`,
        });
      }
    }
  });

  return problems;
}

/** Whether the import can go ahead. Individual row problems are warnings. */
export function canImport(problems: readonly Problem[]): boolean {
  return !problems.some((p) => p.line === 0);
}

const quote = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * The mapped rows as a CSV the backend already understands.
 *
 * Only mapped fields become columns, so an unmapped RacingGroup does not send a column
 * of empty strings that would otherwise create a racingGroup named "".
 */
export function toCanonicalCsv(rows: readonly RacerRow[], mapping: Mapping): string {
  const fields = FIELDS.filter((field) => mapping[field] !== UNMAPPED);
  const lines = [fields.map((f) => CANONICAL_HEADER[f]).join(',')];

  for (const row of rows) {
    lines.push(
      fields
        .map((field) => {
          if (field === 'passedInspection') {
            return TRUTHY.has(row.passedInspection.toLowerCase()) ? 'yes' : 'no';
          }
          return quote(row[field]);
        })
        .join(','),
    );
  }

  return lines.join('\n');
}

/** A starter file with the headers we read, for an operator with nothing yet. */
export function templateCsv(): string {
  return [
    FIELDS.map((f) => CANONICAL_HEADER[f]).join(','),
    'Alex,Rivera,101,Blue Streak,Wolf RacingGroup,yes',
    'Sam,Okafor,102,Thunderbolt,Wolf RacingGroup,yes',
  ].join('\n');
}
