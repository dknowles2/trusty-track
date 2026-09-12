// @vitest-environment jsdom
/**
 * #997 — a disabled button that carries its own inline background/colour
 * (Add Racer's split button, a racer row's Checked In / Edit) painted
 * exactly like an enabled one, because an inline style always wins over a
 * class selector, `.primary-btn:disabled`/`.secondary-btn:disabled`
 * included. The fix is a generic `button:disabled` rule in `index.css` keyed
 * on `opacity` — a plain element/pseudo-class selector, not a class, since
 * two of the three Checked In / Edit table renderings carry no button class
 * at all (and giving them one turned out to be its own bug: `.secondary-btn`
 * sets `font-weight: bold`, which these buttons' own inline styles never
 * disabled, and bold text reflowed the table's auto-sized columns — a
 * pixel-diffing screenshot check on `race-day/04` and `race-setup/08` in
 * CI is what caught it). This file is not able to assert the CSS rule
 * itself; it pins the contract the rule depends on — every affected button
 * renders with the native `disabled` attribute.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import RaceDetails from './RaceDetails';

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useMutation, useSubscription } from 'urql';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

function mockMutations() {
    (useMutation as any).mockImplementation(() => [{ fetching: false }, vi.fn()]);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

beforeEach(() => {
    (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({ showAlert: vi.fn(), showConfirm: vi.fn() }),
}));

function mockLockedRaceWithCheckedInRacer() {
    (useQuery as any).mockReturnValue([{
        data: {
            race: {
                id: 1,
                name: 'Concluded Derby',
                dateTime: null,
                location: null,
                trackId: 1,
                scoringStrategy: 'TIMED',
                carNumberingStrategy: 'MANUAL',
                racingGroups: [],
                racers: [
                    {
                        id: 9,
                        firstName: 'Jordan',
                        lastName: 'Mitchell',
                        carNumber: 42,
                        racingGroupId: null,
                        carName: 'Blue Streak',
                        carPassedInspection: true,
                        carWeight: 5.0,
                        racerImageUrl: null,
                        carImageUrl: null,
                        excludedFromStandings: false,
                    },
                ],
                leaderboard: [],
                scheduledRacerIds: [],
                rounds: [],
                isLocked: true,
            },
            tracks: [{ id: 1, name: 'Main Track' }],
        },
        fetching: false,
        error: null,
    }, vi.fn()]);
}

function renderRaceDetails() {
    return render(
        <MemoryRouter initialEntries={['/races/1']}>
            <Routes>
                <Route path="/races/:raceId" element={<RaceDetails />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('disabled buttons carry the disabled contract the CSS rule depends on (#997)', () => {
    it('disables Add Racer and marks it with the class the disabled rule reaches', async () => {
        mockLockedRaceWithCheckedInRacer();
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
        });

        const addRacer = screen.getByRole('button', { name: /Add Racer/ });
        expect(addRacer).toBeDisabled();
        expect(addRacer).toHaveClass('secondary-btn');
    });

    it('disables every Checked In / Edit rendering of a checked-in racer', async () => {
        // Deliberately not asserting a shared class here: two of the three
        // renderings of this button (the desktop table's two variants) carry
        // no button class, by design (see the file header) — the disabled
        // rule reaches them through the native `disabled` attribute alone.
        mockLockedRaceWithCheckedInRacer();
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /Checked In \/ Edit/ }).length).toBeGreaterThan(0);
        });

        const buttons = screen.getAllByRole('button', { name: /Checked In \/ Edit/ });
        for (const button of buttons) {
            expect(button).toBeDisabled();
        }
    });
});
