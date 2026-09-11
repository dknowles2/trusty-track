import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { HowItsRacedFields } from './HowItsRacedFields';

describe('HowItsRacedFields', () => {
  const defaultProps = {
    raceStyle: 'PPC' as const,
    onChooseStyle: vi.fn(),
    laneCount: 4,
    balancedPhases: 4,
    onBalancedPhasesChange: vi.fn(),
    eliminationLosses: 3,
    onEliminationLossesChange: vi.fn(),
    labelStyle: {},
    mutedColor: 'var(--text-muted-color)',
  };

  it('shows the three styles, and neither the phases nor losses field until chosen', () => {
    render(<HowItsRacedFields {...defaultProps} />);
    expect(screen.getByLabelText('Everyone races in every lane')).toBeChecked();
    expect(
      screen.getByLabelText("Elimination — lose too many heats and you're out")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Balanced — each round of heats matches cars doing about as well')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Times each car races')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Losses before a car is out')).not.toBeInTheDocument();
  });

  it('reports the chosen style', () => {
    const onChooseStyle = vi.fn();
    render(<HowItsRacedFields {...defaultProps} onChooseStyle={onChooseStyle} />);
    fireEvent.click(
      screen.getByLabelText("Elimination — lose too many heats and you're out")
    );
    expect(onChooseStyle).toHaveBeenCalledWith('ELIMINATION');
  });

  it('shows the phase count once balanced is chosen', () => {
    render(<HowItsRacedFields {...defaultProps} raceStyle="BALANCED" />);
    expect((screen.getByLabelText('Times each car races') as HTMLInputElement).value).toBe('4');
  });

  it('shows the loss count once elimination is chosen', () => {
    render(<HowItsRacedFields {...defaultProps} raceStyle="ELIMINATION" />);
    expect((screen.getByLabelText('Losses before a car is out') as HTMLInputElement).value).toBe('3');
  });

  it('disables elimination and balanced, and explains why, when fewer than 2 lanes are usable', () => {
    render(<HowItsRacedFields {...defaultProps} laneCount={1} />);
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
