// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BackLink from './BackLink';
import { writeLastRace } from '../lastRace';

const SETTINGS_DESTINATION = { to: '/system-settings', label: 'Back to settings' };

describe('BackLink', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('names the remembered race, and links to it, when the caller gives no destination', () => {
        // Settings' own case (#1077): it passes no `destination`, so a
        // remembered race is the only thing that can show here.
        writeLastRace({ id: 42, name: 'Practice Race' });

        render(
            <MemoryRouter>
                <BackLink />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to Practice Race');
        expect(link).toHaveAttribute('href', '/race/42');
    });

    it('uses the caller-supplied destination when no race is remembered', () => {
        render(
            <MemoryRouter>
                <BackLink destination={SETTINGS_DESTINATION} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to settings');
        expect(link).toHaveAttribute('href', '/system-settings');
    });

    it('renders nothing when no race is remembered and no destination was given', () => {
        render(
            <MemoryRouter>
                <BackLink />
            </MemoryRouter>,
        );

        expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
    });

    it('uses the caller-supplied destination even when a race is remembered (#1077)', () => {
        // This is the bug: Timer check and Activity are reachable only from
        // Settings, so a race remembered from an earlier tab or session must
        // not hijack their back link into returning to that race instead.
        writeLastRace({ id: 3, name: '2026 Pinewood Derby' });

        render(
            <MemoryRouter>
                <BackLink destination={SETTINGS_DESTINATION} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to settings');
        expect(link).toHaveAttribute('href', '/system-settings');
    });

    it('prefers an explicit location.state.from over the destination and the remembered race', () => {
        // Set by `ReadinessStrip`'s "Check it" link, the one route into a
        // sub-page that starts inside a race — it names the exact page the
        // operator left, which outranks even a remembered race pointing
        // somewhere else.
        writeLastRace({ id: 3, name: '2026 Pinewood Derby' });

        render(
            <MemoryRouter initialEntries={[{ pathname: '/timer-check', state: { from: '/race/3/control' } }]}>
                <BackLink destination={SETTINGS_DESTINATION} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to 2026 Pinewood Derby');
        expect(link).toHaveAttribute('href', '/race/3/control');
    });
});
