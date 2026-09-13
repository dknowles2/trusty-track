// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import RaceDetails from './RaceDetails';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AlertProvider } from '../../../context/AlertContext';
import { useQuery, useMutation, useSubscription } from 'urql';
import * as GQL from '../graphql/queries';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';

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

const RACE_DATA = {
    race: {
        id: 1,
        name: 'Test Race',
        scoringStrategy: 'TIMED',
        carNumberingStrategy: 'PER_GROUP',
        racers: [],
        racingGroups: [],
        leaderboard: [],
    },
    tracks: [],
};

/**
 * Discriminate `useQuery` by document — the same reason `RaceDetailsPopulate
 * .test.tsx`'s `mockMutations` discriminates `useMutation`. `RaceDetails.tsx`
 * queries `GET_RACE_DETAILS` directly and, through `useRole()`/
 * `useIsRefusedOnDemo()`, `INITIAL_CONFIG_QUERY` too — a blanket mock would
 * hand the race's own roster shape back for the config query as well.
 */
function mockQueries(demoRefusedMutations: string[] = []) {
    (useQuery as any).mockImplementation((args: { query: unknown }) => {
        if (args.query === INITIAL_CONFIG_QUERY) {
            return [
                { data: { initialConfig: { role: 'OPERATOR', demoRefusedMutations } }, fetching: false },
                vi.fn(),
            ];
        }
        return [{ data: RACE_DATA, fetching: false, error: null }, vi.fn()];
    });
}

function mockMutations(overrides: [unknown, ReturnType<typeof vi.fn>][] = []) {
    (useMutation as any).mockImplementation((query: unknown) => {
        const match = overrides.find(([doc]) => doc === query);
        return [{ fetching: false }, match ? match[1] : vi.fn()];
    });
}

const mockShowAlert = vi.fn();
const mockShowToast = vi.fn();
const mockShowConfirm = vi.fn();

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({
        showAlert: mockShowAlert,
        showToast: mockShowToast,
        showConfirm: mockShowConfirm,
    }),
    AlertProvider: ({ children }: any) => <>{children}</>,
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

beforeEach(() => {
    (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

function renderRaceDetails() {
    return render(
        <AlertProvider>
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        </AlertProvider>
    );
}

describe('photo controls on the demo (#1092, #1095)', () => {
    it('disables the roster overflow\'s Upload Photos entry, with a title, when uploadImage is refused', async () => {
        mockQueries(['uploadImage']);
        mockMutations();

        renderRaceDetails();
        await waitFor(() => screen.getByTestId('race-summary-line'));

        await userEvent.click(screen.getByTestId('roster-more-menu'));
        const uploadPhotosBtn = screen.getByText('Upload Photos').closest('button')!;

        expect(uploadPhotosBtn).toBeDisabled();
        expect(uploadPhotosBtn).toHaveAttribute('title', "Photos can't be uploaded on the demo");
    });

    it('leaves Upload Photos enabled when the demo refuses nothing (an ordinary install)', async () => {
        mockQueries([]);
        mockMutations();

        renderRaceDetails();
        await waitFor(() => screen.getByTestId('race-summary-line'));

        await userEvent.click(screen.getByTestId('roster-more-menu'));
        const uploadPhotosBtn = screen.getByText('Upload Photos').closest('button')!;

        expect(uploadPhotosBtn).not.toBeDisabled();
    });

    it('disables the populate modal\'s photo checkboxes when uploadImage is refused', async () => {
        mockQueries(['uploadImage']);
        mockMutations();

        renderRaceDetails();
        await waitFor(() => screen.getByTestId('race-summary-line'));

        await userEvent.click(document.querySelector('.split-btn-arrow')!);
        await userEvent.click(screen.getByText(/Populate Test Data/i));

        const racerPhotos = screen.getByLabelText('Add Racer Photos') as HTMLInputElement;
        const carPhotos = screen.getByLabelText(/Add (?!Racer).* Photos/) as HTMLInputElement;

        expect(racerPhotos).toBeDisabled();
        expect(racerPhotos.checked).toBe(false);
        expect(carPhotos).toBeDisabled();
    });

    it('does not send the photo flags when populate is submitted with photos refused', async () => {
        mockQueries(['uploadImage']);
        const genericMutationMock = vi.fn().mockResolvedValue({ data: {} });
        mockMutations([[GQL.POPULATE_RACE, genericMutationMock]]);

        renderRaceDetails();
        await waitFor(() => screen.getByTestId('race-summary-line'));

        await userEvent.click(document.querySelector('.split-btn-arrow')!);
        await userEvent.click(screen.getByText(/Populate Test Data/i));
        await userEvent.click(screen.getByText('Generate'));

        await waitFor(() => {
            expect(genericMutationMock).toHaveBeenCalledWith(expect.objectContaining({
                config: expect.objectContaining({
                    addRacerPhotos: false,
                    addCarPhotos: false,
                }),
            }));
        });
    });
});
