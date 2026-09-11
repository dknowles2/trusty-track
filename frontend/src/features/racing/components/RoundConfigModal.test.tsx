import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { RoundConfigModal } from './RoundConfigModal';

vi.mock('../../../components/ui/Modal', () => ({
  default: ({ isOpen, children, title }: any) =>
    isOpen ? (
      <div data-testid="mock-modal">
        <h1>{title}</h1>
        {children}
      </div>
    ) : null,
}));

describe('RoundConfigModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(undefined),
    racerCount: 12,
    racingGroupCount: 3,
    laneCount: 4,
    championshipTrophies: 3,
    hasGeneralRound: true,
    lastChampionshipRound: null,
  };

  const openChampionshipTab = () => {
    fireEvent.click(screen.getByText('Championship Round'));
  };

  it('a championship round defaults to the fastest cars', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);
    openChampionshipTab();

    fireEvent.click(screen.getByText('Add round'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      advancementSource: 'ALL',
      advancementFromBottom: false,
    });
  });

  it('choosing the slowest cars submits the direction and renames the round', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);
    openChampionshipTab();

    fireEvent.click(screen.getByLabelText('The slowest cars'));

    // The default name follows the direction, so the schedule says what the
    // round is without the operator typing anything.
    expect(screen.getByDisplayValue('Slowest Race')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Add round'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Slowest Race',
      advancementSource: 'ALL',
      advancementFromBottom: true,
    });
  });

  it('a name the operator typed survives a direction change', () => {
    render(<RoundConfigModal {...defaultProps} />);
    openChampionshipTab();

    fireEvent.change(screen.getByLabelText('Round Name'), {
      target: { value: 'Turtle Trophy' },
    });
    fireEvent.click(screen.getByLabelText('The slowest cars'));

    expect(screen.getByDisplayValue('Turtle Trophy')).toBeInTheDocument();
  });

  it('an elimination round submits the strategy, the losses, and its name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByLabelText("Elimination — lose too many heats and you're out"));
    expect(screen.getByDisplayValue('Elimination Round')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Losses before a car is out'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByText('Add round'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Elimination Round',
      schedulingStrategy: 'ELIMINATION',
      eliminationLosses: 2,
    });
    expect(onSubmit.mock.calls[0][0].generalType).toBeUndefined();
  });

  it('keeps a space between the word the terminology resolves to and the word after it (#947)', () => {
    // A JSX line break between {vehiclesLower} and the text that followed
    // it used to drop the space entirely — "matching carswith the same
    // record" — because a wrapped-text node's leading whitespace is trimmed
    // by JSX itself. Regression test for that, not for the words either
    // side of the space.
    render(<RoundConfigModal {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Elimination — lose too many heats and you're out"));
    expect(
      screen.getByText('New heats appear after each round of racing, matching cars with the same record. The last car left wins.')
    ).toBeInTheDocument();
  });

  it('a balanced round submits the strategy and its phase count', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.click(
      screen.getByLabelText('Balanced — each round of heats matches cars doing about as well')
    );
    expect(screen.getByDisplayValue('Balanced Round')).toBeInTheDocument();
    // Defaults to one phase per lane.
    expect(
      (screen.getByLabelText('Times each car races') as HTMLInputElement).value
    ).toBe('4');

    fireEvent.change(screen.getByLabelText('Times each car races'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByText('Add round'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Balanced Round',
      schedulingStrategy: 'BALANCED',
      balancedPhases: 5,
    });
    expect(onSubmit.mock.calls[0][0].generalType).toBeUndefined();
    expect(onSubmit.mock.calls[0][0].eliminationLosses).toBeUndefined();
  });

  it('an ordinary general round still submits PPC', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('Add round'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      schedulingStrategy: 'PPC',
      generalType: 'ALL',
    });
    expect(onSubmit.mock.calls[0][0].eliminationLosses).toBeUndefined();
  });

  it('the submit button counts the rounds "By Den" is about to create (#947)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} racingGroupCount={3} />);

    expect(screen.getByText('Add round')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/By Den/));
    expect(screen.getByText('Will create 3 rounds (one per den).')).toBeInTheDocument();
    expect(screen.queryByText('Add round')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Add rounds'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      schedulingStrategy: 'PPC',
      generalType: 'EACH_GROUP',
    });
  });

  it('reopening after the general round is deleted shows the General tab, not stale championship fields', async () => {
    // The modal stays mounted across a close, so its `type` state survives
    // — a general round deleted while it was closed must not leave the
    // Championship form showing under a General-highlighted tab on reopen.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);
    openChampionshipTab();
    expect(screen.getByLabelText('Number to pick')).toBeInTheDocument();

    // Close, delete the general round, and reopen.
    rerender(
      <RoundConfigModal {...defaultProps} onSubmit={onSubmit} isOpen={false} />
    );
    rerender(
      <RoundConfigModal
        {...defaultProps}
        onSubmit={onSubmit}
        isOpen={false}
        hasGeneralRound={false}
      />
    );
    rerender(
      <RoundConfigModal
        {...defaultProps}
        onSubmit={onSubmit}
        isOpen={true}
        hasGeneralRound={false}
      />
    );

    // The General tab is showing, and so is its form — not the
    // championship-only "Number to pick" field.
    expect(
      screen.getByLabelText('Everyone races in every lane')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Number to pick')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Add round'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      schedulingStrategy: 'PPC',
      generalType: 'ALL',
      advancementSource: undefined,
    });
  });

  it('checking "I\'ll choose who races myself" submits pickFieldByHand (#711)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);
    openChampionshipTab();

    fireEvent.click(screen.getByLabelText(/I'll choose who races myself/));
    fireEvent.click(screen.getByText('Add round'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      advancementSource: 'ALL',
      pickFieldByHand: true,
    });
  });

  it('leaving the checkbox unchecked submits pickFieldByHand as false', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);
    openChampionshipTab();

    fireEvent.click(screen.getByText('Add round'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].pickFieldByHand).toBe(false);
  });

  it('the checkbox is not offered for a general round', () => {
    // A general round's field is the roster, not a pick — `pinRoundField`
    // refuses one, so this screen never offers the checkbox for it.
    render(<RoundConfigModal {...defaultProps} />);
    expect(
      screen.queryByLabelText(/I'll choose who races myself/)
    ).not.toBeInTheDocument();
  });

  it('the checkbox resets to unchecked on a close-and-reopen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} />);
    openChampionshipTab();
    fireEvent.click(screen.getByLabelText(/I'll choose who races myself/));
    expect(screen.getByLabelText(/I'll choose who races myself/)).toBeChecked();

    rerender(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} isOpen={false} />);
    rerender(<RoundConfigModal {...defaultProps} onSubmit={onSubmit} isOpen={true} />);
    openChampionshipTab();

    expect(screen.getByLabelText(/I'll choose who races myself/)).not.toBeChecked();
  });

  it('the trophy minimum applies only to the fastest direction', () => {
    render(<RoundConfigModal {...defaultProps} />);
    openChampionshipTab();

    // Fastest: the pick count cannot drop below the trophy count.
    const count = screen.getByLabelText('Number to pick') as HTMLInputElement;
    fireEvent.change(count, { target: { value: '1' } });
    expect(count.value).toBe('3');

    // Slowest: a two-car turtle race is a fine turtle race.
    fireEvent.click(screen.getByLabelText('The slowest cars'));
    fireEvent.change(screen.getByLabelText('Number to pick'), {
      target: { value: '2' },
    });
    expect((screen.getByLabelText('Number to pick') as HTMLInputElement).value).toBe('2');
  });

  it('displays a notice explaining why round generation is disabled when fewer than 2 racers are checked in (#784)', () => {
    render(<RoundConfigModal {...defaultProps} racerCount={1} totalRacerCount={5} />);
    expect(screen.getByText(/At least 2 checked-in cars are required to generate heats/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add round' })).toBeDisabled();
  });

  it('displays notice when some registered racers are not checked in (#784)', () => {
    render(<RoundConfigModal {...defaultProps} racerCount={4} totalRacerCount={10} />);
    expect(
      screen.getByText(/4 of 10 cars checked in\. Only checked-in cars are put into heats\./i)
    ).toBeInTheDocument();
  });

  it('disables elimination and balanced options when laneCount is less than 2', () => {
    render(<RoundConfigModal {...defaultProps} laneCount={1} />);
    expect(
      screen.getByLabelText("Elimination — lose too many heats and you're out")
    ).toBeDisabled();
    expect(
      screen.getByLabelText('Balanced — each round of heats matches cars doing about as well')
    ).toBeDisabled();
    expect(
      screen.getByText('Elimination and balanced rounds require at least 2 usable lanes.')
    ).toBeInTheDocument();
  });
});

