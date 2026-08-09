import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
});
