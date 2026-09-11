import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { WhichCarsRaceFields } from './WhichCarsRaceFields';

describe('WhichCarsRaceFields', () => {
  const defaultProps = {
    fromBottom: false,
    onChooseDirection: vi.fn(),
    labelStyle: {},
    mutedColor: 'var(--text-muted-color)',
  };

  it('defaults to the fastest cars, with no helper text', () => {
    render(<WhichCarsRaceFields {...defaultProps} />);
    expect(screen.getByLabelText('The fastest cars')).toBeChecked();
    expect(screen.queryByText(/just-for-fun race/)).not.toBeInTheDocument();
  });

  it('reports the chosen direction', () => {
    const onChooseDirection = vi.fn();
    render(<WhichCarsRaceFields {...defaultProps} onChooseDirection={onChooseDirection} />);
    fireEvent.click(screen.getByLabelText('The slowest cars'));
    expect(onChooseDirection).toHaveBeenCalledWith(true);
  });

  it('explains the slowest direction once chosen', () => {
    render(<WhichCarsRaceFields {...defaultProps} fromBottom />);
    expect(screen.getByLabelText('The slowest cars')).toBeChecked();
    expect(
      screen.getByText('A just-for-fun race for the slowest cars. Cars without a recorded time are left out.')
    ).toBeInTheDocument();
  });
});
