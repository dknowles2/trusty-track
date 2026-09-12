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
        racingGroupCount: 2,
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

        // 10 racers x 1 run, plus a championship of 3 (the trophy setting)
        // raced twice.
        expect(screen.getByText('Total Heats: 16')).toBeInTheDocument();
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

        // 19 racers x 1 run, plus a championship of 3 (the trophy setting).
        expect(screen.getByText('Total Heats: 22')).toBeInTheDocument();
        unmount();

        // The same roster on a wider track runs the same number of heats —
        // the championship's size follows the trophy setting, not the lane
        // count, so widening the track changes nothing here either (#775).
        render(
            <AlertProvider><RoundWizard {...defaultProps} racerCount={19} laneCount={6} /></AlertProvider>
        );
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));

        // 19 again, and a championship of 3.
        expect(screen.getByText('Total Heats: 22')).toBeInTheDocument();
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
        //   General:      10 racers x 1 run  = 10 heats
        //   Championship:  3 racers x 1 run  =  3 heats
        //                                      --------
        //                                        13
        //
        // This used to divide by the lane count and answer 4, which is the
        // arithmetic for a scheduler that packs racers into heats (#140).
        // The championship's own size is `championshipTrophies` (3) — the
        // race's own setting for how many cars advance — not
        // `Math.max(championshipTrophies, laneCount)` (#775).
        expect(screen.getByText('Total Heats: 13')).toBeInTheDocument();
        // 13 heats at the 1.75-minute baseline (#591) — no pace has been
        // learned yet, since this race has no recorded heats.
        expect(screen.getByText(/Estimated Grand Total: ~24 mins/i)).toBeInTheDocument();
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
        expect(screen.getByText('Estimated Grand Total: ~24 mins')).toBeInTheDocument();
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

    it('defaults the finalist count to the trophy setting, not the lane count (#775)', async () => {
        // `Race.championship_trophies` is "how many cars advance to the
        // final" — a setting the operator has already made on the roster's
        // page header summary line. `defaultProps` sets it to 3 on a 4-lane track;
        // the wizard used to default "Number of Finalists" to
        // `Math.max(championshipTrophies, laneCount)` (4 here) "to fill a
        // heat", silently disagreeing with the setting shown one screen away.
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Generate schedule'));

        expect(mockExecuteMutation).toHaveBeenCalledWith({
            raceId: 1,
            config: expect.objectContaining({
                championshipRounds: [
                    expect.objectContaining({ numTopRacers: 3 }),
                ],
            }),
        });
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
        await user.click(screen.getByText('Generate schedule'));

        expect(mockExecuteMutation).toHaveBeenCalledWith({
            raceId: 1,
            config: expect.objectContaining({
                generalRound: expect.objectContaining({ type: 'ALL' }),
                championshipRounds: [
                    expect.objectContaining({
                        name: 'Grand Finals',
                        source: 'ALL',
                        numTopRacers: 3 // championshipTrophies (#775)
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

        await user.click(screen.getByText('Generate schedule'));

        // Wait for the custom modal to show error
        await waitFor(() => {
            expect(
                screen.getByText('Cannot use wizard: rounds already exist for this race.'),
            ).toBeInTheDocument();
        });
    });

    it('disables schedule generation and displays a notice when fewer than 2 racers are checked in (#784)', async () => {
        const user = userEvent.setup();
        render(
            <AlertProvider>
                <RoundWizard {...defaultProps} racerCount={1} totalRacerCount={5} />
            </AlertProvider>
        );

        // Step 1 notice
        expect(
            screen.getByText(/At least 2 checked-in cars are required to generate heats/i)
        ).toBeInTheDocument();

        // Navigate to Step 3
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));

        // Generate button should be disabled
        const generateButton = screen.getByRole('button', { name: 'Generate schedule' });
        expect(generateButton).toBeDisabled();
    });

    it('displays notice when some registered racers are not checked in (#784)', async () => {
        const user = userEvent.setup();
        render(
            <AlertProvider>
                <RoundWizard {...defaultProps} racerCount={4} totalRacerCount={10} />
            </AlertProvider>
        );

        // Step 1 check-in status
        expect(
            screen.getByText(/4 of 10 cars checked in\. Previews and heats only include checked-in cars\./i)
        ).toBeInTheDocument();

        // Navigate to Step 3
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));

        // Step 3 Review footnote
        expect(
            screen.getByText(/\* Previews are based on 4 checked-in cars \(6 not checked in\)\. Only checked-in cars are put into heats\./i)
        ).toBeInTheDocument();
    });

    // #943: the wizard offers the same "How it's raced" and "Which cars
    // race" choices `RoundConfigModal` (Add Round) already did, through the
    // same shared fieldsets, so a pack no longer has to skip the recommended
    // path to reach balanced, elimination, the Slowest Race, or a hand pick.

    it('step 1 offers "How it\'s raced", and choosing elimination submits the strategy and its losses', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(
            screen.getByLabelText("Elimination — lose too many heats and you're out")
        );
        fireEvent.change(screen.getByLabelText('Losses before a car is out'), {
            target: { value: '2' },
        });

        // The Format picker ("All Pack" / "By Den") only makes sense
        // alongside PPC — RoundConfigModal hides it for the other two
        // styles, and the wizard now matches.
        expect(screen.queryByText('All Pack')).not.toBeInTheDocument();
        expect(screen.queryByText('By Den')).not.toBeInTheDocument();

        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Generate schedule'));

        expect(mockExecuteMutation).toHaveBeenCalledWith({
            raceId: 1,
            config: expect.objectContaining({
                generalRound: expect.objectContaining({
                    schedulingStrategy: 'ELIMINATION',
                    eliminationLosses: 2,
                    type: 'ALL',
                }),
            }),
        });
    });

    it('a general round chosen "By Den" reverts to "ALL" once elimination is chosen', async () => {
        // Regression guard for the same rule `RoundConfigModal` already
        // follows: an elimination or balanced round is always the whole
        // pack, so a format picked before switching styles must not survive
        // to the submitted config.
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(screen.getByText('By Den'));
        await user.click(
            screen.getByLabelText('Balanced — each round of heats matches cars doing about as well')
        );
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Generate schedule'));

        expect(mockExecuteMutation).toHaveBeenCalledWith({
            raceId: 1,
            config: expect.objectContaining({
                generalRound: expect.objectContaining({
                    schedulingStrategy: 'BALANCED',
                    type: 'ALL',
                }),
            }),
        });
    });

    it('step 2 never offers "How it\'s raced" — a championship round cannot also be elimination or balanced', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        // Choosing elimination in step 1 must not leak a style choice into
        // step 2's championship round cards.
        await user.click(
            screen.getByLabelText("Elimination — lose too many heats and you're out")
        );
        await user.click(screen.getByText('Next'));

        expect(
            screen.queryByText("Elimination — lose too many heats and you're out")
        ).not.toBeInTheDocument();
        expect(screen.queryByText('Everyone races in every lane')).not.toBeInTheDocument();
    });

    it('step 2 hides "Each Den" for the first championship round once the qualifier is elimination (#1012)', async () => {
        // "Each {group}" splits standings a qualifying round drew from by
        // racing group — meaningless once that round is Elimination, since
        // elimination heats never feed the aggregate standings at all
        // (CLAUDE.md's "Ladderless elimination"). The server chains the
        // final to the elimination round's own survival ranking regardless
        // of what gets submitted; this pins that the option disappears from
        // the picker too, rather than offering a choice the server is going
        // to override anyway.
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(
            screen.getByLabelText("Elimination — lose too many heats and you're out")
        );
        await user.click(screen.getByText('Next'));

        expect(screen.getByText('Overall')).toBeInTheDocument();
        expect(screen.queryByText('Each Den')).not.toBeInTheDocument();
    });

    it('a first championship round left on "Each Den" reverts to "Overall" once elimination is chosen', async () => {
        // The mirror of the general round's own "By Den reverts to ALL"
        // guard above (#1012): switching general styles after picking
        // "Each Den" for the final must not leave the step 3 preview
        // multiplying by the racing group count for a field the server is
        // about to chain to the elimination round instead.
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(screen.getByText('Next'));
        await user.selectOptions(screen.getByDisplayValue('Overall'), 'EACH_GROUP');
        expect(screen.getByDisplayValue('Each Den')).toBeInTheDocument();

        await user.click(screen.getByText('Back'));
        await user.click(
            screen.getByLabelText("Elimination — lose too many heats and you're out")
        );
        await user.click(screen.getByText('Next'));

        expect(screen.getByDisplayValue('Overall')).toBeInTheDocument();
        expect(screen.queryByText('Each Den')).not.toBeInTheDocument();
    });

    it('step 2 offers "Which cars race", and choosing the slowest cars submits the direction and renames the round', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(screen.getByText('Next'));
        await user.click(screen.getByLabelText('The slowest cars'));
        expect(screen.getByDisplayValue('Slowest Race')).toBeInTheDocument();

        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Generate schedule'));

        expect(mockExecuteMutation).toHaveBeenCalledWith({
            raceId: 1,
            config: expect.objectContaining({
                championshipRounds: [
                    expect.objectContaining({
                        name: 'Slowest Race',
                        advancementFromBottom: true,
                    }),
                ],
            }),
        });
    });

    it('step 2 offers "I\'ll choose who races myself", and opens the picker for that round once created', async () => {
        mockExecuteMutation.mockResolvedValue({
            data: {
                createRoundWizard: [
                    { id: 501, roundNumber: 1, name: 'All Pack Round' },
                    { id: 502, roundNumber: 2, name: 'Grand Finals' },
                ],
            },
        });
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(screen.getByText('Next'));
        await user.click(screen.getByLabelText(/I'll choose who races myself/));
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Generate schedule'));

        // The mutation itself never hears about the checkbox — the same
        // client-side hand-off `RoundConfigModal`'s "pickFieldByHand" makes,
        // never sent to `createRound` either.
        const sentConfig = mockExecuteMutation.mock.calls[0][0].config;
        expect(sentConfig.championshipRounds[0]).not.toHaveProperty('pickFieldByHand');

        await waitFor(() => expect(mockOnCreated).toHaveBeenCalledWith(502));
    });

    it('reports no round to hand-pick when nothing asked for it', async () => {
        mockExecuteMutation.mockResolvedValue({
            data: {
                createRoundWizard: [
                    { id: 601, roundNumber: 1, name: 'All Pack Round' },
                    { id: 602, roundNumber: 2, name: 'Grand Finals' },
                ],
            },
        });
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);

        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Generate schedule'));

        await waitFor(() => expect(mockOnCreated).toHaveBeenCalledWith(null));
    });
});

