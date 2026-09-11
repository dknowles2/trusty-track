import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation, useSubscription } from 'urql';
import { MemoryRouter } from 'react-router-dom';
import { RaceExecution, Heat } from './RaceExecution';
import { lane } from '../testFixtures';
import { TerminologyProvider } from '../../../context/TerminologyContext';

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useSubscription: vi.fn(),
  };
});

// Skip Heat used to go through the browser's own `window.confirm` — the one
// dialog outside the app's convention, and unstyled on a projector-connected
// machine. Mocked so a test can drive the confirm/cancel outcome and assert
// nothing ever reaches `window.confirm`.
const mockShowConfirm = vi.fn();
// Exposed the same way as `mockShowConfirm` (#765): a failed mutation must
// tell the operator, and a test asserting that needs a handle on the call.
const mockShowAlert = vi.fn();
vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({ showConfirm: mockShowConfirm, showAlert: mockShowAlert, showToast: vi.fn() }),
}));

// Mock Modal component
vi.mock('../../../components/ui/Modal', () => ({
    default: ({ isOpen, onClose, children, title }: any) => isOpen ? (
        <div data-testid="mock-modal">
            <h1>{title}</h1>
            <button onClick={onClose}>Close Mock</button>
            {children}
        </div>
    ) : null
}));

// Mock FakeTimerMole
vi.mock('./FakeTimerMole', () => ({
  FakeTimerMole: ({ isOpen, docked }: any) =>
    isOpen ? (
      <div data-testid="fake-timer-mole" data-docked={docked ? 'true' : 'false'}>
        Fake Timer Controls
      </div>
    ) : null,
}));

// Mock IntermissionControl (#940) — it has its own suite in
// IntermissionControl.test.tsx, including its `useQuery` call this file's
// urql mock does not stub. Rendered as a plain marker so tests here can
// assert it is present without caring about its internals.
vi.mock('./IntermissionControl', () => ({
  default: ({ raceId, compact }: any) => (
    <div data-testid="intermission-control-stub" data-race-id={raceId} data-compact={compact ? 'true' : 'false'} />
  ),
}));

