/**
 * Synthesized sound effects for race events (#554).
 *
 * Provides event-triggered sound effects:
 * - Staging / ready: double pip when a heat is armed at the gate
 * - Gate release / race start: race start horn when the timer starts running
 * - Finish: finish chime when results are recorded (legacy #208)
 * - Track record broken: celebratory ascending fanfare when a track record falls
 * - Award fanfare: triumphant fanfare when stepping through award slides
 *
 * WebAudio synthesized offline without external audio files, completely
 * license-free, off by default, remembered per device.
 * Wrapped in try/catch and capability checks so lack of AudioContext or blocked
 * autoplay never affects UI execution.
 */

import type { HeatPhase } from '../../gql/operations';

export type SoundEffect =
    | 'stagingReady'
    | 'gateRelease'
    | 'finish'
    | 'recordBreak'
    | 'awardFanfare';

export interface SoundEffectsSettings {
    master: boolean;
    stagingReady: boolean;
    gateRelease: boolean;
    finish: boolean;
    recordBreak: boolean;
    awardFanfare: boolean;
}

export const SOUND_STORAGE_KEY = 'trustytrack.soundEffects';
export const FINISH_CHIME_STORAGE_KEY = 'trustytrack.finishChime';

export const DEFAULT_SOUND_SETTINGS: SoundEffectsSettings = {
    master: false,
    stagingReady: true,
    gateRelease: true,
    finish: true,
    recordBreak: true,
    awardFanfare: true,
};

export interface ToneNote {
    frequency: number;
    startsAt: number;
    lasts: number;
    type?: OscillatorType;
    gain?: number;
}

export const SOUND_PATTERNS: Record<SoundEffect, readonly ToneNote[]> = {
    stagingReady: [
        { frequency: 523.25, startsAt: 0, lasts: 0.07, type: 'sine', gain: 0.18 },
        { frequency: 783.99, startsAt: 0.1, lasts: 0.1, type: 'sine', gain: 0.18 },
    ],
    gateRelease: [
        { frequency: 880, startsAt: 0, lasts: 0.25, type: 'triangle', gain: 0.3 },
        { frequency: 440, startsAt: 0, lasts: 0.25, type: 'sine', gain: 0.2 },
    ],
    finish: [
        { frequency: 880, startsAt: 0, lasts: 0.12, type: 'sine', gain: 0.25 },
        { frequency: 1318.5, startsAt: 0.1, lasts: 0.2, type: 'sine', gain: 0.25 },
    ],
    recordBreak: [
        { frequency: 523.25, startsAt: 0, lasts: 0.12, type: 'triangle', gain: 0.22 },
        { frequency: 659.25, startsAt: 0.12, lasts: 0.12, type: 'triangle', gain: 0.22 },
        { frequency: 783.99, startsAt: 0.24, lasts: 0.12, type: 'triangle', gain: 0.22 },
        { frequency: 1046.5, startsAt: 0.36, lasts: 0.35, type: 'triangle', gain: 0.28 },
        { frequency: 523.25, startsAt: 0.36, lasts: 0.35, type: 'sine', gain: 0.2 },
    ],
    awardFanfare: [
        { frequency: 523.25, startsAt: 0, lasts: 0.12, type: 'triangle', gain: 0.22 },
        { frequency: 523.25, startsAt: 0.14, lasts: 0.12, type: 'triangle', gain: 0.22 },
        { frequency: 523.25, startsAt: 0.28, lasts: 0.12, type: 'triangle', gain: 0.22 },
        { frequency: 659.25, startsAt: 0.42, lasts: 0.22, type: 'triangle', gain: 0.24 },
        { frequency: 783.99, startsAt: 0.66, lasts: 0.45, type: 'triangle', gain: 0.28 },
        { frequency: 523.25, startsAt: 0.66, lasts: 0.45, type: 'sine', gain: 0.2 },
    ],
};

/**
 * Read sound settings from device storage, falling back to defaults if absent
 * or migrating the legacy finishChime setting.
 */
export function readSoundSettings(storage: Pick<Storage, 'getItem'> = window.localStorage): SoundEffectsSettings {
    try {
        const raw = storage.getItem(SOUND_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                master: Boolean(parsed.master),
                stagingReady: parsed.stagingReady !== false,
                gateRelease: parsed.gateRelease !== false,
                finish: parsed.finish !== false,
                recordBreak: parsed.recordBreak !== false,
                awardFanfare: parsed.awardFanfare !== false,
            };
        }

        // Migrate or honor legacy finish chime preference
        const legacy = storage.getItem(FINISH_CHIME_STORAGE_KEY);
        if (legacy === 'on') {
            return {
                ...DEFAULT_SOUND_SETTINGS,
                master: true,
                finish: true,
            };
        }
    } catch {
        // Fall back to default
    }
    return { ...DEFAULT_SOUND_SETTINGS };
}

