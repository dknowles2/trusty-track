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

describe('highlights mode (#177 stage 3)', () => {
  it('plays the given clip with its caption, and moves the countdown to a corner badge', () => {
    render(
      <IntermissionOverlay
        intermission={running}
        highlightClip={{ url: '/replay/abc.webm', caption: 'Heat 7 · Dash Tire · 3.148 s' }}
      />,
    );

    const video = screen.getByTestId('replay-video');
    expect(video).toHaveAttribute('src', '/replay/abc.webm');
    expect(screen.getByTestId('intermission-highlight-caption')).toHaveTextContent(
      'Heat 7 · Dash Tire · 3.148 s',
    );
    // The countdown is still visible, but in the corner badge rather than
    // the big centered number — the same testid either way, so a caller
    // watching for "still counting down" does not have to know which
    // layout is active.
    expect(screen.getByTestId('intermission-overlay-countdown')).toHaveTextContent('4:3');
    expect(screen.getByTestId('intermission-overlay-countdown-corner')).toBeInTheDocument();
  });

  it('does not render the next-up preview while a clip is playing', () => {
    render(
      <IntermissionOverlay
        intermission={running}
        nextUpRacers={[{ lane: 1, firstName: 'Jordan', lastName: 'Mitchell', carNumber: 7 }]}
        highlightClip={{ url: '/replay/abc.webm', caption: 'Heat 7 · 3.148 s' }}
      />,
    );

    expect(screen.queryByText('Jordan Mitchell')).toBeNull();
  });

  it('falls back to the ordinary layout when there is no clip to show', () => {
    render(<IntermissionOverlay intermission={running} highlightClip={null} />);

    expect(screen.queryByTestId('replay-video')).toBeNull();
    expect(screen.queryByTestId('intermission-overlay-countdown-corner')).toBeNull();
    expect(screen.queryByTestId('intermission-highlight-caption')).toBeNull();
  });

  it('is unchanged when the prop is simply omitted', () => {
    render(<IntermissionOverlay intermission={running} />);

    expect(screen.queryByTestId('replay-video')).toBeNull();
    expect(screen.getByTestId('intermission-overlay-countdown')).toBeInTheDocument();
  });
});
