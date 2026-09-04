import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import IntermissionOverlay from './IntermissionOverlay';

const running = {
  active: true,
  remainingSeconds: 272,
  paused: false,
  label: 'Snack break',
  endsAt: new Date(Date.now() + 272_000).toISOString(),
};

describe('IntermissionOverlay', () => {
  it('shows the label and a formatted countdown', () => {
    render(<IntermissionOverlay intermission={running} />);

    expect(screen.getByTestId('intermission-label')).toHaveTextContent('Snack break');
    expect(screen.getByTestId('intermission-overlay-countdown')).toHaveTextContent('4:3');
  });

  it('falls back to a generic label when none was given', () => {
    render(<IntermissionOverlay intermission={{ ...running, label: null }} />);
    expect(screen.getByTestId('intermission-label')).toHaveTextContent('Intermission');
  });

  it('says Paused when the break is paused', () => {
    render(<IntermissionOverlay intermission={{ ...running, paused: true }} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('does not say Paused while running', () => {
    render(<IntermissionOverlay intermission={running} />);
    expect(screen.queryByText('Paused')).toBeNull();
  });

  it('shows a faint preview of who races next', () => {
    render(
      <IntermissionOverlay
        intermission={running}
        nextUpRacers={[{ lane: 1, firstName: 'Jordan', lastName: 'Mitchell', carNumber: 7 }]}
        nextUpInfo="Round 2, Heat 5"
        vehicleLabel="Car"
      />,
    );

    expect(screen.getByText('Jordan Mitchell')).toBeInTheDocument();
    expect(screen.getByText('Car #7')).toBeInTheDocument();
    expect(screen.getByText(/Up next: Round 2, Heat 5/)).toBeInTheDocument();
  });

  it('renders no preview when nothing is queued', () => {
    render(<IntermissionOverlay intermission={running} nextUpRacers={[]} />);
    expect(screen.queryByText(/Up next/)).toBeNull();
  });
});
