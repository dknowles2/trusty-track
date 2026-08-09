/**
 * Keys the race control operator can reach without the mouse (#207).
 *
 * They are holding a microphone, watching a line of eight-year-olds, and
 * clicking a button forty times an afternoon. Deliberately a very short list:
 * a screen somebody uses once a year cannot amortise a cheat sheet, so each
 * key has to be guessable and each is shown on the button it mirrors.
 *
 * Pure. Which key does what, and when it does nothing, is a rule worth pinning
 * without a DOM — the *doing* is in the component.
 */

import type { HeatPhase } from '../../gql/operations';

export type ShortcutAction = 'ADVANCE' | 'EDIT' | 'CANCEL_COUNTDOWN';

export interface ShortcutContext {
    phase: HeatPhase;
    /** Whether there is a heat after this one to move to. */
    hasNextHeat: boolean;
    /** Whether an auto-advance countdown is running. */
    countingDown: boolean;
    /** Whether a dialog is up — the edit modal, or the round summary. */
    modalOpen: boolean;
    /** Whether the keystroke landed in a text field, a select, or similar. */
    typing: boolean;
}

/**
 * What a keystroke should do, or nothing.
 *
 * **Nothing at all while typing or with a dialog open.** An operator halfway
 * through correcting a time in the edit modal presses `e` as part of a name,
 * and Space is how every browser scrolls a page; a shortcut that fires there
 * would be indistinguishable from the app misbehaving.
 *
 * **Nothing with a modifier held.** Ctrl-E and Cmd-E belong to the browser,
 * and quietly stealing them is worse than having no shortcut.
 */
export function shortcutFor(
    key: string,
    modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean },
    context: ShortcutContext,
): ShortcutAction | null {
    if (context.typing || context.modalOpen) return null;
    if (modifiers.ctrl || modifiers.meta || modifiers.alt) return null;

    switch (key) {
        case ' ':
        case 'Spacebar':
            // Only ever "move on", which is the one action of race day that is
            // both repetitive and safe. It deliberately does not start a heat:
            // on a real timer the gate is released by hand, and on the fake one
            // the control is a debugging panel rather than part of the flow.
            return context.phase === 'RECORDED' && context.hasNextHeat ? 'ADVANCE' : null;

        case 'e':
        case 'E':
            // The same editor under both its names — "Edit" once a result is
            // stored, "Override" before one is. A heat that is running has
            // nothing to correct yet.
            return context.phase === 'RECORDED' || context.phase === 'WAITING' ? 'EDIT' : null;

        case 'Escape':
            // Only when there is a countdown to call off. Escape with nothing
            // running should stay the browser's, not silently swallowed.
            return context.countingDown ? 'CANCEL_COUNTDOWN' : null;

        default:
            return null;
    }
}

/** Whether the element a keystroke landed in is one somebody is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** The hint shown on the button a key mirrors. */
export const SHORTCUT_HINTS: Record<ShortcutAction, string> = {
    ADVANCE: 'Space',
    EDIT: 'E',
    CANCEL_COUNTDOWN: 'Esc',
};
