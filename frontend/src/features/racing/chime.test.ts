import { describe, expect, it } from 'vitest';
import { chimeEnabled, setChimeEnabled, shouldChime } from './chime';

function storage(initial: Record<string, string> = {}) {
    const values = { ...initial };
    return {
        getItem: (key: string) => values[key] ?? null,
        setItem: (key: string, value: string) => {
            values[key] = value;
        },
    };
}

describe('shouldChime', () => {
    it('sounds when a heat finishes', () => {
        expect(shouldChime('RUNNING', 'RECORDED')).toBe(true);
    });

    it('does not sound again while the heat stays on screen', () => {
        // `RECORDED` persists for as long as the operator leaves that heat up,
        // and a payload arrives for every lane time and every check-in.
        expect(shouldChime('RECORDED', 'RECORDED')).toBe(false);
    });

    it('does not sound on the first payload after a reload', () => {
        // Reloading the operator's laptop between heats would otherwise
        // announce a result nobody had just produced.
        expect(shouldChime(null, 'RECORDED')).toBe(false);
    });

    it('does not sound for any other transition', () => {
        expect(shouldChime('WAITING', 'RUNNING')).toBe(false);
        expect(shouldChime('RECORDED', 'WAITING')).toBe(false);
        expect(shouldChime('NO_HEAT', 'NOT_READY')).toBe(false);
    });

    it('sounds when a heat is re-run and recorded again', () => {
        // Clearing a result takes the phase away from RECORDED, so the next
        // one is a fresh edge and the room hears it.
        expect(shouldChime('WAITING', 'RECORDED')).toBe(true);
    });
});

describe('chimeEnabled', () => {
    it('is off on a device that has never been asked', () => {
        // A laptop that starts beeping unbidden in front of sixty families is
        // a worse first impression than silence.
        expect(chimeEnabled(storage())).toBe(false);
    });

    it('is on once switched on', () => {
        const store = storage();
        setChimeEnabled(store, true);

        expect(chimeEnabled(store)).toBe(true);
    });

    it('is off once switched off again', () => {
        const store = storage();
        setChimeEnabled(store, true);
        setChimeEnabled(store, false);

        expect(chimeEnabled(store)).toBe(false);
    });

    it('treats an unrecognised stored value as off', () => {
        expect(chimeEnabled(storage({ 'trustytrack.finishChime': 'maybe' }))).toBe(false);
    });
});
