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

function renderPanel(view: string, cycleSeconds = 10, connected = true) {
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
                        pacedByAPerson: view === 'AWARDS',
                        connected,
                    },
                ],
            },
            fetching: false,
            error: null,
        },
        vi.fn(),
    ]);
    // Every useMutation in the component gets the same spy; the assertions
    // below read the variables, which name the mutation unambiguously.
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

describe('driving a ceremony from the operator’s list', () => {
    it('offers Next and Previous for a screen showing the ceremony', () => {
        renderPanel('AWARDS');
        expect(screen.getByLabelText('Next award on Gym north')).toBeTruthy();
        expect(screen.getByLabelText('Previous award on Gym north')).toBeTruthy();
    });

    it('sends a step, never a slide number — only the screen knows that', () => {
        renderPanel('AWARDS');
        fireEvent.click(screen.getByLabelText('Next award on Gym north'));
        expect(assignDisplay).toHaveBeenCalledWith({ displayId: 'd-1', delta: 1 });

        fireEvent.click(screen.getByLabelText('Previous award on Gym north'));
        expect(assignDisplay).toHaveBeenCalledWith({ displayId: 'd-1', delta: -1 });
    });

    it('is dead for a screen that is not there', () => {
        // A command published to a screen holding no subscription reaches
        // nobody, and its next opening payload is a reconnection rather than
        // an instruction — so the click would silently do nothing.
        renderPanel('AWARDS', 10, false);
        expect(screen.getByLabelText('Next award on Gym north')).toHaveProperty(
            'disabled',
            true,
        );
    });

    it('is absent for a view that drives itself', () => {
        renderPanel('STANDINGS');
        expect(screen.queryByLabelText('Next award on Gym north')).toBeNull();
    });
});
