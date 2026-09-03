// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useQuery } from 'urql';
import Printables from './Printables';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const RACE = {
    id: 1,
    name: 'Pack 42 Derby',
    dateTime: '2026-03-14T09:30:00',
    location: 'St Anne’s Hall',
    racingGroups: [{ id: 5, name: 'Wolves', color: '#8b4513' }],
    racers: [
        {
            id: 11,
            firstName: 'Alex',
            lastName: 'Rivera',
            carNumber: 7,
            carName: 'Blue Streak',
            racingGroupId: 5,
            racerImageUrl: '/static/alex.png',
        },
        {
            id: 12,
            firstName: 'Sam',
            lastName: 'Okafor',
            carNumber: 3,
            carName: null,
            racingGroupId: null,
            racerImageUrl: null,
        },
    ],
};

function mockRace(race: unknown = RACE) {
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
        { data: race === null ? { race: null } : { race }, fetching: false, error: undefined },
        vi.fn(),
    ]);
}

function open(search = '') {
    return render(
        <MemoryRouter initialEntries={[`/race/1/print${search}`]}>
            <Routes>
                <Route path="/race/:raceId/print" element={<Printables />} />
            </Routes>
        </MemoryRouter>,
    );
}

/** The cards on the sheet, in the order they will come off the printer. */
function cardNames() {
    return Array.from(document.querySelectorAll('.print-card-name')).map(
        (node) => node.textContent?.trim(),
    );
}

describe('Printables', () => {
    it('opens on pit passes with the whole roster', () => {
        mockRace();
        open();

        expect(document.querySelectorAll('.pit-pass')).toHaveLength(2);
        expect(screen.getByRole('button', { name: /Pit passes/ })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('stacks the cards in car-number order', () => {
        // Car 3 before car 7, whatever order the roster came back in.
        mockRace();
        open();

        expect(cardNames()).toEqual(['Sam Okafor', 'Alex Rivera']);
    });

    it('prints only the racers the roster had selected', () => {
        mockRace();
        open('?racers=11');

        expect(cardNames()).toEqual(['Alex Rivera']);
    });

    it('switches document without losing the selection', async () => {
        mockRace();
        open('?racers=11');

        await userEvent.click(screen.getByRole('button', { name: /Driver's licences/ }));

        expect(document.querySelectorAll('.drivers-license')).toHaveLength(1);
        expect(cardNames()).toEqual(['Alex Rivera']);
    });

    it('honours the document named in the URL', () => {
        // So a reload, or a bookmarked sheet, comes back to the same paper.
        mockRace();
        open('?kind=check-in-code');

        expect(document.querySelectorAll('.check-in-code')).toHaveLength(2);
    });

    it('points every check-in code at that racer’s image', () => {
        mockRace();
        open('?kind=check-in-code&racers=11');

        expect(screen.getByAltText('Check-in code for Alex Rivera')).toHaveAttribute(
            'src',
            '/api/printables/barcode/11.png',
        );
    });

    it('says how much paper this is before the operator commits any', () => {
        mockRace();
        open('?kind=drivers-license');

        expect(screen.getByText(/2 cards · 1 sheet of Letter · 10 per sheet/)).toBeInTheDocument();
    });

    it('prints when asked', async () => {
        mockRace();
        const print = vi.fn();
        vi.stubGlobal('print', print);
        open();

        await userEvent.click(screen.getByRole('button', { name: /^Print$/ }));

        expect(print).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('has nothing to print for an empty roster', () => {
        mockRace({ ...RACE, racers: [] });
        open();

        expect(screen.getByText(/No racers to print/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Print$/ })).toBeDisabled();
    });

    it('puts the event on a pit pass', () => {
        // The pass answers "where do I need to be", so the date and the venue
        // are on it. Nothing else prints them.
        mockRace();
        open('?racers=11');

        const card = document.querySelector('.pit-pass') as HTMLElement;
        expect(within(card).getByText(/March 14, 2026/)).toBeInTheDocument();
        expect(within(card).getByText('St Anne’s Hall')).toBeInTheDocument();
    });

    it('falls back to initials for a racer with no photo', () => {
        // Passes get printed before check-in, which is exactly when the photos
        // are missing.
        mockRace();
        open('?racers=12');

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('SO')).toBeInTheDocument();
    });

    it('shows a car number every card can be matched by', () => {
        mockRace();
        open('?kind=drivers-license&racers=12');

        const card = document.querySelector('.drivers-license') as HTMLElement;
        expect(within(card).getByText('3')).toBeInTheDocument();
        // No car name yet; the field stays on the card rather than reflowing it.
        expect(within(card).getByText('Unnamed')).toBeInTheDocument();
    });

    it('reports a race it cannot load', () => {
        mockRace(null);
        open();

        expect(screen.getByText('Race not found.')).toBeInTheDocument();
    });

    it('offers car labels in the picker', () => {
        mockRace();
        open();

        expect(screen.getByRole('button', { name: /Car labels/ })).toBeInTheDocument();
    });

    it('switches to car labels and renders one card per racer', async () => {
        mockRace();
        open();

        await userEvent.click(screen.getByRole('button', { name: /Car labels/ }));

        expect(document.querySelectorAll('.car-sticker')).toHaveLength(2);
        expect(screen.getByRole('button', { name: /Car labels/ })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('prints selected racers as car labels in car-number order', () => {
        mockRace();
        open('?kind=car-sticker&racers=11,12');

        expect(document.querySelectorAll('.car-sticker')).toHaveLength(2);
        expect(cardNames()).toEqual(['Sam Okafor', 'Alex Rivera']);
    });

    it('offers the print-before-check-in checkbox only for car labels, unchecked by default', () => {
        mockRace();
        open();

        expect(
            screen.queryByLabelText(/Leave the weight blank/),
        ).not.toBeInTheDocument();
    });

    it('shows the checkbox once car labels is chosen, and it forces the weight blank when checked', async () => {
        mockRace({
            ...RACE,
            racers: [{ ...RACE.racers[0], carWeight: 4.98 }],
        });
        open('?kind=car-sticker');

        const card = document.querySelector('.car-sticker') as HTMLElement;
        expect(within(card).getByText('4.98 oz')).toBeInTheDocument();

        const checkbox = screen.getByLabelText(/Leave the weight blank/);
        expect(checkbox).not.toBeChecked();

        await userEvent.click(checkbox);

        expect(checkbox).toBeChecked();
        expect(within(card).getByText('____ oz')).toBeInTheDocument();
    });

    it('says how much paper the 10-per-sheet car label grid needs', () => {
        mockRace();
        open('?kind=car-sticker');

        expect(screen.getByText(/2 cards · 1 sheet of Letter · 10 per sheet/)).toBeInTheDocument();
    });
});
