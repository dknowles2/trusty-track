import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useMutation: vi.fn(), useSubscription: vi.fn() };
});

import { useMutation, useSubscription } from 'urql';
import { RaceExecution, type Heat } from './RaceExecution';
import { AlertProvider } from '../../../context/AlertContext';
import { lane } from '../testFixtures';

/**
 * The keyboard shortcuts and the finish chime, as wired (#207, #208).
 *
 * The rules are unit-tested without a DOM. What is worth checking here is the
 * wiring: that a key reaches the same handler the button does, and that the
 * guards actually hold when a real event goes to a real window.
 */
describe('race day keys and sound', () => {
    const recorded: Heat = {
        id: 1,
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        roundName: 'Round 1',
        lanes: [
            lane({ lane: 1, racerId: 101, time: 3.5, place: 1 }),
            lane({ lane: 2, racerId: 102, time: 3.6, place: 2 }),
        ],
    };

    const nextHeat: Heat = {
        id: 2,
        roundNumber: 1,
        roundId: 1,
        heatNumber: 2,
        roundName: 'Round 1',
        lanes: [lane({ lane: 1, racerId: 101 }), lane({ lane: 2, racerId: 102 })],
    };

    const racers = {
        101: { id: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racerImageUrl: null, carImageUrl: null },
        102: { id: 102, firstName: 'Jane', lastName: 'Smith', carNumber: 2, racerImageUrl: null, carImageUrl: null },
    };

    const onNextHeat = vi.fn();

    const props = (over: Record<string, unknown> = {}) => ({
        activeExecutionHeat: recorded,
        nextExecutionHeat: nextHeat,
        upcomingHeats: [],
        activeHeatId: null,
        onRunHeat: vi.fn(),
        onNextHeat,
        getRacerName: (id: number) => `Racer ${id}`,
        onUpdateResult: vi.fn(),
        racers,
        roundSummary: null,
        trackId: 1,
        timerType: 'FAKE',
        autoAdvanceHeat: false,
        ...over,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        vi.mocked(useMutation).mockReturnValue([{}, vi.fn()] as never);
        vi.mocked(useSubscription).mockReturnValue([{ data: null }] as never);
    });

    it('advances on Space', () => {
        render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);

        fireEvent.keyDown(window, { key: ' ' });

        expect(onNextHeat).toHaveBeenCalled();
    });

    it('does not advance while somebody is typing', () => {
        // An operator correcting a car name would otherwise skip the heat.
        render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);
        const input = document.createElement('input');
        document.body.appendChild(input);

        fireEvent.keyDown(input, { key: ' ' });

        expect(onNextHeat).not.toHaveBeenCalled();
    });

    it('leaves Ctrl-Space to the browser', () => {
        render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);

        fireEvent.keyDown(window, { key: ' ', ctrlKey: true });

        expect(onNextHeat).not.toHaveBeenCalled();
    });

    it('opens the editor on E', () => {
        render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);

        fireEvent.keyDown(window, { key: 'e' });

        expect(screen.getByText(/Edit Results/)).toBeInTheDocument();
    });

    it('does nothing on E once the editor is already open', () => {
        // The key would otherwise reach the dialog it opened, and typing an
        // `e` into a car name would reopen it over itself.
        render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);
        fireEvent.keyDown(window, { key: 'e' });

        fireEvent.keyDown(window, { key: ' ' });

        expect(onNextHeat).not.toHaveBeenCalled();
    });

    it('shows the key on the button it mirrors', () => {
        // A screen used once a year cannot amortise a cheat sheet.
        render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);

        expect(screen.getByRole('button', { name: /Next Heat/ })).toHaveTextContent('Space');
        expect(screen.getByRole('button', { name: /Edit/ })).toHaveTextContent('E');
    });

    it('offers the finish sound, off by default', () => {
        // A laptop that starts beeping unbidden in front of sixty families is
        // a worse first impression than silence.
        render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);

        expect(screen.getByTestId('finish-chime-toggle')).not.toBeChecked();
    });

    it('remembers the finish sound on this device', () => {
        const { unmount } = render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);
        fireEvent.click(screen.getByTestId('finish-chime-toggle'));
        unmount();

        render(<AlertProvider><RaceExecution {...props()} /></AlertProvider>);

        expect(screen.getByTestId('finish-chime-toggle')).toBeChecked();
    });
});
