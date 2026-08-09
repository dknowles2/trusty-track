import { describe, expect, it } from 'vitest';
import { blankPin, canRemove, pinHelp, pinInput, pinToSend } from './pinFields';

describe('what gets sent for a PIN', () => {
    it('omits a blank field, so saving the page keeps the current PIN', () => {
        // The whole reason absent and empty differ: this page re-submits the
        // whole config on every save and never receives the PIN back.
        expect(pinToSend(blankPin)).toBeUndefined();
    });

    it('sends what was typed', () => {
        expect(pinToSend({ value: '1234', remove: false })).toBe('1234');
    });

    it('sends an empty string when removal was asked for', () => {
        // The case the UI previously could not express at all, which is why a
        // forgotten operator PIN could not be cleared from the app (#192).
        expect(pinToSend({ value: '', remove: true })).toBe('');
    });

    it('prefers removal over a value left in the box', () => {
        // The field is disabled once removal is staged, so a value still in it
        // is what they typed before changing their mind. Sending it would
        // re-set the PIN they just asked to remove.
        expect(pinToSend({ value: '9999', remove: true })).toBe('');
    });
});

describe('the mutation input', () => {
    it('omits both when neither was touched', () => {
        expect(pinInput(blankPin, blankPin)).toEqual({});
    });

    it('carries only the field that changed', () => {
        expect(pinInput({ value: '1234', remove: false }, blankPin)).toEqual({
            operatorPin: '1234',
        });
    });

    it('can remove one while leaving the other alone', () => {
        expect(pinInput(blankPin, { value: '', remove: true })).toEqual({
            checkinPin: '',
        });
    });

    it('can remove both at once', () => {
        expect(
            pinInput({ value: '', remove: true }, { value: '', remove: true }),
        ).toEqual({ operatorPin: '', checkinPin: '' });
    });
});

describe('what the operator is told', () => {
    it('says a blank field keeps the PIN, when there is one to keep', () => {
        expect(pinHelp(blankPin, true, 'Runs the race.')).toContain('keep the current PIN');
    });

    it('says nothing about keeping when no PIN is set', () => {
        expect(pinHelp(blankPin, false, 'Runs the race.')).not.toContain('keep');
    });

    it('says what will happen when removal is staged', () => {
        expect(pinHelp({ value: '', remove: true }, true, 'Runs the race.')).toContain(
            'removed when you save',
        );
    });

    it('distinguishes a change from a removal', () => {
        const help = pinHelp({ value: '1234', remove: false }, true, 'Runs the race.');
        expect(help).toContain('changed when you save');
        expect(help).not.toContain('removed');
    });
});

describe('offering removal', () => {
    it('only offers it for a PIN that exists', () => {
        expect(canRemove(true)).toBe(true);
        expect(canRemove(false)).toBe(false);
    });
});
