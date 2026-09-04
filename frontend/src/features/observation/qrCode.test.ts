import { describe, expect, it } from 'vitest';
import { defaultQrHeadline, qrTargetPath, resolveQrHeadline } from './qrCode';

describe('qrTargetPath', () => {
    it('points a standings target at this races own audience display', () => {
        expect(qrTargetPath('STANDINGS', 7)).toBe('/race/7/observation');
    });

    it('points a vote target at the ballot', () => {
        expect(qrTargetPath('VOTE', 7)).toBe('/race/7/vote');
    });
});

describe('defaultQrHeadline', () => {
    it('differs by target', () => {
        expect(defaultQrHeadline('STANDINGS')).not.toBe(defaultQrHeadline('VOTE'));
    });

    it('names live results for the standings target', () => {
        expect(defaultQrHeadline('STANDINGS').toLowerCase()).toContain('results');
    });

    it('names voting for the vote target', () => {
        expect(defaultQrHeadline('VOTE').toLowerCase()).toContain('vote');
    });
});

describe('resolveQrHeadline', () => {
    it('uses the derived default when the race has not set one', () => {
        expect(resolveQrHeadline(null, 'STANDINGS')).toBe(defaultQrHeadline('STANDINGS'));
        expect(resolveQrHeadline(undefined, 'VOTE')).toBe(defaultQrHeadline('VOTE'));
    });

    it('uses the derived default when the race cleared its headline back to empty', () => {
        // Backend convention: an empty string is how `qr_headline` is
        // cleared, since neither field has a legitimate empty value of its
        // own and there is no separate clear flag.
        expect(resolveQrHeadline('', 'STANDINGS')).toBe(defaultQrHeadline('STANDINGS'));
        expect(resolveQrHeadline('   ', 'VOTE')).toBe(defaultQrHeadline('VOTE'));
    });

    it('uses the races own headline when it set one', () => {
        expect(resolveQrHeadline('Scan to Vote for Best in Show!', 'VOTE')).toBe(
            'Scan to Vote for Best in Show!',
        );
    });

    it('trims surrounding space off a custom headline', () => {
        expect(resolveQrHeadline('  Come find your car!  ', 'STANDINGS')).toBe(
            'Come find your car!',
        );
    });
});
