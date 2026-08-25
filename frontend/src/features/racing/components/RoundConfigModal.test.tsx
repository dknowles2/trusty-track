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
    denCount: 3,
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
      advancementSource: 'PACK',
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
      advancementSource: 'PACK',
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
