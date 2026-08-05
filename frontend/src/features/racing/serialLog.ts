/**
 * Turning the timer's raw serial log into something a human can read.
 *
 * Pure — no React. It was inline in `HardwareTimerMole.tsx`, which put it
 * behind a panel that only exists inside a running heat; the diagnostics page
 * needs the same rendering before there is a race to run.
 *
 * The annotations describe the MicroWizard's protocol, which is the only real
 * device we support. They are here rather than on the server because they are
 * a reading aid, not protocol: the backend's `TimerProfile` is what actually
 * decides what a byte sequence means, and nothing here is consulted for that.
 * If a second device ever ships, these need to come from the active profile
 * rather than from a table that assumes one.
 */

export interface SerialLogEntry {
    direction: string;
    data: string;
    timestamp: string;
}

export interface DisplayLine {
    direction: string;
    data: string;
    description?: string;
}

/** What we sent, in words. */
export function describeCommand(data: string): string | undefined {
    const cmd = data.trim().toUpperCase();
    if (cmd === 'N1') return 'enable new-format results';
    if (cmd === 'N2') return 'enable gate feedback';
    if (cmd === 'LR') return 'arm / reset timer';
    if (cmd === 'MG') return 'clear lane masks';
    if (cmd === 'RA') return 'force results';
    if (cmd === 'RV') return 'request version';
    if (cmd.length === 2 && cmd[0] === 'M' && cmd[1] >= 'A' && cmd[1] <= 'P') {
        const lane = cmd.charCodeAt(1) - 'A'.charCodeAt(0) + 1;
        return `mask lane ${lane}`;
    }
    return undefined;
}

/**
 * What came back, in words.
 *
 * The line terminators are stripped first. They reach us as the literal
 * two-character text `\r` and `\n` — the server escapes unprintable bytes for
 * display — so `trim()` does nothing to them, and a response accumulated as
 * `*\r\n` never matched the `*` this table is keyed on. Every acknowledgement
 * in the log went unannotated because of it.
 */
export function describeResponse(data: string): string | undefined {
    const d = data.replace(/\\r|\\n/g, '').trim().toUpperCase();
    if (d === 'AC') return 'command acknowledged';
    if (d === '*') return 'command acknowledged';
    if (d === '@') return 'gate opened - race started';
    if (d === '>') return 'gate closed';
    if (d.includes('MICRO WIZARD')) return 'timer identified itself';
    if (d.includes('=')) return 'results received';
    return undefined;
}

/**
 * Group raw log entries into display lines.
 *
 * TX entries are whole commands, so each is its own line. RX entries are
 * whatever came off the wire in one read, so they are accumulated and flushed
 * on a delimiter — or on `@` / `>`, which are complete messages wherever they
 * appear and would otherwise be buried in the middle of a line.
 *
 * The escape sequences are literal two-character text: the server formats
 * unprintable bytes for display before they ever reach here.
 */
export function buildDisplayLines(entries: SerialLogEntry[]): DisplayLine[] {
    const lines: DisplayLine[] = [];
    let currentDir = '';
    let currentData = '';

    // Nothing accumulated is nothing to show. Without the `currentData` guard,
    // every direction change that followed a command emitted a blank line,
    // because a TX entry flushes itself and then the next RX flushes the empty
    // remainder.
    const flush = (description?: string) => {
        if (currentDir && currentData) {
            lines.push({ direction: currentDir, data: currentData, description });
        }
        currentData = '';
    };

    for (const entry of entries) {
        if (entry.direction !== currentDir) {
            flush();
            currentDir = entry.direction;
        }
        if (entry.direction === 'TX') {
            currentData = entry.data;
            flush(describeCommand(entry.data));
        } else {
            const parts = entry.data.split(/(\\r\\n|\\r|\\n|[@>])/);
            for (const part of parts) {
                if (!part) continue;
                currentData += part;
                if (part === '\\r\\n' || part === '\\r' || part === '\\n' || part === '@' || part === '>') {
                    flush(describeResponse(currentData));
                }
            }
        }
    }

    if (currentData) flush(describeResponse(currentData));
    return lines;
}
