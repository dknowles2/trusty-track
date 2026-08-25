import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DemoSessionGate } from './DemoSessionGate';
import { IDLE_AFTER_MS, SESSION_LIMIT_MS } from '../../../api/demoSession';

const closeLiveConnection = vi.fn();
vi.mock('../../../api/graphqlClient', () => ({
  closeLiveConnection: () => closeLiveConnection(),
}));

/**
 * Roll time forward.
 *
 * `advanceTimersByTime` moves the mocked `Date.now()` as well as firing the
 * interval, so calling `setSystemTime` alongside it advances the clock twice —
 * which is how the first draft of these tests had a five-minute timeout expire
 * after two and a half.
 */
async function waitFor(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('the demo idle gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-14T10:00:00Z'));
    closeLiveConnection.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing at all when the flag is off', async () => {
    render(<DemoSessionGate enabled={false} />);

    await waitFor(SESSION_LIMIT_MS * 2);

    expect(closeLiveConnection).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays out of the way while the session is active', async () => {
    render(<DemoSessionGate enabled />);

    await waitFor(IDLE_AFTER_MS / 2);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(closeLiveConnection).not.toHaveBeenCalled();
  });

  it('closes the socket and explains itself once nobody is there', async () => {
    render(<DemoSessionGate enabled />);

    await waitFor(IDLE_AFTER_MS + 1000);

    expect(closeLiveConnection).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Demo paused')).toBeTruthy();
  });

  it('says something different when the session simply ran out', async () => {
    render(<DemoSessionGate enabled />);

    // Kept busy throughout, so it is the cap and not idleness that stops it.
    for (let elapsed = 0; elapsed < SESSION_LIMIT_MS + 1000; elapsed += IDLE_AFTER_MS / 2) {
      window.dispatchEvent(new Event('pointerdown'));
      await waitFor(IDLE_AFTER_MS / 2);
    }

    expect(screen.getByText('Demo session ended')).toBeTruthy();
    expect(closeLiveConnection).toHaveBeenCalledTimes(1);
  });

  it('keeps the session alive while somebody is interacting', async () => {
    render(<DemoSessionGate enabled />);

    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(new Event('keydown'));
      await waitFor(IDLE_AFTER_MS - 1000);
    }

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(closeLiveConnection).not.toHaveBeenCalled();
  });

  it('does not close the socket twice', async () => {
    render(<DemoSessionGate enabled />);

    await waitFor(IDLE_AFTER_MS + 1000);
    await waitFor(IDLE_AFTER_MS * 2);

    expect(closeLiveConnection).toHaveBeenCalledTimes(1);
  });

  it('stops listening when it unmounts', async () => {
    const { unmount } = render(<DemoSessionGate enabled />);
    unmount();

    await waitFor(SESSION_LIMIT_MS * 2);

    expect(closeLiveConnection).not.toHaveBeenCalled();
  });
});