describe('RaceExecution', () => {
    // `time` arrives as a string in `laneResults` on purpose — real databases
    // hold both — while `lanes` reports it as the number it always was.
    const mockHeat: Heat = {
        id: 1,
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        roundName: "Round 1",
        recordedAt: null,
        lanes: [
            lane({ lane: 1, racerId: 101, time: 3.5, place: 1 }),
            lane({ lane: 2, racerId: 102, time: 3.6, place: 2 }),
        ],
    };

    // Shaped to match what the GetRaceControlData query actually returns —
    // every selected field is present, nullable ones explicitly null.
    const mockRacers = {
        101: { id: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racerImageUrl: 'http://example.com/racer101.jpg', carImageUrl: null, carPassedInspection: true },
        102: { id: 102, firstName: 'Jane', lastName: 'Smith', carNumber: 2, racerImageUrl: null, carImageUrl: null, carPassedInspection: true }
    };

    const mockGetRacerName = vi.fn((id: number) => (mockRacers as any)[id] ? `${(mockRacers as any)[id].firstName} ${(mockRacers as any)[id].lastName}` : `Racer ${id}`);
    const mockOnRunHeat = vi.fn();
    const mockOnNextHeat = vi.fn();
    const mockOnUpdateResult = vi.fn();
    const mockMutationFn = vi.fn();

    const defaultProps = {
        raceId: 1,
        activeExecutionHeat: mockHeat,
        nextExecutionHeat: null,
        upcomingHeats: [],
        activeHeatId: null,
        onRunHeat: mockOnRunHeat,
        onNextHeat: mockOnNextHeat,
        getRacerName: mockGetRacerName,
        onUpdateResult: mockOnUpdateResult,
        racers: mockRacers,
        roundSummary: null,
        trackId: 1,
        timerType: 'FAKE',
        autoAdvanceHeat: false
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mockShowConfirm.mockResolvedValue(true);
        mockMutationFn.mockResolvedValue({ data: { prepareHeat: true } });
        (useMutation as any).mockReturnValue([{}, mockMutationFn]);
        // `handleUpdateResult` (RaceControl.tsx) resolves to whether the save
        // landed (#765) — default every test to the success case, the same
        // way `mockMutationFn` defaults to one, and let the tests that care
        // about a refusal override it.
        mockOnUpdateResult.mockResolvedValue(true);

        mockHeatSession(null);
    });

    /**
     * Stand in for the `heatSession` subscription.
     *
     * `null` means it has not answered yet, which is the state of the very
     * first render — the component falls back to the heat's stored lanes, and
     * most tests here are about that saved state rather than about a heat in
     * progress.
     */
    function mockHeatSession(session: any) {
        (useSubscription as any).mockImplementation(({ query }: any) => {
            if (JSON.stringify(query).includes('HeatSession')) {
                return [{ data: { heatSession: session } }];
            }
            return [{ data: null }];
        });
    }

    const liveLane = (overrides: any) => ({ ...lane(overrides), pending: false, ...overrides });

    it('renders race execution message if no active heat', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={null}
            />
        );
        expect(screen.getByText('Race Execution')).toBeInTheDocument();
    });

    it('renders current heat details and racer image', () => {
        render(
            <RaceExecution
                {...defaultProps}
            />
        );
        expect(screen.getByText('Heat 1')).toBeInTheDocument();
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('3.500s')).toBeInTheDocument();
        expect(screen.getByText('1st')).toBeInTheDocument();
    });

    it('shows no lane colour dot when the track has none configured (#611)', () => {
        const { container } = render(
            <RaceExecution
                {...defaultProps}
            />
        );
        expect(container.querySelector('.lane-badge-dot')).toBeNull();
    });

    it("shows a lane colour dot matching the track's configured colour (#611)", () => {
        render(
            <RaceExecution
                {...defaultProps}
                laneColors={['#E53935', '#1E88E5']}
            />
        );
        // Lane 1 is red, lane 2 is blue — both lanes are in the active
        // heat's own rendering, and each dot names its colour for anyone
        // hovering, the same pairing `LaneColor` carries on the backend.
        expect(screen.getByTitle('Red lane')).toBeInTheDocument();
        expect(screen.getByTitle('Blue lane')).toBeInTheDocument();
    });

    it('shows Edit button when heat is completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
            />
        );
        expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('opens modal when Edit button is clicked', () => {
        render(
            <RaceExecution
               {...defaultProps}
            />
        );
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
        expect(screen.getByText('Edit Results - Heat 1')).toBeInTheDocument();
    });

    it('calls onUpdateResult when saving edited results', async () => {
        render(
            <RaceExecution
                {...defaultProps}
            />
        );
        fireEvent.click(screen.getByText('Edit'));

        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0], { target: { value: '4.0' } });

        fireEvent.click(screen.getByText('Save Results'));

        await waitFor(() => {
            expect(mockOnUpdateResult).toHaveBeenCalled();
            const args = mockOnUpdateResult.mock.calls[0];
            expect(args[0]).toBe(1);
            // A number, not the '4.0' the blob used to carry (#5).
            expect(args[1][0].time).toBe(4);
        });
    });

    // #765: `onUpdateResult` (`handleUpdateResult` in RaceControl.tsx) catches
    // its own errors and shows an alert, but a rejected save (a duplicate
    // place under POINTS, the race locked mid-click, a dropped connection)
    // used to close this modal and discard everything the operator had
    // typed regardless. `FreeRaceExecution.tsx`'s own edit modal already
    // checks its mutation's result before closing — this brings the
    // official Override/Edit modal in line with it.
    it('keeps the Edit modal open and the typed values intact when the save is refused (#765)', async () => {
        mockOnUpdateResult.mockResolvedValue(false);
        render(
            <RaceExecution
                {...defaultProps}
            />
        );
        fireEvent.click(screen.getByText('Edit'));

        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0], { target: { value: '4.0' } });

        fireEvent.click(screen.getByText('Save Results'));

        await waitFor(() => expect(mockOnUpdateResult).toHaveBeenCalled());

        // The failed save must not discard what the operator typed, or close
        // the one screen that still holds it.
        expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
        expect(screen.getByText('Edit Results - Heat 1')).toBeInTheDocument();
    });

    // `onUpdateResult` (`handleUpdateResult` in RaceControl.tsx) is
    // documented to catch its own errors and resolve `false` rather than
    // reject — that contract is the whole point of #765's `Promise<boolean>`
    // change, and every other test here only ever exercises the resolved
    // `true`/`false` cases. Nothing pinned what happens if the promise
    // actually rejects — a genuine violation of that contract, or an
    // unrelated exception thrown somewhere in the mutation's own promise
    // chain. Before RaceExecution.tsx caught this itself, a rejection here
    // was a real uncaught rejection: the modal did not stay open, nothing
    // told the operator, and the typed values were gone all the same.
    it('keeps the Edit modal open and alerts, rather than crashing, when onUpdateResult rejects', async () => {
        mockOnUpdateResult.mockRejectedValue(new Error('boom'));
        render(
            <RaceExecution
                {...defaultProps}
            />
        );
        fireEvent.click(screen.getByText('Edit'));

        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0], { target: { value: '4.0' } });

        fireEvent.click(screen.getByText('Save Results'));

        await waitFor(() => expect(mockOnUpdateResult).toHaveBeenCalled());
        await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());

        expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
        expect(screen.getByText('Edit Results - Heat 1')).toBeInTheDocument();
    });

    describe('the Edit/Override modal follows the scoring strategy (#490, #525)', () => {
        it('shows a Time column for a TIMED race, and no Place column', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="TIMED" />);
            fireEvent.click(screen.getByText('Edit'));

            expect(screen.getByText('Time (s)')).toBeInTheDocument();
            expect(screen.queryByText('Place')).not.toBeInTheDocument();
        });

        // #525: a POINTS race can still have a timer, and a stored or
        // spurious time is otherwise uncorrectable and can stand as a track
        // record forever. Both columns render; Place stays the one the
        // operator has to fill in.
        it('shows both a Place and an optional Time column for a POINTS race', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            expect(screen.getByText('Place')).toBeInTheDocument();
            expect(screen.getByText('Time (s) — optional')).toBeInTheDocument();
        });

        it('seeds the Time field from the stored time on a POINTS heat, so it can be corrected', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            // mockHeat's lane 1 was stored with time: 3.5, place: 1.
            const inputs = screen.getAllByRole('spinbutton');
            expect(inputs[0]).toHaveValue(1); // Place
            expect(inputs[1]).toHaveValue(3.5); // Time
        });

        it('clearing a POINTS heat\'s Time field sends null, leaving the hand-typed place untouched (#525)', async () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            const inputs = screen.getAllByRole('spinbutton');
            // inputs[0] is Place (lane 1), inputs[1] is Time (lane 1).
            fireEvent.change(inputs[1], { target: { value: '' } });

            fireEvent.click(screen.getByText('Save Results'));

            await waitFor(() => {
                expect(mockOnUpdateResult).toHaveBeenCalled();
                const [, saved] = mockOnUpdateResult.mock.calls[0];
                expect(saved[0].time).toBeNull();
                // The place the timer recorded survives the correction —
                // this is a time fix, not a re-placement.
                expect(saved[0].place).toBe(1);
            });
        });

        it('a hand-typed place survives a save alongside a present time (both-columns case, #525)', async () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            const inputs = screen.getAllByRole('spinbutton');
            // Correct the place by hand; leave the recorded time as-is. Swap
            // lane 2's stored place (2) down to 1 in the same edit — leaving
            // it untouched would give both lanes place 2, which #766's own
            // duplicate-place check now refuses to save.
            fireEvent.change(inputs[0], { target: { value: '2' } });
            fireEvent.change(inputs[2], { target: { value: '1' } });

            fireEvent.click(screen.getByText('Save Results'));

            await waitFor(() => {
                expect(mockOnUpdateResult).toHaveBeenCalled();
                const [, saved] = mockOnUpdateResult.mock.calls[0];
                expect(saved[0].place).toBe(2);
                // The stored time rides along unchanged — the point of #525
                // is that this modal is still the only route to correct or
                // clear it, not that saving a place should touch it.
                expect(saved[0].time).toBe(3.5);
            });
        });

        it('typing a place under POINTS writes it to the saved lane', async () => {
            // No stored time on this heat — a hand-called POINTS heat never
            // has one — so the assertion below actually exercises "no Time
            // control means time is never touched" rather than happening to
            // pass because nothing changed it from an existing value.
            const untimed = { ...mockHeat, lanes: mockHeat.lanes.map((l) => ({ ...l, time: null, place: null })) };
            render(<RaceExecution {...defaultProps} activeExecutionHeat={untimed} scoringStrategy="POINTS" />);
            // Nothing recorded yet, so the control is Override rather than Edit.
            fireEvent.click(screen.getByText('Override'));

            const inputs = screen.getAllByRole('spinbutton');
            fireEvent.change(inputs[0], { target: { value: '2' } });

            fireEvent.click(screen.getByText('Save Results'));

            await waitFor(() => {
                expect(mockOnUpdateResult).toHaveBeenCalled();
                const [heatId, saved] = mockOnUpdateResult.mock.calls[0];
                expect(heatId).toBe(1);
                expect(saved[0].place).toBe(2);
                // POINTS entry never touches time — there is no control for it.
                expect(saved[0].time).toBeNull();
            });
        });

        it('clearing a place under POINTS sends null, not a stale value', async () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            const inputs = screen.getAllByRole('spinbutton');
            fireEvent.change(inputs[0], { target: { value: '' } });

            fireEvent.click(screen.getByText('Save Results'));

            await waitFor(() => {
                expect(mockOnUpdateResult).toHaveBeenCalled();
                expect(mockOnUpdateResult.mock.calls[0][1][0].place).toBeNull();
            });
        });

        it.each(['0', '-1'])('typing a non-positive place ("%s") sends null, not the raw value (#524)', async (value) => {
            // `min="1"` on the input is not enforced by the browser here — the
            // field lives outside a <form> and Save is a plain button, so
            // constraint validation never runs. Without a deliberate check, a
            // "0" or "-1" was either accepted as-is or turned to null only by
            // coincidence of JS falsiness.
            const untimed = { ...mockHeat, lanes: mockHeat.lanes.map((l) => ({ ...l, time: null, place: null })) };
            render(<RaceExecution {...defaultProps} activeExecutionHeat={untimed} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Override'));

            const inputs = screen.getAllByRole('spinbutton');
            fireEvent.change(inputs[0], { target: { value } });

            fireEvent.click(screen.getByText('Save Results'));

            await waitFor(() => {
                expect(mockOnUpdateResult).toHaveBeenCalled();
                expect(mockOnUpdateResult.mock.calls[0][1][0].place).toBeNull();
            });
        });
    });

    // #766: the modal's Place column had no client-side check at all — the
    // only backstop was the server's `validate_lane_replacement`, and its
    // refusal (since #765) leaves the modal open but still costs a round
    // trip the operator has to interpret. These mirror the server's own
    // rules (`lanes.placeIssue`) so a bad value is caught before Save is
    // even clickable.
    describe('hand-entered places are checked before Save (#766)', () => {
        it('disables Save and names the lane when two places collide', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            const inputs = screen.getAllByRole('spinbutton');
            // Lane 1 is stored at place 1; giving it lane 2's place (2)
            // collides without touching lane 2 at all.
            fireEvent.change(inputs[0], { target: { value: '2' } });

            expect(screen.getByText('Place 2 is assigned to more than one lane.')).toBeInTheDocument();
            expect(screen.getByText('Save Results')).toBeDisabled();
        });

        it('disables Save and names the lane when a place exceeds the heat\'s field', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            const inputs = screen.getAllByRole('spinbutton');
            // Only two real racers in this heat — nobody to be 5th behind.
            fireEvent.change(inputs[0], { target: { value: '5' } });

            expect(
                screen.getByText("Lane 1's place is higher than the 2 racer(s) in this heat."),
            ).toBeInTheDocument();
            expect(screen.getByText('Save Results')).toBeDisabled();
        });

        it('re-enables Save once the operator fixes the collision', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            const inputs = screen.getAllByRole('spinbutton');
            fireEvent.change(inputs[0], { target: { value: '2' } });
            expect(screen.getByText('Save Results')).toBeDisabled();

            // Swap instead of colliding.
            fireEvent.change(inputs[2], { target: { value: '1' } });

            expect(screen.queryByText(/is assigned to more than one lane/)).not.toBeInTheDocument();
            expect(screen.getByText('Save Results')).not.toBeDisabled();
        });

        it('does not check places at all for a TIMED race — there is no Place column to collide', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="TIMED" />);
            fireEvent.click(screen.getByText('Edit'));

            expect(screen.getByText('Save Results')).not.toBeDisabled();
        });

        it('clicking a disabled Save never reaches onUpdateResult', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="POINTS" />);
            fireEvent.click(screen.getByText('Edit'));

            const inputs = screen.getAllByRole('spinbutton');
            fireEvent.change(inputs[0], { target: { value: '2' } });
            fireEvent.click(screen.getByText('Save Results'));

            expect(mockOnUpdateResult).not.toHaveBeenCalled();
        });
    });

    // #766's other note: `assignPlaces` breaks a genuine tie in recorded
    // times by array order, with nothing on screen saying a tie happened.
    // This does not change what gets saved — the modal has no place column
    // to correct it from under a TIMED strategy anyway — it only tells the
    // operator the tie exists so they can retime the heat if it matters.
    describe('an equal-time tie is shown, not silently broken (#766)', () => {
        it('says nothing when every recorded time is distinct', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="TIMED" />);
            fireEvent.click(screen.getByText('Edit'));

            expect(screen.queryByTestId('tied-times-note')).not.toBeInTheDocument();
        });

        it('names the lanes that recorded the identical time', () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="TIMED" />);
            fireEvent.click(screen.getByText('Edit'));

            // mockHeat's lane 1 is 3.5s; retype lane 2's 3.6s to match it.
            const inputs = screen.getAllByRole('spinbutton');
            fireEvent.change(inputs[1], { target: { value: '3.5' } });

            expect(screen.getByTestId('tied-times-note')).toHaveTextContent('Lanes 1 and 2');
            expect(screen.getByTestId('tied-times-note')).toHaveTextContent(/same time/);
        });

        it('does not block Save — the tie is informational, not an error', async () => {
            render(<RaceExecution {...defaultProps} scoringStrategy="TIMED" />);
            fireEvent.click(screen.getByText('Edit'));

            const inputs = screen.getAllByRole('spinbutton');
            fireEvent.change(inputs[1], { target: { value: '3.5' } });

            expect(screen.getByText('Save Results')).not.toBeDisabled();
            fireEvent.click(screen.getByText('Save Results'));

            await waitFor(() => expect(mockOnUpdateResult).toHaveBeenCalled());
        });
    });

    describe('a track with no timer (#490)', () => {
        it('shows Enter Results as the primary control instead of a secondary Override', () => {
            const untimed = { ...mockHeat, lanes: mockHeat.lanes.map((l) => ({ ...l, time: null, place: null, skipped: false })) };
            render(<RaceExecution {...defaultProps} activeExecutionHeat={untimed} timerType="NONE" />);

            expect(screen.getByText('Enter Results')).toBeInTheDocument();
            expect(screen.queryByText('Override')).not.toBeInTheDocument();
        });

        it('never shows "Waiting for Timer..." — there is nothing to wait for', () => {
            const untimed = { ...mockHeat, lanes: mockHeat.lanes.map((l) => ({ ...l, time: null, place: null, skipped: false })) };
            render(<RaceExecution {...defaultProps} activeExecutionHeat={untimed} timerType="NONE" />);

            expect(screen.queryByText('Waiting for Timer...')).not.toBeInTheDocument();
        });

        it('hides the timer status badge', () => {
            render(<RaceExecution {...defaultProps} timerType="NONE" />);
            expect(screen.queryByText('Timer disconnected')).not.toBeInTheDocument();
        });

        it('shows the timer status badge for a track that has one', () => {
            render(<RaceExecution {...defaultProps} timerType="FAKE" />);
            expect(screen.getByText('Timer disconnected')).toBeInTheDocument();
        });

        it('clicking Enter Results opens the same modal Override does', () => {
            const untimed = { ...mockHeat, lanes: mockHeat.lanes.map((l) => ({ ...l, time: null, place: null, skipped: false })) };
            render(<RaceExecution {...defaultProps} activeExecutionHeat={untimed} timerType="NONE" />);

            fireEvent.click(screen.getByText('Enter Results'));
            expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
            expect(screen.getByText('Edit Results - Heat 1')).toBeInTheDocument();
        });
    });

    it('renders "Racing..." when timer state is RUNNING', () => {
        mockHeatSession({
            trackId: 1,
            heatId: 1,
            phase: 'RUNNING',
            timerState: 'RUNNING',
            lanes: [liveLane({ lane: 1, racerId: 101 })],
        });

        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    lanes: [lane({ lane: 1, racerId: 101 })],
                }}
            />
        );

        expect(screen.getByText(/Racing.../)).toBeInTheDocument();
    });

    describe('the live view comes from the server (#7)', () => {
        it('shows a recorded 0.0 as a time, not as an unrun lane (#346)', () => {
            // A recorded 0.0 is a DNF marker, not "nothing here yet" — and
            // `r.time ? ... : '--'` treated 0 as falsy, so this screen used to
            // hide it entirely. #763 went further: a bare `0.0000s` didn't say
            // what it meant either, so `formatLaneTime` now labels it DNF
            // outright rather than printing the number.
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RECORDED',
                timerState: 'IDLE',
                lanes: [liveLane({ lane: 1, racerId: 101, time: 0.0, place: null })],
            });

            render(<RaceExecution {...defaultProps} />);

            expect(screen.getByText('DNF')).toBeInTheDocument();
            expect(screen.queryByText('--')).not.toBeInTheDocument();
        });

        it('shows a lane time the timer has reported but nothing has saved', () => {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RUNNING',
                timerState: 'RUNNING',
                lanes: [
                    liveLane({ lane: 1, racerId: 101, time: 3.101, place: 1, pending: true }),
                    liveLane({ lane: 2, racerId: 102 }),
                ],
            });

            render(
                <RaceExecution
                    {...defaultProps}
                    activeExecutionHeat={{
                        ...mockHeat,
                        lanes: [
                            lane({ lane: 1, racerId: 101 }),
                            lane({ lane: 2, racerId: 102 }),
                        ],
                    }}
                />
            );

            // The heat itself holds no times — this one exists only in the timer.
            expect(screen.getByText('3.101s')).toBeInTheDocument();
            expect(screen.getByText('--')).toBeInTheDocument();
        });

        it('shows the saved results, not a timer that has not caught up', () => {
            // The expensive one to get wrong: the heat is recorded and in the
            // standings, so a stale pending report must not appear over it.
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RECORDED',
                timerState: 'RUNNING',
                lanes: [
                    liveLane({ lane: 1, racerId: 101, time: 3.5, place: 1 }),
                    liveLane({ lane: 2, racerId: 102, time: 3.6, place: 2 }),
                ],
            });

            render(<RaceExecution {...defaultProps} />);

            expect(screen.getByText('3.500s')).toBeInTheDocument();
            expect(screen.queryByText(/Racing.../)).not.toBeInTheDocument();
            expect(screen.getByText('Edit')).toBeInTheDocument();
        });

        it('believes the phase over its own copy of the heat', () => {
            // The session arrives on its own channel, so it can be ahead: the
            // timer has saved a result and `heatSession` says RECORDED while
            // `activeExecutionHeat` still holds the pre-race lanes from the
            // last query. Deriving "completed" locally would leave the operator
            // staring at "Waiting for Timer..." over a heat that has finished.
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RECORDED',
                timerState: 'IDLE',
                lanes: [liveLane({ lane: 1, racerId: 101, time: 3.5, place: 1 })],
            });

            render(
                <RaceExecution
                    {...defaultProps}
                    activeExecutionHeat={{
                        ...mockHeat,
                        lanes: [lane({ lane: 1, racerId: 101 })],
                    }}
                />
            );

            expect(screen.getByText('Edit')).toBeInTheDocument();
            expect(screen.queryByText('Waiting for Timer...')).not.toBeInTheDocument();
        });

        it('treats a NOT_READY phase as a championship round awaiting its field', () => {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'NOT_READY',
                timerState: 'IDLE',
                lanes: [liveLane({ lane: 1, racerId: null, placeholderSlot: 1 })],
            });

            render(<RaceExecution {...defaultProps} />);

            expect(screen.getByText('Round Not Ready')).toBeInTheDocument();
        });
        it('shows the heat phase (e.g. Recorded) next to the heat heading (#786)', () => {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RECORDED',
                timerState: 'IDLE',
                lanes: [liveLane({ lane: 1, racerId: 101, time: 3.5, place: 1 })],
            });

            render(<RaceExecution {...defaultProps} />);

            const badge = screen.getByTestId('heat-phase-badge');
            expect(badge).toHaveTextContent('Recorded');
        });

        it('shows Ready when heat phase is WAITING (#786)', () => {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'WAITING',
                timerState: 'IDLE',
                lanes: [liveLane({ lane: 1, racerId: 101, time: null, place: null })],
            });

            render(<RaceExecution {...defaultProps} />);

            const badge = screen.getByTestId('heat-phase-badge');
            expect(badge).toHaveTextContent('Ready');
        });

        it('shows Racing… when heat phase is RUNNING (#786)', () => {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RUNNING',
                timerState: 'RUNNING',
                lanes: [liveLane({ lane: 1, racerId: 101, time: null, place: null })],
            });

            render(<RaceExecution {...defaultProps} />);

            const badge = screen.getByTestId('heat-phase-badge');
            expect(badge).toHaveTextContent('Racing…');
        });
    });

    it('shows "Waiting for Timer..." message when IDLE and not completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    lanes: [lane({ lane: 1, racerId: 101 })],
                }}
            />
        );

        expect(screen.getByText('Waiting for Timer...')).toBeInTheDocument();
    });

    it('calls prepareHeat mutation automatically when IDLE and not completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    lanes: [lane({ lane: 1, racerId: 101 })],
                }}
            />
        );

        expect(mockMutationFn).toHaveBeenCalledWith({ heatId: 1 });
    });

    it('renders round summary when provided', () => {
        const mockSummary = {
            isReady: true,
            requiresAdvancement: true,
            alreadyAdvanced: false,
            advancingRacers: [
                { racerId: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racingGroupName: 'Lions', score: 3.5, rank: 1, isAdvancing: true }
            ],
            source: 'ALL',
            numRacers: 1,
            fromBottom: false,
            fieldIsStale: false,
            contestedCut: false,
            fieldIsPinned: false
        };

        render(
            <RaceExecution
                {...defaultProps}
                roundSummary={mockSummary}
            />
        );

        const modal = screen.getByTestId('mock-modal');
        expect(within(modal).getByText('Round Complete!')).toBeInTheDocument();
        expect(within(modal).getByText('Top 1 racers advance to the next round.')).toBeInTheDocument();
    });

    it('offers to take a break from the round summary (#592)', async () => {
        const mockSummary = {
            isReady: true,
            requiresAdvancement: true,
            alreadyAdvanced: false,
            roundId: 2,
            advancingRacers: [
                { racerId: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racingGroupName: 'Lions', score: 3.5, rank: 1, isAdvancing: true }
            ],
            source: 'ALL',
            numRacers: 1,
            fromBottom: false,
            fieldIsStale: false,
            contestedCut: false,
            fieldIsPinned: false
        };

        render(
            <RaceExecution
                {...defaultProps}
                roundSummary={mockSummary}
            />
        );

        const modal = screen.getByTestId('mock-modal');
        fireEvent.click(within(modal).getByTestId('round-summary-break-600'));

        expect(mockMutationFn).toHaveBeenCalledWith({
            raceId: defaultProps.raceId,
            durationSeconds: 600,
            label: null,
        });
    });

    it('says who is advancing from, in the built-in words (#532)', () => {
        // ALL reads "the whole pack" and EACH_GROUP reads "each den" — never
        // "each racing group", the internal source vocabulary leaking to the
        // operator.
        const summaryFor = (source: string) => ({
            isReady: true,
            requiresAdvancement: true,
            alreadyAdvanced: false,
            advancingRacers: [],
            source,
            numRacers: 1,
            fromBottom: false,
            fieldIsStale: false,
            contestedCut: false,
            fieldIsPinned: false
        });

        const { rerender } = render(
            <RaceExecution {...defaultProps} roundSummary={summaryFor('ALL')} />
        );
        expect(within(screen.getByTestId('mock-modal')).getByText('Advancing from the whole pack')).toBeInTheDocument();

        rerender(<RaceExecution {...defaultProps} roundSummary={summaryFor('EACH_GROUP')} />);
        expect(within(screen.getByTestId('mock-modal')).getByText('Advancing from each den')).toBeInTheDocument();

        rerender(<RaceExecution {...defaultProps} roundSummary={summaryFor('ROUND:4')} />);
        expect(within(screen.getByTestId('mock-modal')).getByText('Advancing from an earlier round')).toBeInTheDocument();
    });

    it('phrases who is advancing from in a race\'s overridden terminology (#532)', () => {
        const mockSummary = {
            isReady: true,
            requiresAdvancement: true,
            alreadyAdvanced: false,
            advancingRacers: [],
            source: 'EACH_GROUP',
            numRacers: 1,
            fromBottom: false,
            fieldIsStale: false,
            contestedCut: false,
            fieldIsPinned: false
        };

        render(
            <TerminologyProvider
                value={{
                    racingGroupSingular: 'Patrol',
                    racingGroupPlural: 'Patrols',
                    organizationSingular: 'Troop',
                    organizationPlural: 'Troops',
                    vehicleSingular: 'Car',
                    vehiclePlural: 'Cars',
                    vehicleArtworkKey: 'car',
                }}
            >
                <RaceExecution {...defaultProps} roundSummary={mockSummary} />
            </TerminologyProvider>
        );

        expect(within(screen.getByTestId('mock-modal')).getByText('Advancing from each patrol')).toBeInTheDocument();
        expect(within(screen.getByTestId('mock-modal')).queryByText(/each den/i)).toBeNull();
    });

    it('uses the shared rank rather than renumbering ties in the Round Complete table (#329)', () => {
        // #226: a tie shares a rank (1, 1, 3). The screen used to number rows
        // 1, 2, 3 by position, which contradicts the operator's own Standings
        // page and the audience display for a tie the operator settled with
        // a race-off.
        const mockSummary = {
            isReady: true,
            requiresAdvancement: false,
            alreadyAdvanced: false,
            advancingRacers: [
                { racerId: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racingGroupName: 'Lions', score: 3.5, rank: 1, isAdvancing: true },
                { racerId: 102, firstName: 'Jane', lastName: 'Roe', carNumber: 2, racingGroupName: 'Lions', score: 3.5, rank: 1, isAdvancing: true },
                { racerId: 103, firstName: 'Sam', lastName: 'Poe', carNumber: 3, racingGroupName: 'Lions', score: 4.0, rank: 3, isAdvancing: false },
            ],
            source: 'ALL',
            numRacers: 3,
            fromBottom: false,
            fieldIsStale: false,
            contestedCut: false,
            fieldIsPinned: false
        };

        render(
            <RaceExecution
                {...defaultProps}
                roundSummary={mockSummary}
            />
        );

        const modal = screen.getByTestId('mock-modal');
        const johnRow = within(modal).getByText('John Doe').closest('tr');
        const janeRow = within(modal).getByText('Jane Roe').closest('tr');
        const samRow = within(modal).getByText('Sam Poe').closest('tr');
        expect(within(johnRow!).getByText('1')).toBeInTheDocument();
        expect(within(janeRow!).getByText('1')).toBeInTheDocument();
        expect(within(samRow!).getByText('3')).toBeInTheDocument();
    });

    it('says the slowest cars race next when the round feeds a Slowest Race bracket', () => {
        const mockSummary = {
            isReady: true,
            requiresAdvancement: true,
            alreadyAdvanced: false,
            advancingRacers: [
                { racerId: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racingGroupName: 'Lions', score: 3.5, rank: 1, isAdvancing: true }
            ],
            source: 'ALL',
            numRacers: 3,
            fromBottom: true,
            fieldIsStale: false,
            contestedCut: false,
            fieldIsPinned: false
        };

        render(
            <RaceExecution
                {...defaultProps}
                roundSummary={mockSummary}
            />
        );

        const modal = screen.getByTestId('mock-modal');
        expect(within(modal).getByText('The 3 slowest cars race in the next round.')).toBeInTheDocument();
    });

    it('asks for the Slowest label for a slot inside a Slowest Race round', () => {
        // The wording lives in RaceControl's getRacerName; what this screen
        // owns is passing the direction along with the slot.
        render(
            <RaceExecution
                {...defaultProps}
                nextExecutionHeat={{
                    ...mockHeat,
                    id: 2,
                    lanes: [lane({ lane: 1, placeholderSlot: 2 })],
                }}
                slowestRoundIds={new Set([mockHeat.roundId])}
            />
        );
        expect(mockGetRacerName).toHaveBeenCalledWith(-2, true);
    });

    it('renders round progress and remaining heats correctly', () => {
        render(
            <RaceExecution
                {...defaultProps}
                nextExecutionHeat={{ ...mockHeat, id: 2, heatNumber: 2 }}
                totalHeatsInRound={10}
                remainingHeatsInRound={4}
            />
        );

        expect(screen.getByText('Round Progress')).toBeInTheDocument();
        expect(screen.getByText('6 of 10 Heats Completed')).toBeInTheDocument();
        expect(screen.getByText('4 Heats Remaining')).toBeInTheDocument();
    });

    it('renders upcoming rounds when provided', () => {
        const mockUpcomingRounds = [
            { roundNumber: 2, roundName: "Finals", totalHeats: 1 }
        ];
        render(
            <RaceExecution
                {...defaultProps}
                upcomingRounds={mockUpcomingRounds}
            />
        );

        expect(screen.getByText('Upcoming Rounds')).toBeInTheDocument();
        expect(screen.getByText('Finals')).toBeInTheDocument();
        expect(screen.getByText('1 Heat Scheduled')).toBeInTheDocument();
    });

    it('shows "End of Round" in On Deck when next heat is in a different round', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{ ...mockHeat, roundId: 1 }}
                nextExecutionHeat={{ ...mockHeat, id: 2, heatNumber: 1, roundId: 2, roundNumber: 2, roundName: null }}
            />
        );

        expect(screen.getByText('End of Round')).toBeInTheDocument();
        expect(screen.getByText(/Next: Round 2/)).toBeInTheDocument();
    });

    it('shows the next heat\'s line-up across rounds under a master running order (#549)', () => {
        // The next heat is usually another round's when the race runs one
        // interleaved sequence — announcing "End of Round" between every
        // heat would hide exactly the staging information the interleave
        // exists to provide.
        render(
            <RaceExecution
                {...defaultProps}
                masterRunningOrder={true}
                activeExecutionHeat={{ ...mockHeat, roundId: 1 }}
                nextExecutionHeat={{
                    ...mockHeat,
                    id: 2,
                    heatNumber: 7,
                    roundId: 2,
                    roundNumber: 2,
                    roundName: 'Tigers',
                    lanes: [lane({ lane: 1, racerId: 102 })],
                }}
            />
        );

        expect(screen.queryByText('End of Round')).not.toBeInTheDocument();
        expect(screen.getByText('Heat 7')).toBeInTheDocument();
        expect(screen.getByText('Tigers')).toBeInTheDocument();
        // Once in the active heat's lanes, and again in the on-deck line-up.
        expect(screen.getAllByText('Jane Smith')).toHaveLength(2);
    });

    it('shows racer portraits in On Deck, not car photos (#608)', () => {
        // The current heat's lanes have always shown the racer's own
        // portrait (falling back to initials); On Deck used to show the
        // car photo instead (falling back to a car-number roundel), so the
        // same heat read as a column of faces beside a column of cars. A
        // racer with a car photo but no racer photo is the sharpest case:
        // the old On Deck would have shown the car photo it did have, and
        // the fixed version must show the initials fallback instead.
        const racersWithCarPhotoOnly = {
            ...mockRacers,
            103: { id: 103, firstName: 'Amy', lastName: 'Lee', carNumber: 3, racerImageUrl: null, carImageUrl: 'http://example.com/car103.jpg', carPassedInspection: true },
        };
        render(
            <RaceExecution
                {...defaultProps}
                racers={racersWithCarPhotoOnly}
                activeExecutionHeat={{ ...mockHeat, roundId: 1 }}
                nextExecutionHeat={{
                    ...mockHeat,
                    id: 2,
                    heatNumber: 2,
                    roundId: 1,
                    lanes: [lane({ lane: 1, racerId: 103 })],
                }}
            />
        );

        // No car photo anywhere in On Deck, and no roundel — the initials
        // fallback (RacerAvatar's own empty state) stands in for it.
        expect(screen.queryByAltText(/Amy Lee|#3/)).not.toBeInTheDocument();
        expect(document.querySelector('img[src="http://example.com/car103.jpg"]')).not.toBeInTheDocument();
        expect(screen.getByTitle('Amy Lee')).toHaveTextContent('AL');
    });

    it('renders "Round Not Ready" when heat has placeholders', () => {
        const placeholderHeat: Heat = {
            id: 2,
            roundNumber: 2,
            roundId: 2,
            heatNumber: 1,
            roundName: "Finals",
            recordedAt: null,
            lanes: [lane({ lane: 1, placeholderSlot: 1 })],
        };

        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={placeholderHeat}
            />
        );

        expect(screen.getByText('Round Not Ready')).toBeInTheDocument();
        expect(screen.getByText(/The racers for/)).toBeInTheDocument();
        expect(screen.getByText('Finals')).toBeInTheDocument();
        // Should NOT call prepareHeat
        expect(mockMutationFn).not.toHaveBeenCalled();
    });

    it('does NOT call prepareHeat if heat is already completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockHeat} // mockHeat is completed
            />
        );

        expect(mockMutationFn).not.toHaveBeenCalled();
    });

    it('calls prepareHeat when heatId changes to a new, uncompleted heat', () => {
        const { rerender } = render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockHeat} // mockHeat is completed
            />
        );

        expect(mockMutationFn).not.toHaveBeenCalled();

        const uncompletedHeat: Heat = {
            ...mockHeat,
            id: 2,
            heatNumber: 2,
            lanes: [lane({ lane: 1, racerId: 101 })]
        };

        rerender(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={uncompletedHeat}
            />
        );

        expect(mockMutationFn).toHaveBeenCalledWith({ heatId: 2 });
    });

    it('calls prepareHeat when results are cleared (re-run) for the same heatId', () => {
        const { rerender } = render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockHeat} // mockHeat is completed
            />
        );

        expect(mockMutationFn).not.toHaveBeenCalled();

        const clearedHeat: Heat = {
            ...mockHeat,
            lanes: [lane({ lane: 1, racerId: 101 })]
        };

        rerender(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={clearedHeat}
            />
        );

        expect(mockMutationFn).toHaveBeenCalledWith({ heatId: 1 });
    });

    /**
     * The wiring only (#13). What the machine *decides* is covered in
     * `raceFlow.test.ts` without rendering; these check that the component
     * feeds it the right observation and performs what comes back.
     */
    describe('the race-day flow comes from one machine (#13)', () => {
        // A recorded heat with somewhere to go, which is the countdown's
        // precondition. `mockHeat` already holds times.
        const withNextHeat = {
            ...defaultProps,
            autoAdvanceHeat: true,
            nextExecutionHeat: { ...mockHeat, id: 2, heatNumber: 2 },
        };

        it('counts down on the Next Heat button when auto-advance is on', () => {
            render(<RaceExecution {...withNextHeat} />);
            expect(screen.getByText(/Next Heat \(10s\)/)).toBeInTheDocument();
        });

        it('does not count down when auto-advance is off', () => {
            render(<RaceExecution {...withNextHeat} autoAdvanceHeat={false} />);
            expect(screen.getByText(/Next Heat/)).toBeInTheDocument();
            expect(screen.queryByText(/Next Heat \(\d+s\)/)).not.toBeInTheDocument();
        });

        it('advances when the countdown runs out', () => {
            vi.useFakeTimers();
            try {
                render(<RaceExecution {...withNextHeat} />);
                expect(mockOnNextHeat).not.toHaveBeenCalled();
                vi.advanceTimersByTime(10_000);
                expect(mockOnNextHeat).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('calling the countdown off keeps it off', () => {
            // The regression this guards: cancelling changes nothing the server
            // can see, so a machine that re-decided purely from the observation
            // would start counting again on the very next payload. The old code
            // avoided it by accident — its effect was keyed on a boolean that
            // cancelling did not touch.
            vi.useFakeTimers();
            try {
                const { rerender } = render(<RaceExecution {...withNextHeat} />);
                fireEvent.click(screen.getByText('Cancel'));
                expect(screen.queryByText(/Next Heat \(\d+s\)/)).not.toBeInTheDocument();

                rerender(<RaceExecution {...withNextHeat} />);
                vi.advanceTimersByTime(30_000);

                expect(screen.queryByText(/Next Heat \(\d+s\)/)).not.toBeInTheDocument();
                expect(mockOnNextHeat).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it('does not advance past the last heat of a round', () => {
            // Not observable through the button — with no next heat the button
            // is not rendered at all — but very observable through whether the
            // race moves on by itself. Without this, the component could pass a
            // constant `hasNextHeat` and nothing would notice.
            vi.useFakeTimers();
            try {
                render(<RaceExecution {...withNextHeat} nextExecutionHeat={null} />);
                vi.advanceTimersByTime(30_000);
                expect(mockOnNextHeat).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it('a skipped heat is not held behind the countdown', () => {
            // Skipped heats advance through their own handler. RECORDED with no
            // times is the shape, so the countdown must read the times rather
            // than the phase.
            const skipped: Heat = {
                ...mockHeat,
                lanes: [
                    lane({ lane: 1, racerId: 101, skipped: true }),
                    lane({ lane: 2, racerId: 102, skipped: true }),
                ],
            };
            vi.useFakeTimers();
            try {
                render(<RaceExecution {...withNextHeat} activeExecutionHeat={skipped} />);
                expect(screen.queryByText(/Next Heat \(\d+s\)/)).not.toBeInTheDocument();
                vi.advanceTimersByTime(30_000);
                expect(mockOnNextHeat).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it('a round summary suppresses the countdown', () => {
            render(
                <RaceExecution
                    {...withNextHeat}
                    roundSummary={{
                        isReady: true,
                        requiresAdvancement: true,
                        alreadyAdvanced: false,
                        advancingRacers: [],
                        source: 'ALL',
                        numRacers: 0,
                        roundId: 1,
                    } as any}
                />
            );
            expect(screen.queryByText(/Next Heat \(\d+s\)/)).not.toBeInTheDocument();
        });
    });

    describe('skipping a heat', () => {
        // #346: this used to go through window.confirm, the one dialog
        // outside the app's own convention.
        function renderRunningHeat() {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RUNNING',
                timerState: 'RUNNING',
                lanes: [liveLane({ lane: 1, racerId: 101 })],
            });
            render(
                <RaceExecution
                    {...defaultProps}
                    activeExecutionHeat={{ ...mockHeat, lanes: [lane({ lane: 1, racerId: 101 })] }}
                />
            );
        }

        it('asks through the app\'s own confirm dialog, never window.confirm', async () => {
            const windowConfirm = vi.spyOn(window, 'confirm');
            mockShowConfirm.mockResolvedValue(true);
            renderRunningHeat();

            fireEvent.click(screen.getByText('Skip Heat'));

            await waitFor(() => expect(mockOnUpdateResult).toHaveBeenCalled());
            expect(mockShowConfirm).toHaveBeenCalledWith(
                expect.stringMatching(/skip this heat/i),
                expect.any(String),
                expect.any(String),
                'danger',
            );
            expect(windowConfirm).not.toHaveBeenCalled();
        });

        it('records nothing when the operator declines', async () => {
            mockShowConfirm.mockResolvedValue(false);
            renderRunningHeat();

            fireEvent.click(screen.getByText('Skip Heat'));

            await waitFor(() => expect(mockShowConfirm).toHaveBeenCalled());
            expect(mockOnUpdateResult).not.toHaveBeenCalled();
            expect(mockOnNextHeat).not.toHaveBeenCalled();
        });

        // #765: the screen used to call `onNextHeat()` *before* awaiting the
        // save ("Move UI forward IMMEDIATELY to prevent 'flash back' race
        // conditions"), so a slow or refused save left the operator on the
        // next heat while the old one was never actually marked skipped.
        // `raceDay.spec.ts`'s skipped-heat e2e test had to be changed to poll
        // the server before navigating for exactly this reason — the fix
        // here is to not move on until the server holds the skip, so that
        // workaround becomes redundant rather than load-bearing.
        it('does not advance to the next heat until the server holds the skip (#765)', async () => {
            let resolveUpdate: (success: boolean) => void = () => {};
            mockOnUpdateResult.mockImplementation(
                () => new Promise<boolean>((resolve) => { resolveUpdate = resolve; }),
            );
            renderRunningHeat();

            fireEvent.click(screen.getByText('Skip Heat'));
            await waitFor(() => expect(mockOnUpdateResult).toHaveBeenCalled());

            // The save is still in flight — the screen must not have moved on,
            // and the timer must not have been released, yet.
            expect(mockOnNextHeat).not.toHaveBeenCalled();
            expect(mockMutationFn).not.toHaveBeenCalledWith({ trackId: 1 });

            resolveUpdate(true);

            await waitFor(() => expect(mockOnNextHeat).toHaveBeenCalledTimes(1));
            expect(mockMutationFn).toHaveBeenCalledWith({ trackId: 1 });
        });

        it('stays on the heat and does not release the timer when the skip is refused (#765)', async () => {
            mockOnUpdateResult.mockResolvedValue(false);
            renderRunningHeat();

            fireEvent.click(screen.getByText('Skip Heat'));

            await waitFor(() => expect(mockOnUpdateResult).toHaveBeenCalled());
            // `handleUpdateResult` already alerted; the screen must not act as
            // though the skip landed.
            expect(mockOnNextHeat).not.toHaveBeenCalled();
            expect(mockMutationFn).not.toHaveBeenCalledWith({ trackId: 1 });
        });

        // Same gap as the Edit/Override modal's own rejection test above: the
        // contract is that `onUpdateResult` resolves `false` rather than
        // rejects (#765), and nothing here ever exercised a genuine
        // rejection. Before RaceExecution.tsx caught this itself, a
        // rejection was a real uncaught rejection — the heat was left
        // dangling, unmarked as skipped, with nothing said and the timer
        // never released.
        it('stays on the heat and alerts, rather than crashing, when the skip rejects', async () => {
            mockOnUpdateResult.mockRejectedValue(new Error('boom'));
            renderRunningHeat();

            fireEvent.click(screen.getByText('Skip Heat'));

            await waitFor(() => expect(mockOnUpdateResult).toHaveBeenCalled());
            await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());

            expect(mockOnNextHeat).not.toHaveBeenCalled();
            expect(mockMutationFn).not.toHaveBeenCalledWith({ trackId: 1 });
        });
    });

    // #765: `prepareHeat` is fired from the auto-prepare command in
    // `raceFlow.ts` and from the "Reset Heat" button with no check of
    // `result.error` or a `false` return (the #337 refusal, "a different
    // heat is RUNNING", or any device fault). The operator was left at
    // "Waiting for Timer…" indefinitely with nothing said. `RunOffControl.tsx`'s
    // `handlePrepare` already checks both; these bring RaceExecution in line.
    describe('a failed prepareHeat is not ignored (#765)', () => {
        it('alerts when the automatic arming of the next heat is refused', async () => {
            mockMutationFn.mockResolvedValue({ data: { prepareHeat: false } });
            render(
                <RaceExecution
                    {...defaultProps}
                    activeExecutionHeat={{ ...mockHeat, lanes: [lane({ lane: 1, racerId: 101 })] }}
                />
            );

            await waitFor(() => expect(mockMutationFn).toHaveBeenCalledWith({ heatId: 1 }));
            await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());
        });

        it('alerts when Reset Heat fails to re-arm the timer', async () => {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RUNNING',
                timerState: 'RUNNING',
                lanes: [liveLane({ lane: 1, racerId: 101 })],
            });
            mockMutationFn.mockResolvedValue({ error: new Error('boom') });
            render(
                <RaceExecution
                    {...defaultProps}
                    activeExecutionHeat={{ ...mockHeat, lanes: [lane({ lane: 1, racerId: 101 })] }}
                />
            );

            fireEvent.click(screen.getByText('Reset Heat'));

            await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());
        });
    });

    it('renders with race-execution-layout class for responsive single-column collapse (#782)', () => {
        const { container } = render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{ ...mockHeat, lanes: [lane({ lane: 1, racerId: 101 })] }}
            />
        );

        const layout = container.querySelector('.race-execution-layout');
        expect(layout).toBeInTheDocument();
        expect(container.querySelector('.race-execution-active-card')).toBeInTheDocument();
    });

    describe('the race summary (#847)', () => {
        // The dead end #847 reports: the last heat lands and nothing on
        // screen points at standings, awards or printing. `raceJustCompleted`
        // is the sticky, edge-detected flag `RaceControl.tsx` computes via
        // `raceCompletion.ts` — the same shape `roundSummary` already uses,
        // one level up (a whole race rather than one round).
        it('offers routes to standings, awards and printing when the race finishes', () => {
            render(
                <MemoryRouter>
                    <RaceExecution {...defaultProps} raceId={7} raceJustCompleted />
                </MemoryRouter>
            );

            const modal = screen.getByTestId('mock-modal');
            expect(within(modal).getByText('Race Complete!')).toBeInTheDocument();

            expect(within(modal).getByRole('link', { name: /standings/i })).toHaveAttribute(
                'href',
                '/race/7/standings',
            );
            expect(within(modal).getByRole('link', { name: /awards/i })).toHaveAttribute(
                'href',
                '/race/7/awards',
            );
            expect(within(modal).getByRole('link', { name: /print/i })).toHaveAttribute(
                'href',
                '/race/7/print/results',
            );
        });

        it('says nothing when the race has not just finished', () => {
            // The On Deck panel's own unrelated "Race Complete!" line (when
            // there is no next heat) stays untouched — this is about the
            // modal, found by its own body text rather than that shared
            // title string.
            render(
                <MemoryRouter>
                    <RaceExecution {...defaultProps} raceJustCompleted={false} />
                </MemoryRouter>
            );

            expect(screen.queryByTestId('mock-modal')).not.toBeInTheDocument();
        });

        it('can be dismissed', () => {
            render(
                <MemoryRouter>
                    <RaceExecution {...defaultProps} raceJustCompleted />
                </MemoryRouter>
            );

            const modal = screen.getByTestId('mock-modal');
            fireEvent.click(within(modal).getByText('Close Mock'));

            expect(screen.queryByTestId('mock-modal')).not.toBeInTheDocument();
        });

        // #874: "every heat that exists has run" is not "the race is over"
        // for a schedule with no round drawn from another round's standings
        // yet — see `hasChampionshipRound`'s own docstring in
        // `raceCompletion.ts` for why this is a wording change rather than a
        // suppressed trigger.
        it('softens the wording and offers to add a championship round when none exists yet', () => {
            render(
                <MemoryRouter>
                    <RaceExecution
                        {...defaultProps}
                        raceId={7}
                        raceJustCompleted
                        hasChampionshipRound={false}
                    />
                </MemoryRouter>
            );

            const modal = screen.getByTestId('mock-modal');
            expect(within(modal).getByText('No More Heats Scheduled')).toBeInTheDocument();
            expect(within(modal).queryByText('Race Complete!')).not.toBeInTheDocument();

            const addRound = within(modal).getByRole('link', { name: /Add a Championship Round/i });
            expect(addRound).toHaveAttribute('href', '/race/7/control');

            // The standings link is still offered — a prelims-only race
            // really is done here, and this modal cannot tell the two apart.
            expect(within(modal).getByRole('link', { name: /standings/i })).toHaveAttribute(
                'href',
                '/race/7/standings',
            );
        });

        it('does not offer to add a championship round once one already exists', () => {
            // The default — `hasChampionshipRound` defaults to `true`, the
            // same "don't second-guess a caller that has not supplied one"
            // shape `raceJustCompleted` uses.
            render(
                <MemoryRouter>
                    <RaceExecution {...defaultProps} raceId={7} raceJustCompleted />
                </MemoryRouter>
            );

            const modal = screen.getByTestId('mock-modal');
            expect(within(modal).getByText('Race Complete!')).toBeInTheDocument();
            expect(
                within(modal).queryByRole('link', { name: /Add a Championship Round/i }),
            ).not.toBeInTheDocument();
        });
    });

    it('docks the fake timer mole directly under the lane list (#783, #940)', () => {
        // It used to sit at the foot of the right-column sidebar, under
        // Upcoming Rounds — the docs said "below the current heat" while the
        // screen put it somewhere else entirely (#940). It belongs in the
        // active heat card now, not the On Deck column.
        const { getByTestId, queryByTestId, rerender } = render(
            <RaceExecution
                {...defaultProps}
                timerType="FAKE"
                activeExecutionHeat={{ ...mockHeat, lanes: [lane({ lane: 1, racerId: 101 })] }}
            />
        );

        const activeCard = getByTestId('race-execution-active-card');
        const rightCol = getByTestId('race-execution-right-column');
        const mole = getByTestId('fake-timer-mole');
        expect(activeCard).toContainElement(mole);
        expect(rightCol).not.toContainElement(mole);
        expect(mole).toHaveAttribute('data-docked', 'true');

        rerender(
            <RaceExecution
                {...defaultProps}
                timerType="NONE"
                activeExecutionHeat={{ ...mockHeat, lanes: [lane({ lane: 1, racerId: 101 })] }}
            />
        );
        expect(queryByTestId('fake-timer-mole')).not.toBeInTheDocument();
    });
});

