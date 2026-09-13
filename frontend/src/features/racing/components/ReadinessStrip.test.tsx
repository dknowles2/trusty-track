import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn(), useSubscription: vi.fn() };
});

import { useQuery, useSubscription } from 'urql';
import ReadinessStrip from './ReadinessStrip';

const mockQuery = vi.mocked(useQuery);
const mockSubscription = vi.mocked(useSubscription);

/** What the timer subscription is currently saying, and who is watching. */
function backend(
    timer: { state?: string; deviceName?: string | null; deviceProvenance?: string | null } | null,
    displays: { connected: boolean }[] = [],
) {
    mockSubscription.mockReturnValue([
        { data: timer ? { timerStatus: { status: timer } } : undefined, fetching: false, stale: false },
        vi.fn(),
    ] as never);
    mockQuery.mockReturnValue([
        { data: { displays }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
}

const strip = (over: Partial<React.ComponentProps<typeof ReadinessStrip>> = {}) =>
    render(
        <MemoryRouter>
            <ReadinessStrip
                raceId={1}
                trackId={1}
                timerType="AUTO_DETECT_BACKEND"
                registeredCount={20}
                checkedInCount={20}
                heatCount={20}
                {...over}
            />
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ReadinessStrip', () => {
    it('collapses to one line when everything is fine', () => {
        backend({ state: 'IDLE', deviceName: 'MicroWizard' });

        strip();

        expect(screen.getByTestId('readiness-strip')).toHaveAttribute('data-level', 'OK');
        expect(screen.getByText('Ready to race')).toBeInTheDocument();
        // Collapsed means the per-item rows are not rendered at all.
        expect(screen.queryByTestId('readiness-timer')).not.toBeInTheDocument();
    });

    it('still names the timer and the counts when collapsed', () => {
        // "Ready" on its own is a claim the operator cannot check.
        backend({ state: 'IDLE', deviceName: 'MicroWizard' });

        strip({ heatCount: 15 });

        expect(screen.getByText(/MicroWizard/)).toBeInTheDocument();
        expect(screen.getByText(/All 20 checked in/)).toBeInTheDocument();
        expect(screen.getByText(/15 heats/)).toBeInTheDocument();
    });

    it('expands and says what is wrong when the timer is not connected', () => {
        backend({ state: 'DISCONNECTED', deviceName: null });

        strip();

        expect(screen.getByTestId('readiness-strip')).toHaveAttribute('data-level', 'BLOCKED');
        expect(screen.getByText('Not ready to race yet')).toBeInTheDocument();
        expect(screen.getByTestId('readiness-timer')).toHaveAttribute('data-level', 'BLOCKED');
    });

    it('is fine, not blocked, on a track with no timer at all (#490)', () => {
        // A no-timer track's manager sits IDLE forever — the state a real,
        // ready-to-arm timer also reports — so the strip has to be told the
        // track was deliberately configured this way rather than inferring
        // it from a state that means something else for every other track.
        // OK collapses the strip to one line, same as any other all-clear.
        backend({ state: 'IDLE', deviceName: 'No Timer' });

        strip({ timerType: 'NONE' });

        expect(screen.getByTestId('readiness-strip')).toHaveAttribute('data-level', 'OK');
        expect(screen.getByText(/No timer — results are entered by hand\./)).toBeInTheDocument();
    });

    it('reads a race with no track as unanswered rather than as a fault', () => {
        // A stale payload is deliberately supplied here: without the trackId
        // guard the strip would read it and report a race that has no track at
        // all as having a broken timer.
        backend({ state: 'DISCONNECTED', deviceName: null });

        strip({ trackId: null, checkedInCount: 4 });

        expect(screen.getByTestId('readiness-timer')).toHaveAttribute('data-level', 'INFO');
    });

    it('counts only the displays that are actually connected', () => {
        backend({ state: 'IDLE', deviceName: 'MicroWizard' }, [
            { connected: true },
            { connected: false },
            { connected: true },
        ]);

        strip({ checkedInCount: 4 });

        expect(screen.getByText(/2 screens connected/)).toBeInTheDocument();
    });

    it('links the timer row to the diagnostics page', () => {
        backend({ state: 'DISCONNECTED' });

        strip();

        expect(screen.getByTestId('readiness-timer').querySelector('a')).toHaveAttribute(
            'href',
            '/timer-check',
        );
    });

    it('shows the profile provenance as a note without colouring it', () => {
        backend({
            state: 'IDLE',
            deviceName: 'NewBold DT',
            deviceProvenance: 'Never run against this hardware by Trusty Track.',
        });

        strip({ checkedInCount: 4 });

        expect(screen.getByTestId('readiness-timer')).toHaveAttribute('data-level', 'OK');
        expect(screen.getByText(/Never run against this hardware/)).toBeInTheDocument();
    });

    it('carries the current race page as router state on the "Check it" link (#1077)', async () => {
        // `BackLink` on Timer check honours `location.state.from` ahead of a
        // remembered race, so this is what lets "Check it" from inside a race
        // come back to *this* race rather than to Settings.
        backend({ state: 'DISCONNECTED' });

        function LocationProbe() {
            const location = useLocation();
            return <div data-testid="landed-with-state">{JSON.stringify(location.state)}</div>;
        }

        render(
            <MemoryRouter initialEntries={['/race/9/control']}>
                <Routes>
                    <Route
                        path="/race/:raceId/control"
                        element={
                            <ReadinessStrip
                                raceId={9}
                                trackId={1}
                                timerType="AUTO_DETECT_BACKEND"
                                registeredCount={20}
                                checkedInCount={20}
                                heatCount={20}
                            />
                        }
                    />
                    <Route path="/timer-check" element={<LocationProbe />} />
                </Routes>
            </MemoryRouter>,
        );

        await userEvent.click(screen.getByRole('link', { name: 'Check it' }));

        expect(screen.getByTestId('landed-with-state')).toHaveTextContent(
            JSON.stringify({ from: '/race/9/control' }),
        );
    });
});
