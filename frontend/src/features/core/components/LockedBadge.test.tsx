// @vitest-environment jsdom
import '../../../setupTests';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LockedBadge from './LockedBadge';

describe('LockedBadge', () => {
    it('says Locked', () => {
        render(<LockedBadge />);
        expect(screen.getByText('Locked')).toBeInTheDocument();
    });

    it('names what it means, for anyone hovering it', () => {
        render(<LockedBadge />);
        expect(screen.getByTitle('This race is locked against further edits')).toBeInTheDocument();
    });
});
