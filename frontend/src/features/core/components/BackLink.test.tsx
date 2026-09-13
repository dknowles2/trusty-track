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

    it('never borrows a different race\'s name for the state.from label (review finding on #1107)', () => {
        // `from` names race 7 (this tab's own history), but the device
        // remembers race 12 (left over from a different tab, or an earlier
        // visit) — the label must not claim this is race 12's back link.
        writeLastRace({ id: 12, name: 'Someone Else\'s Race' });

        render(
            <MemoryRouter initialEntries={[{ pathname: '/timer-check', state: { from: '/race/7/control' } }]}>
                <BackLink destination={SETTINGS_DESTINATION} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).not.toHaveTextContent("Someone Else's Race");
        expect(link).toHaveAttribute('href', '/race/7/control');
    });

    it('ignores a state.from that is not a same-app path (review finding on #1107)', () => {
        // `location.state` is whatever the history entry happens to carry,
        // not something this component controls — a non-string or an
        // off-app value must fall through to the destination rather than
        // being handed to `<Link to>` as-is.
        render(
            <MemoryRouter initialEntries={[{ pathname: '/timer-check', state: { from: 'https://evil.example.com' } }]}>
                <BackLink destination={SETTINGS_DESTINATION} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to settings');
        expect(link).toHaveAttribute('href', '/system-settings');
    });

    it('ignores a protocol-relative state.from (second review finding on #1107)', () => {
        // `"//evil.example.com".startsWith('/')` is true — it is
        // protocol-relative, not path-relative — and `<Link to="//...">`
        // renders an `href` a browser reads as cross-origin. This must fall
        // through to the destination exactly like an `https://` URL does.
        render(
            <MemoryRouter initialEntries={[{ pathname: '/timer-check', state: { from: '//evil.example.com' } }]}>
                <BackLink destination={SETTINGS_DESTINATION} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to settings');
        expect(link).toHaveAttribute('href', '/system-settings');
    });

    it('matches the remembered race through a query string in state.from', () => {
        // `raceIdFromPath` has to stop at `/`, `?` or `#`, not just `/` — a
        // path like an edit-race deep link (`/race/12?edit=true`) still
        // names race 12. `from` is always `location.pathname` today (no
        // query string reaches it), but the parser should not depend on
        // that happening to be true.
        writeLastRace({ id: 12, name: 'Pack 12 Derby' });

        render(
            <MemoryRouter initialEntries={[{ pathname: '/timer-check', state: { from: '/race/12?edit=true' } }]}>
                <BackLink destination={SETTINGS_DESTINATION} />
            </MemoryRouter>,
        );

        const link = screen.getByTestId('back-link');
        expect(link).toHaveTextContent('Back to Pack 12 Derby');
    });
});
