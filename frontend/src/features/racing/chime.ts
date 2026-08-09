/**
 * A sound when a heat's results land (#208).
 *
 * Forty feet from the screen, nobody in the room knows the result is in until
 * the announcer says so. A short chime tells them without anybody looking at a
 * monitor.
 *
 * **Off by default.** A gym with a PA system may well not want the app making
 * noise, and a laptop that starts beeping unbidden in front of sixty families
 * is a worse first impression than silence.
 *
 * Generated rather than played from a file: two sine tones through WebAudio is
 * a few lines and no asset to ship, cache or fail to load — and the audience
 * displays are on a machine with no internet.
 */

import type { HeatPhase } from '../../gql/operations';

const STORAGE_KEY = 'trustytrack.finishChime';

/**
 * Whether this transition is a heat finishing.
 *
 * The edge, not the state: `RECORDED` persists for as long as the operator
 * leaves that heat on screen, so chiming on the state would sound again on
 * every subscription payload — and there is one of those per lane time, per
 * check-in, and per anything else that touches the race.
 *
 * A `null` previous phase is the first payload after a page load, which is not
 * a heat finishing: reloading the operator's laptop between heats would
 * otherwise announce a result nobody had just produced.
 */
export function shouldChime(previous: HeatPhase | null, next: HeatPhase): boolean {
    return previous !== null && previous !== 'RECORDED' && next === 'RECORDED';
}

/** Whether this device wants the sound. Per device, like the PIN. */
export function chimeEnabled(storage: Pick<Storage, 'getItem'>): boolean {
    return storage.getItem(STORAGE_KEY) === 'on';
}

export function setChimeEnabled(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
    storage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
}

/** The two notes, in hertz, and how long each lasts. */
export const CHIME_NOTES: readonly { frequency: number; startsAt: number; lasts: number }[] = [
    { frequency: 880, startsAt: 0, lasts: 0.12 },
    { frequency: 1318.5, startsAt: 0.1, lasts: 0.2 },
];

/**
 * Play it, if the browser will let us.
 *
 * Wrapped in a try/catch and a capability check because audio is the one thing
 * on this screen that must never take the race down: a browser that blocks
 * autoplay until a gesture, or has no `AudioContext` at all, should cost the
 * operator a sound rather than a working page.
 */
export function playChime(): void {
    try {
        const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext;
        if (!Ctor) return;

        const audio = new Ctor();
        const now = audio.currentTime;
        for (const note of CHIME_NOTES) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = note.frequency;
            // Ramped rather than switched: a square-edged gain change is heard
            // as a click on top of the note.
            gain.gain.setValueAtTime(0.0001, now + note.startsAt);
            gain.gain.exponentialRampToValueAtTime(0.25, now + note.startsAt + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + note.startsAt + note.lasts);
            oscillator.connect(gain).connect(audio.destination);
            oscillator.start(now + note.startsAt);
            oscillator.stop(now + note.startsAt + note.lasts);
        }
        // Freed once the last note has finished; an AudioContext per heat
        // otherwise accumulates over an afternoon and browsers cap them.
        const total = Math.max(...CHIME_NOTES.map((n) => n.startsAt + n.lasts));
        window.setTimeout(() => void audio.close(), (total + 0.1) * 1000);
    } catch {
        // Deliberately silent. See the note above.
    }
}
