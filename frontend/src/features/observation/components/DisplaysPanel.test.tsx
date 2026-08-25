// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DisplaysPanel from './DisplaysPanel';
import { useQuery, useMutation } from 'urql';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
        useMutation: vi.fn(),
    };
});

const assignDisplay = vi.fn().mockResolvedValue({ data: {} });

function renderPanel(view: string, cycleSeconds = 10) {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockReturnValue([
        {
            data: {
                displays: [
                    {
                        displayId: 'd-1',
                        name: 'Gym north',
                        view,
                        cycleSeconds,
                        description: 'Standings',
                        pacedByAPerson: false,
                        connected: true,
                    },
                ],
            },
            fetching: false,
            error: null,
        },
        vi.fn(),
    ]);
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockReturnValue([
        { fetching: false },
        assignDisplay,
    ]);
    render(<DisplaysPanel raceId={1} />);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('the seconds control on a display row', () => {
    it('is offered for the photo slideshow — the reported bug', () => {
        renderPanel('SLIDESHOW', 5);
        expect(screen.getByLabelText('Cycle interval for Gym north')).toBeTruthy();
    });

    it('keeps the row on its own view when the interval changes', () => {
        renderPanel('SLIDESHOW', 5);
        fireEvent.change(screen.getByLabelText('Cycle interval for Gym north'), {
            target: { value: '8' },
        });
        // The old handler hard-coded view: 'CYCLE', which would have
        // switched the screen off the slideshow to set its speed.
        expect(assignDisplay).toHaveBeenCalledWith({
            displayId: 'd-1',
            view: 'SLIDESHOW',
            cycleSeconds: 8,
        });
    });

    it('is still offered for the tab cycle', () => {
        renderPanel('CYCLE');
        expect(screen.getByLabelText('Cycle interval for Gym north')).toBeTruthy();
    });

    it('is absent for a view with no timer to set', () => {
        renderPanel('STANDINGS');
        expect(screen.queryByLabelText('Cycle interval for Gym north')).toBeNull();
    });
});
