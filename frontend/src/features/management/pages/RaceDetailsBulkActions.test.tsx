// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import RaceDetails from './RaceDetails';

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useMutation, useSubscription } from 'urql';
import * as GQL from '../graphql/queries';

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

beforeEach(() => {
    (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

const { mockShowAlert, mockShowConfirm } = vi.hoisted(() => {
    return {
        mockShowAlert: vi.fn(),
        mockShowConfirm: vi.fn(),
    }
})

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({
        showAlert: mockShowAlert,
        showConfirm: mockShowConfirm,
    }),
}))



describe('RaceDetails Bulk Actions', () => {
    const mockRace = { id: 1, name: 'Test Race', date_time: '2024-03-15T10:00:00' };
    const mockRacers = [
        { id: 1, first_name: 'Alpha', last_name: 'One', car_number: 101, racing_group_id: 1 },
        { id: 2, first_name: 'Beta', last_name: 'Two', car_number: 102, racing_group_id: 1 },
    ];
    const mockRacingGroups = [{ id: 1, name: 'Tigers', color: 'orange' }];

    // Prepare mutation mocks
    const mockBulkAutoNumber = vi.fn().mockResolvedValue({ data: { bulkAutoNumber: 2 } });
    const mockBulkDelete = vi.fn().mockResolvedValue({ data: { bulkDeleteRacers: true } });
    const mockBulkMoveToRacingGroup = vi.fn().mockResolvedValue({ data: { bulkMoveToRacingGroup: true } });
    const mockBulkCheckIn = vi.fn().mockResolvedValue({ data: { bulkCheckIn: true } });
    const mockBulkClearNumbers = vi.fn().mockResolvedValue({ data: { bulkClearNumbers: true } });

    const setupMocks = () => {
        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: mockRace.id,
                    name: mockRace.name,
                    dateTime: mockRace.date_time,
                    scoringStrategy: 'TIMED',
                    carNumberingStrategy: 'PER_GROUP',
                    racers: mockRacers.map(r => ({
                        id: r.id,
                        firstName: r.first_name,
                        lastName: r.last_name,
                        carNumber: r.car_number,
                        racingGroupId: r.racing_group_id,
                        carPassedInspection: false,
                    })),
                    racingGroups: mockRacingGroups.map(d => ({ ...d, racerCount: 0 })),
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        (useMutation as any).mockImplementation((query: any) => {
            if (query === GQL.BULK_AUTO_NUMBER) return [{ fetching: false }, mockBulkAutoNumber];
            if (query === GQL.BULK_DELETE_RACERS) return [{ fetching: false }, mockBulkDelete];
            if (query === GQL.BULK_MOVE_TO_RACING_GROUP) return [{ fetching: false }, mockBulkMoveToRacingGroup];
            if (query === GQL.BULK_CHECK_IN) return [{ fetching: false }, mockBulkCheckIn];
            if (query === GQL.BULK_CLEAR_NUMBERS) return [{ fetching: false }, mockBulkClearNumbers];
            return [{ fetching: false }, vi.fn()];
        });

        // Mock tracks fetch for RaceForm

    };

    it('shows the selection bar once racers are selected', async () => {
        setupMocks();
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());


        const alphaCheckbox = screen.getByTestId('racer-select-1');
        fireEvent.click(alphaCheckbox);

        // The actions arrive with the selection rather than behind a button
        // that is disabled until there is one.
        expect(screen.getByTestId('roster-selection-bar')).toBeInTheDocument();
        expect(screen.getByText('1 selected')).toBeInTheDocument();
    });

    it('toggles all racers with select all checkbox', async () => {
        setupMocks();
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const selectAllCheckbox = screen.getByTestId('select-all-header');
        fireEvent.click(selectAllCheckbox);

        expect(screen.getByText('2 selected')).toBeInTheDocument();

        fireEvent.click(selectAllCheckbox);
    });

    it('triggers bulk auto-number action', async () => {
        setupMocks();

        const user = (await import('@testing-library/user-event')).default.setup();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const selectAllCheckbox = screen.getByTestId('select-all-header');
        await user.click(selectAllCheckbox);


        const autoNumBtn = await screen.findByTestId('bulk-auto-number-btn');
        await user.click(autoNumBtn);

        expect(mockBulkAutoNumber).toHaveBeenCalledWith({
            racerIds: [1, 2]
        });
        await waitFor(() => expect(mockShowAlert).toHaveBeenCalledWith('Successfully auto-numbered 2 racers', 'Bulk Auto-Number Result'));

        // #420: auto-number is additive, so the desk can follow it straight
        // into another bulk action on the same racers rather than re-ticking
        // select-all.
        expect(screen.getByTestId('roster-selection-bar')).toBeInTheDocument();
        expect(screen.getByText('2 selected')).toBeInTheDocument();
    });

    it('triggers bulk delete action after confirmation', async () => {
        setupMocks();
        mockShowConfirm.mockResolvedValue(true);

        const user = (await import('@testing-library/user-event')).default.setup();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const alphaCheckbox = screen.getByTestId('racer-select-1');
        await user.click(alphaCheckbox);


        const deleteBtn = await screen.findByTestId('bulk-delete-btn');
        await user.click(deleteBtn);

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(mockBulkDelete).toHaveBeenCalledWith({
            racerIds: [1]
        });

        // Delete removes rows, so it keeps clearing the selection rather than
        // leaving a stale selection bar pointed at racers that are gone.
        await waitFor(() => expect(screen.queryByTestId('roster-selection-bar')).toBeNull());
    });

    it('renders racingGroup options in the Move to racingGroup menu', async () => {
        setupMocks();
        const user = (await import('@testing-library/user-event')).default.setup();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        await user.click(screen.getByTestId('racer-select-1'));

        // A click, not a hover. The list used to fly out sideways on hover and
        // had to measure which side had room; it opens downward now.
        await user.click(await screen.findByTestId('bulk-move-to-racing-group-expand-btn'));

        const tigerOption = await screen.findByTestId('bulk-move-to-racing-group-1');
        expect(tigerOption).toHaveTextContent('Tigers');
        expect(screen.getByTestId('bulk-move-to-unassigned')).toBeInTheDocument();
    });

    it('triggers bulk check-in action after confirmation', async () => {
        setupMocks();
        mockShowConfirm.mockResolvedValue(true);

        const user = (await import('@testing-library/user-event')).default.setup();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const selectAllCheckbox = screen.getByTestId('select-all-header');
        await user.click(selectAllCheckbox);


        const checkInBtn = await screen.findByTestId('bulk-check-in-btn');
        await user.click(checkInBtn);

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(mockBulkCheckIn).toHaveBeenCalledWith({
            racerIds: [1, 2],
            passedInspection: true
        });

        // #420: check-in is additive too — the selection (and the bar it
        // shows) survives so the desk can move straight to the next action.
        expect(screen.getByTestId('roster-selection-bar')).toBeInTheDocument();
        expect(screen.getByText('2 selected')).toBeInTheDocument();
    });

    it('keeps the selection after moving racers to a racingGroup', async () => {
        // #420: move-to-racing-group is the third additive action — the same rule as
        // auto-number and check-in.
        setupMocks();
        const user = (await import('@testing-library/user-event')).default.setup();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const selectAllCheckbox = screen.getByTestId('select-all-header');
        await user.click(selectAllCheckbox);

        await user.click(await screen.findByTestId('bulk-move-to-racing-group-expand-btn'));
        await user.click(await screen.findByTestId('bulk-move-to-unassigned'));

        expect(mockBulkMoveToRacingGroup).toHaveBeenCalledWith({
            racerIds: [1, 2],
            racingGroupId: null
        });

        expect(screen.getByTestId('roster-selection-bar')).toBeInTheDocument();
        expect(screen.getByText('2 selected')).toBeInTheDocument();
    });

    it('clears the selection after clearing car numbers', async () => {
        // Clear numbers removes data the same way delete removes rows, so it
        // keeps the destructive-action behavior rather than the additive one.
        setupMocks();
        mockShowConfirm.mockResolvedValue(true);
        const user = (await import('@testing-library/user-event')).default.setup();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const selectAllCheckbox = screen.getByTestId('select-all-header');
        await user.click(selectAllCheckbox);

        await user.click(await screen.findByTestId('bulk-clear-numbers-btn'));

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(mockBulkClearNumbers).toHaveBeenCalledWith({
            racerIds: [1, 2]
        });

        await waitFor(() => expect(screen.queryByTestId('roster-selection-bar')).toBeNull());
    });

    it('keeps the first row to three controls', async () => {
        // The whole point of the reorganisation: six buttons competing for one
        // row is what made their labels wrap. Manage racingGroups, photos and print are
        // set-up actions and live behind the overflow.
        setupMocks();
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        // Anchored: the split button's arrow is labelled 'More ways to add
        // racers', which an unanchored match also finds.
        expect(screen.getByRole('button', { name: /^Add Racer$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Scan$/i })).toBeInTheDocument();
        expect(screen.getByTestId('roster-more-menu')).toBeInTheDocument();

        expect(screen.queryByRole('button', { name: /Manage Dens/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Upload Photos/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Print/i })).toBeNull();
    });

    it('offers the set-up actions in the overflow menu', async () => {
        setupMocks();
        const user = (await import('@testing-library/user-event')).default.setup();
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
        await user.click(screen.getByTestId('roster-more-menu'));

        expect(screen.getByRole('button', { name: /Manage Dens/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Upload Photos/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Print/i })).toBeInTheDocument();
    });

    it('has no selection bar until something is selected', async () => {
        // It replaced a button that was disabled for most of the day, so it
        // must not simply be that button wearing a different shape.
        setupMocks();
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
        expect(screen.queryByTestId('roster-selection-bar')).toBeNull();
    });

    it('clears the selection, which puts the bar away', async () => {
        setupMocks();
        const user = (await import('@testing-library/user-event')).default.setup();
        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes><Route path="/races/:raceId" element={<RaceDetails />} /></Routes>
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
        await user.click(screen.getByTestId('racer-select-1'));
        expect(screen.getByTestId('roster-selection-bar')).toBeInTheDocument();

        await user.click(screen.getByTestId('clear-selection'));
        expect(screen.queryByTestId('roster-selection-bar')).toBeNull();
    });
});
