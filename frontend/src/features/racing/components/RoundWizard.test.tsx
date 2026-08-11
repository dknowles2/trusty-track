import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoundWizard } from './RoundWizard';
import userEvent from '@testing-library/user-event';
import { AlertProvider } from '../../../context/AlertContext';

// Mock urql
const mockExecuteMutation = vi.fn();
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useMutation: () => [{}, mockExecuteMutation],
    };
});

describe('RoundWizard Component', () => {
    const mockOnClose = vi.fn();
    const mockOnCreated = vi.fn();

    const defaultProps = {
        isOpen: true,
        onClose: mockOnClose,
        raceId: 1,
        racerCount: 10,
        denCount: 2,
        laneCount: 4,
        championshipTrophies: 3,
        onCreated: mockOnCreated
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockExecuteMutation.mockResolvedValue({ data: { createRaceWizard: [] } });
    });

    it('counts a multi-run championship as the runs it was asked for', async () => {
        // #143. The field was collected, documented as configurable, and
        // discarded — so the estimate followed the code and assumed one run.
        // Now the code honours it, and the estimate follows it there too.
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(screen.getByText('Next'));
        // Select before typing. `clear()` cannot empty this input — the
        // handler's `parseInt(...) || 1` puts 1 straight back — so typing after
        // it appends, and "2" becomes 12.
        // Set directly. `clear()` cannot empty this input — the handler's
        // `parseInt(...) || 1` puts 1 straight back — so typing after it
        // appends, and "2" becomes 12.
        const spinbuttons = screen.getAllByRole('spinbutton');
        const runsInput = spinbuttons[spinbuttons.length - 1];
        fireEvent.change(runsInput, { target: { value: '2' } });
        await user.click(screen.getByText('Next'));

        // 10 racers x 1 run, plus a championship of max(3, 4) = 4 raced twice.
        expect(screen.getByText('Total Heats: 18')).toBeInTheDocument();
    });

    it('estimates the heat count the scheduler will actually produce', async () => {
        // The number an operator sizes their evening by. It was out by a factor
        // of the lane count, and the shipped documentation screenshots caught
        // it in the act: the wizard promised "Total Heats: 8" for a race that
        // then ran 23 (#140).
        //
        // More lanes must not mean fewer heats — that was the tell. Under PPC a
        // wider track means each racer meets more opponents per heat, not that
        // fewer heats are needed.
        const user = userEvent.setup();
        const { unmount } = render(
            <AlertProvider><RoundWizard {...defaultProps} racerCount={19} laneCount={3} /></AlertProvider>
        );
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));

        // 19 racers x 1 run, plus a championship of max(3, 3) = 3.
        expect(screen.getByText('Total Heats: 22')).toBeInTheDocument();
        unmount();

        // The same roster on a wider track runs the same number of heats.
        render(
            <AlertProvider><RoundWizard {...defaultProps} racerCount={19} laneCount={6} /></AlertProvider>
        );
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));

        // 19 again, and a championship of max(3, 6) = 6.
        expect(screen.getByText('Total Heats: 25')).toBeInTheDocument();
    });

    it('renders Step 1 by default', () => {
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        expect(screen.getByText('Race Schedule Wizard')).toBeInTheDocument();
        expect(screen.getByText('Quickly generate a complete race schedule based on your settings.')).toBeInTheDocument();
        expect(screen.getByText('All Pack')).toBeInTheDocument();
        expect(screen.getByText('By Den')).toBeInTheDocument();
    });

    it('calculates estimation correctly in Step 3 (with default championship)', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        // Navigate to Step 3
        await user.click(screen.getByText('Next')); // Step 2
        await user.click(screen.getByText('Next')); // Step 3

        // PPC makes one heat per racer, per run — lane 1 is seeded with every
        // racer, and that fixes the count. The lane count does not divide it.
        //
        //   General:      10 racers x 1 run          = 10 heats
        //   Championship: max(3, 4) = 4 racers x 1   =  4 heats
        //                                              --------
        //                                                14
        //
        // This used to divide by the lane count and answer 4, which is the
        // arithmetic for a scheduler that packs racers into heats (#140).
        expect(screen.getByText('Total Heats: 14')).toBeInTheDocument();
        expect(screen.getByText(/Estimated Grand Total: ~14 mins/i)).toBeInTheDocument();
    });

    it('navigates through steps', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        // Step 1 -> Step 2
        await user.click(screen.getByText('Next'));
        expect(screen.getByText('Championship Rounds')).toBeInTheDocument();
        // Should show default round
        expect(screen.getByDisplayValue('Grand Finals')).toBeInTheDocument();

        // Step 2 -> Step 3
        await user.click(screen.getByText('Next'));
        expect(screen.getByText('Estimated Grand Total: ~14 mins')).toBeInTheDocument();
        expect(screen.getByText('Review')).toBeInTheDocument(); // Step indicator or content

        // Step 3 -> Step 2
        await user.click(screen.getByText('Back'));
        expect(screen.getByDisplayValue('Grand Finals')).toBeInTheDocument();
    });

    it('can remove default round and add new one', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        await user.click(screen.getByText('Next')); // To Step 2

        // Verify default exists
        expect(screen.getByDisplayValue('Grand Finals')).toBeInTheDocument();

        // Remove it
        // Remove it

        // Use test id for reliability
        const closeButton = screen.getByTestId('remove-round-btn');
        await user.click(closeButton);

        await waitFor(() => {
            expect(screen.queryByDisplayValue('Grand Finals')).not.toBeInTheDocument();
            expect(screen.getByText('No championship rounds configured.')).toBeInTheDocument();
        });

        // Add new one
        await user.click(screen.getByText('+ Add Round'));
        expect(screen.getByDisplayValue('New Championship Round')).toBeInTheDocument();
    });

    it('submits correct data to GraphQL mutation', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        // Step 2
        await user.click(screen.getByText('Next'));
        // Keep default "Grand Finals"

        // Step 3
        await user.click(screen.getByText('Next'));

        // Create!
        await user.click(screen.getByText('Generate Schedule'));

        expect(mockExecuteMutation).toHaveBeenCalledWith({
            raceId: 1,
            config: expect.objectContaining({
                generalRound: expect.objectContaining({ type: 'PACK' }),
                championshipRounds: [
                    expect.objectContaining({
                        name: 'Grand Finals',
                        source: 'PACK',
                        numTopRacers: 4 // Math.max(3, 4)
                    })
                ]
            })
        });
        expect(mockOnCreated).toHaveBeenCalled();
    });

    it('shows error alert on API failure', async () => {
        const user = userEvent.setup();
        mockExecuteMutation.mockResolvedValue({
            error: {
                graphQLErrors: [
                    { message: 'Cannot use wizard: rounds already exist for this race.' },
                ],
            },
        });

        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        // Navigate to create step (Step 3)
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));

        await user.click(screen.getByText('Generate Schedule'));

        // Wait for the custom modal to show error
        await waitFor(() => {
            expect(
                screen.getByText('Cannot use wizard: rounds already exist for this race.'),
            ).toBeInTheDocument();
        });
    });
});
