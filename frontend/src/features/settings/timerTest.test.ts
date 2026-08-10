import { describe, expect, it } from 'vitest';
import { filenameFrom, issueUrl, testInstruction } from './timerTest';

describe('testInstruction', () => {
    it('gives one physical action per state', () => {
        expect(testInstruction('ARMED')).toMatch(/close the start gate/i);
        expect(testInstruction('READY')).toMatch(/open it/i);
        expect(testInstruction('RUNNING')).toMatch(/finish-line sensor/i);
    });

    it('treats a missing finish as itself reportable', () => {
        expect(testInstruction('RESULTS_OVERDUE')).toMatch(/worth\s+reporting/i);
    });

    it('says nothing outside a test', () => {
        expect(testInstruction('IDLE')).toBeNull();
        expect(testInstruction('DISCONNECTED')).toBeNull();
    });
});

describe('issueUrl', () => {
    it('names the device in the title', () => {
        const url = new URL(
            issueUrl({ deviceName: 'PDT', state: 'IDLE', lastError: null, resultsSeen: true }),
        );

        expect(url.hostname).toBe('github.com');
        expect(url.searchParams.get('title')).toBe('Timer report: PDT');
    });

    it('asks for the report file rather than a serial-log transcription', () => {
        // Asking a volunteer to describe serial traffic in prose is the
        // failure this feature replaces.
        const url = new URL(
            issueUrl({ deviceName: 'PDT', state: 'IDLE', lastError: null, resultsSeen: true }),
        );

        expect(url.searchParams.get('body')).toMatch(/attach the report file/i);
    });

    it('carries the failure summary when nothing arrived', () => {
        const url = new URL(
            issueUrl({
                deviceName: null,
                state: 'RESULTS_OVERDUE',
                lastError: 'gate never opened',
                resultsSeen: false,
            }),
        );

        const body = url.searchParams.get('body')!;
        expect(body).toMatch(/no results arrived/);
        expect(body).toMatch(/gate never opened/);
        expect(url.searchParams.get('title')).toBe('Timer report: Unknown timer');
    });
});

describe('filenameFrom', () => {
    it('prefers the server-sent name', () => {
        expect(
            filenameFrom('attachment; filename="timer-report.json"', 3),
        ).toBe('timer-report.json');
    });

    it('falls back to a per-track name', () => {
        expect(filenameFrom(null, 3)).toBe('trusty-track-timer-report-track-3.json');
    });
});
