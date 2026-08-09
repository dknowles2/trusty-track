import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor, type ShortcutContext } from './shortcuts';

const context = (over: Partial<ShortcutContext> = {}): ShortcutContext => ({
    phase: 'RECORDED',
    hasNextHeat: true,
    countingDown: false,
    modalOpen: false,
    typing: false,
    ...over,
});

const press = (key: string, over: Partial<ShortcutContext> = {}) =>
    shortcutFor(key, {}, context(over));

describe('Space', () => {
    it('moves on from a recorded heat', () => {
        expect(press(' ')).toBe('ADVANCE');
    });

    it('does nothing when there is no heat to move to', () => {
        expect(press(' ', { hasNextHeat: false })).toBeNull();
    });

    it('does not start a heat', () => {
        // On a real timer the gate is released by hand, and on the fake one the
        // control is a debugging panel rather than part of the flow.
        expect(press(' ', { phase: 'WAITING' })).toBeNull();
    });

    it('does nothing mid-heat', () => {
        expect(press(' ', { phase: 'RUNNING' })).toBeNull();
    });

    it('answers to the old key name too', () => {
        // Some browsers still report "Spacebar" rather than " ".
        expect(press('Spacebar')).toBe('ADVANCE');
    });
});

describe('E', () => {
    it('opens the editor on a recorded heat', () => {
        expect(press('e')).toBe('EDIT');
    });

    it('opens it before a result exists, where the button says Override', () => {
        expect(press('e', { phase: 'WAITING' })).toBe('EDIT');
    });

    it('does nothing while a heat is running', () => {
        expect(press('e', { phase: 'RUNNING' })).toBeNull();
    });

    it('answers to a capital', () => {
        // Caps lock is on more often than anybody admits.
        expect(press('E')).toBe('EDIT');
    });
});

describe('Escape', () => {
    it('calls off a countdown', () => {
        expect(press('Escape', { countingDown: true })).toBe('CANCEL_COUNTDOWN');
    });

    it('is left to the browser when nothing is counting down', () => {
        expect(press('Escape')).toBeNull();
    });
});

describe('when a shortcut must not fire', () => {
    it('does nothing while somebody is typing', () => {
        // An operator correcting a time presses `e` as part of a name.
        expect(press('e', { typing: true })).toBeNull();
        expect(press(' ', { typing: true })).toBeNull();
    });

    it('does nothing with a dialog open', () => {
        expect(press('e', { modalOpen: true })).toBeNull();
        expect(press(' ', { modalOpen: true })).toBeNull();
        expect(press('Escape', { modalOpen: true, countingDown: true })).toBeNull();
    });

    it('leaves modified keys to the browser', () => {
        // Ctrl-E and Cmd-E belong to the browser; stealing them quietly is
        // worse than having no shortcut at all.
        expect(shortcutFor('e', { ctrl: true }, context())).toBeNull();
        expect(shortcutFor('e', { meta: true }, context())).toBeNull();
        expect(shortcutFor('e', { alt: true }, context())).toBeNull();
    });

    it('ignores a key that means nothing here', () => {
        expect(press('q')).toBeNull();
    });
});

describe('isTypingTarget', () => {
    it('recognises a text box', () => {
        expect(isTypingTarget(document.createElement('input'))).toBe(true);
        expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    });

    it('recognises a select, where Space opens the list', () => {
        expect(isTypingTarget(document.createElement('select'))).toBe(true);
    });

    it('recognises a rich-text area', () => {
        const div = document.createElement('div');
        div.contentEditable = 'true';
        // jsdom does not derive `isContentEditable` from the attribute.
        Object.defineProperty(div, 'isContentEditable', { value: true });

        expect(isTypingTarget(div)).toBe(true);
    });

    it('does not treat an ordinary element as a text field', () => {
        expect(isTypingTarget(document.createElement('div'))).toBe(false);
    });

    it('survives no target at all', () => {
        expect(isTypingTarget(null)).toBe(false);
    });
});
