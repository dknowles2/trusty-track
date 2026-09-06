import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { Provider } from 'urql';
import { fromValue, never } from 'wonka';
import { TimerStatusBadge } from './TimerStatusBadge';

function renderBadge(state: string) {
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
              lastError: null,
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
});
