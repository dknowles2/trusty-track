/**
 * CSV, for the export buttons (#173).
 *
 * Lifted out of `RaceStats.tsx`, which had the only copy, so the Standings
 * page can export too rather than growing a second one.
 *
 * The escaping is the reason this is a module with tests rather than three
 * lines inlined again. The original wrapped every field in quotes and did
 * nothing else, which is correct until a field contains a quote — and car
 * names are free text a nine-year-old chose, so `The "Beast"` is not a
 * hypothetical. RFC 4180 doubles an embedded quote; without that the row is
 * malformed from that field onwards and a spreadsheet silently shifts every
 * later column.
 */

export type CsvValue = string | number | null | undefined;
export type CsvRow = CsvValue[];

/**
 * One field, quoted.
 *
 * Everything is quoted rather than only what needs it: it costs a few bytes,
 * and "quote when the value contains a comma, a quote, a newline, or leading
 * whitespace" is a rule with more ways to be wrong than to be right.
 *
 * Formula injection (#771): cells beginning with `=`, `+`, `-`, `@`, `\t`, or `\r`
 * are treated as formulas by spreadsheet applications (Excel, LibreOffice) even when
 * quoted. Prepending a single quote (`'`) forces the spreadsheet to treat the cell as
 * plain text.
 */
export function csvField(value: CsvValue): string {
    const text = value ?? '';
    const str = String(text);
    const sanitized =
        typeof value === 'string' && /^[=+\-@\t\r]/.test(value)
            ? `'${value}`
            : str;
    return `"${sanitized.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly CsvRow[]): string {
    // CRLF, which is what RFC 4180 says and what Excel wants. A lone \n is
    // read correctly by everything else, so this costs nothing.
    return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}

/**
 * Hand the browser a file.
 *
 * Kept beside the formatter because every caller wants both, and separating
 * them only invites a second `Blob`/`revokeObjectURL` dance somewhere else.
 */
export function downloadCsv(filename: string, rows: readonly CsvRow[]): void {
    // The BOM is for Excel, which otherwise reads a UTF-8 file as the local
    // code page and mangles any name with an accent in it.
    const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
}

/**
 * A race name, as a filename fragment.
 *
 * Race names are free text and go straight into `a.download`. A slash there
 * is the interesting one — browsers differ on whether it becomes a directory
 * separator, and "Pack 42 / RacingGroup 3" is an ordinary thing to call a race.
 */
export function filenameFor(raceName: string, suffix: string): string {
    const safe = raceName
        .replace(/[/\\:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    return `${safe || 'race'}-${suffix}.csv`;
}
