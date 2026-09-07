import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { Provider } from 'urql';
import { fromValue, never } from 'wonka';
import { TimerStatusBadge } from './TimerStatusBadge';

function renderBadge(state: string, lastError: string | null = null) {
  const client = {
    executeQuery: () => never,
    executeMutation: () => never,
    executeSubscription: () =>
      fromValue({
        data: {
          timerStatus: {
            status: {
              state,
              deviceName: 'Test Timer',
              activeHeatId: 1,
              lastError,
            },
          },
        },
        stale: false,
        hasNext: false,
      }),
  } as unknown as Parameters<typeof Provider>[0]['value'];

  return render(
    <Provider value={client}>
      <TimerStatusBadge trackId={1} />
    </Provider>,
  );
}

describe('TimerStatusBadge', () => {
  it('clarifies that IDLE state represents the timer being ready, not the heat', () => {
    renderBadge('IDLE');
    expect(screen.getByText('Timer: Ready')).toBeInTheDocument();
    expect(screen.queryByText(/^Ready$/)).toBeNull();
  });

  it('clarifies ARMED state as Timer: Staged', () => {
    renderBadge('ARMED');
    expect(screen.getByText('Timer: Staged')).toBeInTheDocument();
  });

  it('clarifies READY state as Timer: Ready to race', () => {
    renderBadge('READY');
    expect(screen.getByText('Timer: Ready to race')).toBeInTheDocument();
  });

  it('clarifies RUNNING state as Timer: Racing…', () => {
    renderBadge('RUNNING');
    expect(screen.getByText('Timer: Racing…')).toBeInTheDocument();
  });

  it('clarifies CONNECTED state as Timer: Connecting…', () => {
    renderBadge('CONNECTED');
    expect(screen.getByText('Timer: Connecting…')).toBeInTheDocument();
  });

  it('clarifies RESULTS_OVERDUE state as Timer: Results overdue', () => {
    renderBadge('RESULTS_OVERDUE');
    expect(screen.getByText('Timer: Results overdue')).toBeInTheDocument();
  });

  it('clarifies DISCONNECTED state as Timer disconnected', () => {
    renderBadge('DISCONNECTED');
    expect(screen.getByText('Timer disconnected')).toBeInTheDocument();
  });

  // #764: FAULT is not the same claim as DISCONNECTED. Since #342, a
  // database write failure lands the manager in FAULT with the port
  // perfectly healthy -- landing an operator on "Timer disconnected" sends
  // them to check a cable that was never the problem.
  it('gives FAULT a distinct label from DISCONNECTED', () => {
    renderBadge('FAULT');
    expect(screen.getByText('Timer: Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Timer disconnected')).toBeNull();
  });

  it('surfaces lastError as the badge title once it is present', () => {
    const { container } = renderBadge(
      'FAULT',
      'Heat 12: results could not be saved (database is locked) — the timer link is fine; enter the times with Override',
    );
    const badge = container.querySelector('.timer-status-badge');
    expect(badge).toHaveAttribute(
      'title',
      'Heat 12: results could not be saved (database is locked) — the timer link is fine; enter the times with Override',
    );
  });

  it('has no title when there is no error to show', () => {
    const { container } = renderBadge('IDLE');
    const badge = container.querySelector('.timer-status-badge');
    expect(badge).not.toHaveAttribute('title');
  });

  // The colour dot is the other half of the state-to-label map operators
  // read at a glance — FAULT and DISCONNECTED share no label (#764) and must
  // not share a colour either, or the glance stops working.
  it('gives FAULT a red dot, distinct from grey DISCONNECTED', () => {
    const { container: fault } = renderBadge('FAULT');
    expect(fault.querySelector('.timer-status-dot--red')).toBeInTheDocument();

    const { container: disconnected } = renderBadge('DISCONNECTED');
    expect(disconnected.querySelector('.timer-status-dot--grey')).toBeInTheDocument();
  });

  it('gives RUNNING a pulsing dot', () => {
    const { container } = renderBadge('RUNNING');
    expect(container.querySelector('.timer-status-dot--pulse')).toBeInTheDocument();
  });

  it('falls back to the disconnected label and dot when no state has arrived yet', () => {
    const client = {
      executeQuery: () => never,
      executeMutation: () => never,
      executeSubscription: () => never,
    } as unknown as Parameters<typeof Provider>[0]['value'];

    const { container } = render(
      <Provider value={client}>
        <TimerStatusBadge trackId={1} />
      </Provider>,
    );

    expect(screen.getByText('Timer disconnected')).toBeInTheDocument();
    expect(container.querySelector('.timer-status-dot--grey')).toBeInTheDocument();
  });
});