/**
 * Write sound settings to device storage, also keeping the legacy finishChime key
 * in sync so existing toggles or screens continue to function seamlessly.
 */
export function writeSoundSettings(
    storage: Pick<Storage, 'setItem'> = window.localStorage,
    settings: SoundEffectsSettings,
): void {
    try {
        storage.setItem(SOUND_STORAGE_KEY, JSON.stringify(settings));
        storage.setItem(FINISH_CHIME_STORAGE_KEY, settings.finish ? 'on' : 'off');
    } catch {
        // Ignore storage write failures
    }
}

/**
 * Check if a specific sound effect is currently enabled on this device.
 */
export function isSoundEffectEnabled(
    effect: SoundEffect,
    storage: Pick<Storage, 'getItem'> = window.localStorage,
): boolean {
    const settings = readSoundSettings(storage);
    return settings.master && Boolean(settings[effect]);
}

/**
 * Whether a heat finishing transition occurred.
 */
export function shouldFinishSound(previous: HeatPhase | null, next: HeatPhase): boolean {
    return previous !== null && previous !== 'RECORDED' && next === 'RECORDED';
}

/**
 * Backwards compatibility alias for shouldFinishSound.
 */
export const shouldChime = shouldFinishSound;

/**
 * Whether a race start / gate release transition occurred.
 */
export function shouldGateReleaseSound(previous: HeatPhase | null, next: HeatPhase): boolean {
    return previous !== null && previous !== 'RUNNING' && next === 'RUNNING';
}

/**
 * Whether a heat staging / ready transition occurred.
 *
 * Stated as an edge into WAITING — any non-null previous phase that was not
 * already WAITING — the same shape `shouldFinishSound` and
 * `shouldGateReleaseSound` above already use, rather than a list of accepted
 * previous phases. An earlier version only named NOT_READY -> WAITING and
 * NO_HEAT -> WAITING, which excluded RECORDED -> WAITING (#872) — the
 * transition that actually happens when a heat is staged on race day:
 * advancing to the next heat by button, Space, or auto-advance. Enumerating
 * the accepted transitions is how that bug happened, so the fix generalizes
 * the rule rather than adding one more name to the list. An abort
 * (RUNNING -> WAITING) now sounds too: the gate really is re-armed and
 * waiting again, which is exactly what this sound announces, and there is
 * nothing left in this phase machine that arrives at WAITING without the
 * gate actually being staged.
 */
export function shouldStagingReadySound(previous: HeatPhase | null, next: HeatPhase): boolean {
    return previous !== null && previous !== 'WAITING' && next === 'WAITING';
}

/**
 * Whether a new heat result broke the track record.
 */
export function shouldRecordBreakSound(isNewResult: boolean, recordBreak: unknown): boolean {
    return isNewResult && Boolean(recordBreak);
}

/**
 * Whether an award ceremony slide advanced to a valid award.
 */
export function shouldAwardFanfareSound(
    previousIndex: number | null,
    nextIndex: number,
    totalAwards: number,
): boolean {
    return previousIndex !== null && nextIndex > previousIndex && nextIndex < totalAwards;
}

/**
 * Synthesize and play a sound effect using WebAudio.
 * Wrapped in try/catch and capability checks to never throw or break UI.
 */
export function playSound(effect: SoundEffect): void {
    try {
        const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext;
        if (!Ctor) return;

        const notes = SOUND_PATTERNS[effect];
        if (!notes || notes.length === 0) return;

        const audio = new Ctor();
        const now = audio.currentTime;
        for (const note of notes) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.type = note.type ?? 'sine';
            oscillator.frequency.value = note.frequency;

            const targetGain = note.gain ?? 0.25;
            gain.gain.setValueAtTime(0.0001, now + note.startsAt);
            gain.gain.exponentialRampToValueAtTime(targetGain, now + note.startsAt + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + note.startsAt + note.lasts);

            oscillator.connect(gain).connect(audio.destination);
            oscillator.start(now + note.startsAt);
            oscillator.stop(now + note.startsAt + note.lasts);
        }
        const total = Math.max(...notes.map((n) => n.startsAt + n.lasts));
        window.setTimeout(() => {
            try {
                void audio.close();
            } catch {
                // Ignore audio close failures
            }
        }, (total + 0.1) * 1000);
    } catch {
        // Deliberately silent to prevent audio errors from failing caller
    }
}

export function playFinishSound(): void {
    playSound('finish');
}

export function playGateReleaseSound(): void {
    playSound('gateRelease');
}

export function playStagingReadySound(): void {
    playSound('stagingReady');
}

export function playRecordBreakSound(): void {
    playSound('recordBreak');
}

export function playAwardFanfareSound(): void {
    playSound('awardFanfare');
}
