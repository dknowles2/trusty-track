import { describe, it, expect } from 'vitest';
import { buildDisplayLines, describeCommand, describeResponse } from './serialLog';
import type { SerialLogEntry } from './serialLog';

const rx = (data: string): SerialLogEntry => ({ direction: 'RX', data, timestamp: '' });
const tx = (data: string): SerialLogEntry => ({ direction: 'TX', data, timestamp: '' });

describe('describeCommand', () => {
    it('names the commands the profile sends', () => {
        expect(describeCommand('N1')).toBe('enable new-format results');
        expect(describeCommand('N2')).toBe('enable gate feedback');
        expect(describeCommand('RV')).toBe('request version');
        expect(describeCommand('LR')).toBe('arm / reset timer');
    });

    it('works out which lane a mask command is for', () => {
        expect(describeCommand('MA')).toBe('mask lane 1');
        expect(describeCommand('MF')).toBe('mask lane 6');
    });

    it('says nothing rather than guessing', () => {
        expect(describeCommand('ZZ')).toBeUndefined();
    });
});

describe('describeResponse', () => {
    it('names the signals that matter on race day', () => {
        expect(describeResponse('@')).toBe('gate opened - race started');
        expect(describeResponse('>')).toBe('gate closed');
        expect(describeResponse('*')).toBe('command acknowledged');
        expect(describeResponse('AC')).toBe('command acknowledged');
    });

    it('recognises the identification banner', () => {
        // The line that takes a timer out of "Connecting..." — the one an
        // operator is looking for when they open the log at all.
        expect(describeResponse('Copyright (c) Micro Wizard 2002-2009')).toBe(
            'timer identified itself'
        );
    });

    it('recognises results', () => {
        expect(describeResponse('A=3.001! B=3.002"')).toBe('results received');
    });
});

describe('buildDisplayLines', () => {
    it('gives each command its own annotated line', () => {
        expect(buildDisplayLines([tx('N1'), tx('N2')])).toEqual([
            { direction: 'TX', data: 'N1', description: 'enable new-format results' },
            { direction: 'TX', data: 'N2', description: 'enable gate feedback' },
        ]);
    });

    it('reassembles a response split across reads', () => {
        // Serial bytes arrive when they arrive; the log records each read.
        const lines = buildDisplayLines([rx('A=3.0'), rx('01!\\r\\n')]);

        expect(lines).toEqual([
            { direction: 'RX', data: 'A=3.001!\\r\\n', description: 'results received' },
        ]);
    });

    it('splits a read that carries several responses', () => {
        const lines = buildDisplayLines([rx('\\r\\n*\\r\\n*\\r\\n')]);

        expect(lines.map(l => l.description)).toEqual([
            undefined,
            'command acknowledged',
            'command acknowledged',
        ]);
    });

    it('breaks out the gate signals, which are messages on their own', () => {
        // '@' and '>' arrive without a terminator and mean something
        // immediately, so burying them mid-line would hide the moment the
        // race started.
        const lines = buildDisplayLines([rx('@')]);

        expect(lines).toEqual([
            { direction: 'RX', data: '@', description: 'gate opened - race started' },
        ]);
    });

    it('starts a new line when the direction changes', () => {
        const lines = buildDisplayLines([rx('AC'), tx('LR'), rx('*')]);

        expect(lines.map(l => l.direction)).toEqual(['RX', 'TX', 'RX']);
    });

    it('shows a response that never got its terminator', () => {
        // Otherwise the last thing a timer said before going quiet — often the
        // most interesting line in the log — is the one the operator cannot
        // see.
        expect(buildDisplayLines([rx('partial')])).toEqual([
            { direction: 'RX', data: 'partial', description: undefined },
        ]);
    });

    it('has nothing to show for an empty log', () => {
        expect(buildDisplayLines([])).toEqual([]);
    });
});
