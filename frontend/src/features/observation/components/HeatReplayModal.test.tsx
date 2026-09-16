// @vitest-environment jsdom
/**
 * The Schedule tab / Race Control's ▶ modal for a stored replay clip
 * (#177 stage 2) — the camera picker only when there is something to pick
 * between, and the player underneath it.
 */
import '../../../setupTests';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HeatReplayModal from './HeatReplayModal';

afterEach(() => {
  cleanup();
});

describe('HeatReplayModal', () => {
  it('renders the one clip with no camera picker', () => {
    render(
      <HeatReplayModal
        isOpen
        onClose={vi.fn()}
        heatLabel="Heat 12"
        clips={[{ cameraId: 'finish-line', url: '/replay/abc.webm' }]}
      />,
    );

    expect(screen.getByText('Replay — Heat 12')).toBeInTheDocument();
    expect(screen.queryByTestId('heat-replay-camera-picker')).toBeNull();
    const video = screen.getByTestId('replay-video') as HTMLVideoElement;
    expect(video.src).toContain('/replay/abc.webm');
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.controls).toBe(true);
  });

  it('offers a camera picker once more than one clip exists, and switches on click', async () => {
    const user = userEvent.setup();
    render(
      <HeatReplayModal
        isOpen
        onClose={vi.fn()}
        heatLabel="Heat 3"
        clips={[
          { cameraId: 'finish-line', url: '/replay/first.webm' },
          { cameraId: 'side-angle', url: '/replay/second.webm' },
        ]}
      />,
    );

    expect(screen.getByTestId('heat-replay-camera-picker')).toBeInTheDocument();
    let video = screen.getByTestId('replay-video') as HTMLVideoElement;
    expect(video.src).toContain('/replay/first.webm');

    await user.click(screen.getByText('side-angle'));

    video = screen.getByTestId('replay-video') as HTMLVideoElement;
    expect(video.src).toContain('/replay/second.webm');
  });

  it('says so plainly when the clip it was showing has since been removed', () => {
    render(<HeatReplayModal isOpen onClose={vi.fn()} heatLabel="Heat 5" clips={[]} />);

    expect(screen.getByText('No clip is available for this heat any more.')).toBeInTheDocument();
    expect(screen.queryByTestId('replay-video')).toBeNull();
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <HeatReplayModal
        isOpen={false}
        onClose={vi.fn()}
        heatLabel="Heat 1"
        clips={[{ cameraId: 'finish-line', url: '/replay/abc.webm' }]}
      />,
    );
    expect(container.querySelector('[data-testid="replay-video"]')).toBeNull();
  });
});
