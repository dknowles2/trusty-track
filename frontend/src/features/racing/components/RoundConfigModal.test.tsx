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

    fireEvent.click(screen.getByText('Create Round(s) & Generate Heats'));

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

    fireEvent.click(screen.getByText('Create Round(s) & Generate Heats'));

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
    fireEvent.click(screen.getByText('Create Round(s) & Generate Heats'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Elimination Round',
      schedulingStrategy: 'ELIMINATION',
      eliminationLosses: 2,
    });
    expect(onSubmit.mock.calls[0][0].generalType).toBeUndefined();
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
    fireEvent.click(screen.getByText('Create Round(s) & Generate Heats'));

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

    fireEvent.click(screen.getByText('Create Round(s) & Generate Heats'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      schedulingStrategy: 'PPC',
      generalType: 'ALL',
    });
    expect(onSubmit.mock.calls[0][0].eliminationLosses).toBeUndefined();
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

    fireEvent.click(screen.getByText('Create Round(s) & Generate Heats'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      schedulingStrategy: 'PPC',
      generalType: 'ALL',
      advancementSource: undefined,
    });
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
});
