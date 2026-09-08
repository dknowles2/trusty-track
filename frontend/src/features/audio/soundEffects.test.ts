import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_SOUND_SETTINGS,
    FINISH_CHIME_STORAGE_KEY,
    isSoundEffectEnabled,
    playAwardFanfareSound,
    playFinishSound,
    playGateReleaseSound,
    playRecordBreakSound,
    playSound,
    playStagingReadySound,
    readSoundSettings,
    shouldAwardFanfareSound,
    shouldChime,
    shouldFinishSound,
    shouldGateReleaseSound,
    shouldRecordBreakSound,
    shouldStagingReadySound,
    SOUND_PATTERNS,
    SOUND_STORAGE_KEY,
    writeSoundSettings,
    type SoundEffectsSettings,
} from './soundEffects';

function mockStorage(initial: Record<string, string> = {}) {
    const values = { ...initial };
    return {
        getItem: vi.fn((key: string) => values[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
            values[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
            delete values[key];
        }),
    };
}

describe('soundEffects settings storage', () => {
    it('returns default settings (off by default) when storage is empty', () => {
        const store = mockStorage();
        const settings = readSoundSettings(store);
        expect(settings).toEqual(DEFAULT_SOUND_SETTINGS);
        expect(settings.master).toBe(false);
    });

    it('migrates legacy finish chime storage when present and master unset', () => {
        const store = mockStorage({ [FINISH_CHIME_STORAGE_KEY]: 'on' });
        const settings = readSoundSettings(store);
        expect(settings.master).toBe(true);
        expect(settings.finish).toBe(true);
    });

    it('saves and reads updated settings', () => {
        const store = mockStorage();
        const custom: SoundEffectsSettings = {
            master: true,
            stagingReady: true,
            gateRelease: false,
            finish: true,
            recordBreak: true,
            awardFanfare: false,
        };
        writeSoundSettings(store, custom);

        expect(store.setItem).toHaveBeenCalledWith(SOUND_STORAGE_KEY, JSON.stringify(custom));
        // Keeps legacy finish chime in sync
        expect(store.setItem).toHaveBeenCalledWith(FINISH_CHIME_STORAGE_KEY, 'on');

        const reloaded = readSoundSettings(store);
        expect(reloaded).toEqual(custom);
    });

    it('syncs legacy finish chime to off when finish is disabled or master is off', () => {
        const store = mockStorage();
        writeSoundSettings(store, {
            ...DEFAULT_SOUND_SETTINGS,
            master: true,
            finish: false,
        });
        expect(store.setItem).toHaveBeenCalledWith(FINISH_CHIME_STORAGE_KEY, 'off');

        writeSoundSettings(store, {
            ...DEFAULT_SOUND_SETTINGS,
            master: false,
            finish: true,
        });
        expect(store.setItem).toHaveBeenCalledWith(FINISH_CHIME_STORAGE_KEY, 'off');
    });

    it('safely handles corrupted json or storage errors', () => {
        const store = {
            getItem: () => '{ invalid json ...',
            setItem: () => {},
        };
        const settings = readSoundSettings(store);
        expect(settings).toEqual(DEFAULT_SOUND_SETTINGS);
    });

    it('correctly reports isSoundEffectEnabled based on master and per-effect flag', () => {
        const store = mockStorage();
        expect(isSoundEffectEnabled('finish', store)).toBe(false);

        writeSoundSettings(store, {
            master: true,
            stagingReady: false,
            gateRelease: true,
            finish: true,
            recordBreak: true,
            awardFanfare: true,
        });

        expect(isSoundEffectEnabled('gateRelease', store)).toBe(true);
        expect(isSoundEffectEnabled('stagingReady', store)).toBe(false);
    });
});

describe('event trigger predicates', () => {
    describe('shouldFinishSound / shouldChime', () => {
        it('sounds when a heat completes', () => {
            expect(shouldFinishSound('RUNNING', 'RECORDED')).toBe(true);
            expect(shouldChime('RUNNING', 'RECORDED')).toBe(true);
            expect(shouldFinishSound('WAITING', 'RECORDED')).toBe(true);
        });

        it('does not sound when heat is not recorded or already recorded', () => {
            expect(shouldFinishSound('RECORDED', 'RECORDED')).toBe(false);
            expect(shouldFinishSound(null, 'RECORDED')).toBe(false);
            expect(shouldFinishSound('WAITING', 'RUNNING')).toBe(false);
        });
    });

    describe('shouldGateReleaseSound', () => {
        it('sounds when transitioning to RUNNING from WAITING or NOT_READY', () => {
            expect(shouldGateReleaseSound('WAITING', 'RUNNING')).toBe(true);
            expect(shouldGateReleaseSound('NOT_READY', 'RUNNING')).toBe(true);
        });

        it('does not sound on initial load or non-running transitions', () => {
            expect(shouldGateReleaseSound(null, 'RUNNING')).toBe(false);
            expect(shouldGateReleaseSound('RUNNING', 'RUNNING')).toBe(false);
            expect(shouldGateReleaseSound('WAITING', 'RECORDED')).toBe(false);
        });
    });

    describe('shouldStagingReadySound', () => {
        it('sounds on any arrival at WAITING, stated as an edge rather than a list of previous phases', () => {
            expect(shouldStagingReadySound('NOT_READY', 'WAITING')).toBe(true);
            expect(shouldStagingReadySound('NO_HEAT', 'WAITING')).toBe(true);
            // #872 — the transition that actually happens when a heat is
            // staged on race day: advancing to the next heat by button,
            // Space, or auto-advance. An earlier version only named
            // NOT_READY/NO_HEAT -> WAITING, which excluded this — the common
            // case — so the sound fired at most once per round.
            expect(shouldStagingReadySound('RECORDED', 'WAITING')).toBe(true);
            // An abort re-arms the gate too, the same shape `shouldFinishSound`
            // and `shouldGateReleaseSound` already give any non-excluded prior
            // phase.
            expect(shouldStagingReadySound('RUNNING', 'WAITING')).toBe(true);
        });

        it('does not sound on initial load or when already at WAITING', () => {
            expect(shouldStagingReadySound(null, 'WAITING')).toBe(false);
            expect(shouldStagingReadySound('WAITING', 'WAITING')).toBe(false);
        });

        it('does not sound on a transition that does not land on WAITING', () => {
            expect(shouldStagingReadySound('WAITING', 'RUNNING')).toBe(false);
            expect(shouldStagingReadySound('RUNNING', 'RECORDED')).toBe(false);
        });
    });

    describe('shouldRecordBreakSound', () => {
        it('sounds when new heat result carries recordBreak', () => {
            expect(shouldRecordBreakSound(true, { newSeconds: 3.123 })).toBe(true);
        });

        it('does not sound when result is not new or has no recordBreak', () => {
            expect(shouldRecordBreakSound(false, { newSeconds: 3.123 })).toBe(false);
            expect(shouldRecordBreakSound(true, null)).toBe(false);
            expect(shouldRecordBreakSound(true, undefined)).toBe(false);
        });
    });

    describe('shouldAwardFanfareSound', () => {
        it('sounds when stepping forward to an award slide', () => {
            expect(shouldAwardFanfareSound(0, 1, 5)).toBe(true);
            expect(shouldAwardFanfareSound(1, 2, 5)).toBe(true);
        });

        it('does not sound on initial load or stepping backwards', () => {
            expect(shouldAwardFanfareSound(null, 0, 5)).toBe(false);
            expect(shouldAwardFanfareSound(2, 1, 5)).toBe(false);
            expect(shouldAwardFanfareSound(2, 2, 5)).toBe(false);
            expect(shouldAwardFanfareSound(4, 5, 5)).toBe(false);
        });
    });
});

describe('sound patterns definition', () => {
    it('defines tones for all sound effects', () => {
        const effects = ['stagingReady', 'gateRelease', 'finish', 'recordBreak', 'awardFanfare'] as const;
        for (const effect of effects) {
            const notes = SOUND_PATTERNS[effect];
            expect(notes).toBeDefined();
            expect(notes.length).toBeGreaterThan(0);
            for (const note of notes) {
                expect(note.frequency).toBeGreaterThan(0);
                expect(note.lasts).toBeGreaterThan(0);
                expect(note.startsAt).toBeGreaterThanOrEqual(0);
            }
        }
    });
});

describe('audio playback safety and capability checks', () => {
    const originalAudioContext = window.AudioContext;
    const originalWebkit = (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;

    beforeEach(() => {
        delete (window as unknown as { AudioContext?: unknown }).AudioContext;
        delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
    });

    it('safely handles missing AudioContext without crashing', () => {
        expect(() => playSound('finish')).not.toThrow();
        expect(() => playFinishSound()).not.toThrow();
        expect(() => playGateReleaseSound()).not.toThrow();
        expect(() => playStagingReadySound()).not.toThrow();
        expect(() => playRecordBreakSound()).not.toThrow();
        expect(() => playAwardFanfareSound()).not.toThrow();
    });

    it('synthesizes tones via AudioContext when available', () => {
        const mockOscillator = {
            type: 'sine',
            frequency: { value: 0 },
            connect: vi.fn().mockReturnThis(),
            start: vi.fn(),
            stop: vi.fn(),
        };
        const mockGainNode = {
            gain: {
                setValueAtTime: vi.fn(),
                exponentialRampToValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn().mockReturnThis(),
        };
        const mockClose = vi.fn();
        function MockAudioContext() {
            return {
                currentTime: 10,
                destination: {},
                createOscillator: vi.fn(() => ({ ...mockOscillator })),
                createGain: vi.fn(() => ({ ...mockGainNode })),
                close: mockClose,
            };
        }

        (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;

        playSound('finish');

        // Restore
        if (originalAudioContext) {
            window.AudioContext = originalAudioContext;
        }
        if (originalWebkit) {
            (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = originalWebkit;
        }
    });

    it('safely catches when AudioContext constructor throws (e.g. autoplay block or permission denial)', () => {
        function ThrowingAudioContext() {
            throw new Error('Autoplay prevented');
        }
        (window as unknown as { AudioContext: unknown }).AudioContext = ThrowingAudioContext;

        expect(() => playSound('finish')).not.toThrow();
        expect(() => playAwardFanfareSound()).not.toThrow();

        // Restore
        if (originalAudioContext) {
            window.AudioContext = originalAudioContext;
        }
        if (originalWebkit) {
            (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = originalWebkit;
        }
    });
});
