// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BackLink from './BackLink';
import { writeLastRace } from '../lastRace';

describe('BackLink', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('names the remembered race, and links to it', () => {
        writeLastRace({ id: 42, name: 'Practice Race' });

        render(
            <MemoryRouter>
                <BackLink fallback={{ to: '/system-settings', label: 'Back to settings' }} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to Practice Race');
        expect(link).toHaveAttribute('href', '/race/42');
    });

    it('falls back to the caller-supplied link when no race is remembered', () => {
        render(
            <MemoryRouter>
                <BackLink fallback={{ to: '/system-settings', label: 'Back to settings' }} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to settings');
        expect(link).toHaveAttribute('href', '/system-settings');
    });

    it('renders nothing when no race is remembered and no fallback was given', () => {
        render(
            <MemoryRouter>
                <BackLink />
            </MemoryRouter>,
        );

        expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
    });

    it('prefers the remembered race over a fallback when both are available', () => {
        writeLastRace({ id: 3, name: '2026 Pinewood Derby' });

        render(
            <MemoryRouter>
                <BackLink fallback={{ to: '/system-settings', label: 'Back to settings' }} />
            </MemoryRouter>,
        );

        expect(screen.getByTestId('back-link')).toHaveTextContent('Back to 2026 Pinewood Derby');
    });
});
