// @vitest-environment jsdom
/**
 * The finish-frame timeline strip, its caption, click-to-freeze, frame
 * stepping and the slow-motion window (#177 stage 4). The plain-video
 * behaviour (`muted`, `autoPlay`, the repeat-showing `key` contract) is
 * pinned by `HeatReplayModal.test.tsx` and `Observation.test.tsx` already —
 * this file is only what stage 4 adds.
 *
 * jsdom implements neither `HTMLMediaElement.play`/`pause` for real nor
 * `requestVideoFrameCallback` at all, so every test here drives the
 * component through the `timeupdate` fallback path and stubs the two
 * media methods, the same "mock HTMLMediaElement" shape
 * `CheckInScanner.test.tsx` already uses for `readyState`.
 */
import '../../../setupTests';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReplayPlayer, { type FinishMarkLike } from './ReplayPlayer';
import { useElementWidth } from '../../core/hooks/useElementWidth';

// The strip's real measured width decides `minGapPct` (#1218's review) —
// `null` here (unmeasured) is what every test in this file except the
// "minGapPct is derived..." describe block below wants, since it is the
// same effective 5% fallback jsdom's own unmocked `useElementWidth` would
// give anyway (jsdom lays out nothing, so a real, unmocked strip always
// measures `0`). Mocked at the module level, rather than only stubbing
// `ResizeObserver`, because the width itself — not just whether a resize
// fires — is what this component now derives `minGapPct` from.
vi.mock('../../core/hooks/useElementWidth', () => ({
  useElementWidth: vi.fn(() => [() => {}, null] as const),
}));

const MARKS: FinishMarkLike[] = [
  { lane: 2, racerName: 'Xander Brake', timeS: 3.076, atMs: 2000 + 3076 },
  { lane: 1, racerName: 'Priya Torque', timeS: 2.5, atMs: 2000 + 2500 },
];
const DURATION_MS = 8000;

beforeEach(() => {
  // jsdom's own `play`/`pause` are unimplemented stubs that log a "not
  // implemented" console error otherwise — replaced with plain spies, the
  // same shape every other suite in this tree mocking `HTMLMediaElement`
  // uses.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  // Explicit, rather than relying on `vi.restoreAllMocks()` below to put a
  // plain `vi.fn()` (not a `vi.spyOn` of a real implementation) back to a
  // known state — every test starts unmeasured unless it says otherwise.
  vi.mocked(useElementWidth).mockReturnValue([() => {}, null]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function getVideo() {
  return screen.getByTestId('replay-video') as HTMLVideoElement;
}

describe('the finish-frame timeline', () => {
  it('renders no strip at all with no marks', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls />);

    expect(screen.queryByTestId('replay-finish-timeline')).toBeNull();
  });

  it('renders no strip without a known duration, even with marks', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} />);

    expect(screen.queryByTestId('replay-finish-timeline')).toBeNull();
  });

  it('renders one tick per mark, positioned by atMs/durationMs', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);

    const strip = screen.getByTestId('replay-finish-timeline');
    expect(strip).toHaveAttribute('title', expect.stringContaining("timer's own times"));
    const laneOne = screen.getByTestId('replay-finish-mark-1');
    const laneTwo = screen.getByTestId('replay-finish-mark-2');
    expect(laneOne.style.left).toBe(`${(4500 / DURATION_MS) * 100}%`);
    expect(laneTwo.style.left).toBe(`${(5076 / DURATION_MS) * 100}%`);
  });

  it('renders ticks disabled, with no click handler, on the non-interactive overlay', () => {
    render(
      <ReplayPlayer url="/replay/a.webm" controls={false} marks={MARKS} durationMs={DURATION_MS} />,
    );

    const tick = screen.getByTestId('replay-finish-mark-1');
    expect(tick).toBeDisabled();
  });
});

describe('overlapping marks stack onto separate rows (#1218)', () => {
  // Two lanes finishing 10ms apart on a 5s clip — well inside the
  // minGapPct band `ReplayPlayer.tsx` lays the strip out with (the module
  // mock above leaves the strip unmeasured for this describe block, so
  // that band is the 5% fallback). This used to render both buttons on
  // the same row, in DOM order, with no `z-index`: the later lane's badge
  // covered the earlier lane's own hit area entirely, exactly as the
  // issue's own Playwright trace found ("subtree intercepts pointer
  // events", retried forever). This is the seam test: it must fail on
  // `main`, where every mark renders at `top: 0` on one shared row
  // regardless of how close two of them land.
  const CLOSE_MARKS: FinishMarkLike[] = [
    { lane: 1, racerName: 'Early Bird', timeS: 3.4, atMs: 3400 },
    { lane: 2, racerName: 'Close Second', timeS: 3.41, atMs: 3410 },
  ];
  const CLOSE_DURATION_MS = 5000;

  it('renders both marks, on different rows', () => {
    render(
      <ReplayPlayer url="/replay/a.webm" controls marks={CLOSE_MARKS} durationMs={CLOSE_DURATION_MS} />,
    );

    const laneOne = screen.getByTestId('replay-finish-mark-1');
    const laneTwo = screen.getByTestId('replay-finish-mark-2');
    expect(laneOne).toBeVisible();
    expect(laneTwo).toBeVisible();
    expect(laneOne.getAttribute('data-row')).not.toBe(laneTwo.getAttribute('data-row'));
  });

  it('clicking each mark seeks and freezes on its own lane, not its neighbour', () => {
    render(
      <ReplayPlayer url="/replay/a.webm" controls marks={CLOSE_MARKS} durationMs={CLOSE_DURATION_MS} />,
    );
    const video = getVideo();

    fireEvent.click(screen.getByTestId('replay-finish-mark-1'));
    expect(video.currentTime).toBeCloseTo(3.4, 5);
    expect(screen.getByTestId('replay-finish-caption')).toHaveTextContent(
      'L1 Early Bird 3.400 s',
    );

    fireEvent.click(screen.getByTestId('replay-finish-mark-2'));
    expect(video.currentTime).toBeCloseTo(3.41, 5);
    expect(screen.getByTestId('replay-finish-caption')).toHaveTextContent(
      'L2 Close Second 3.410 s',
    );
  });
});

describe('the strip height grows with the row count', () => {
  it('is 28px (one row) when nothing collides', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);

    expect(screen.getByTestId('replay-finish-timeline').style.height).toBe('28px');
  });

  it('is 84px (three rows) for a three-way collision', () => {
    // Three lanes within a millisecond of each other on a 5s clip — well
    // inside the 5% fallback band — forces all three onto separate rows
    // (`finishMarkLayout.ts`'s `MAX_ROWS` is 3), so the strip's own height
    // has to grow to `3 * MARK_ROW_HEIGHT_PX` rather than staying at the
    // single-row 28px every other test in this file renders.
    const threeWay: FinishMarkLike[] = [
      { lane: 1, racerName: 'A', timeS: 3.4, atMs: 3400 },
      { lane: 2, racerName: 'B', timeS: 3.401, atMs: 3401 },
      { lane: 3, racerName: 'C', timeS: 3.402, atMs: 3402 },
    ];
    render(<ReplayPlayer url="/replay/a.webm" controls marks={threeWay} durationMs={5000} />);

    const strip = screen.getByTestId('replay-finish-timeline');
    expect(strip.style.height).toBe('84px');
    const rows = ['1', '2', '3'].map(
      (lane) => screen.getByTestId(`replay-finish-mark-${lane}`).getAttribute('data-row'),
    );
    expect(new Set(rows).size).toBe(3);
  });
});

describe('minGapPct is derived from the strip\'s measured width (#1218 review)', () => {
  // A first pass sized `minGapPct` as a flat 5%, reasoned from the ▶
  // modal's own ~640px reference frame — a review caught that this badly
  // understates the audience overlay's narrowest real size (~312px at the
  // phone tier, `OVERLAY_STYLE`'s `width: 80vmin; maxWidth: 90vw`), where
  // two marks the old flat rule called "not colliding" could still
  // visually overlap. These two marks sit 4% of the clip's duration apart
  // — inside the ~7.05% a 312px-wide strip's real `minGapPct` computes to
  // (`22 / 312 * 100`), outside the ~3.44% a 640px-wide strip's does
  // (`22 / 640 * 100`) — so the same pair of marks has to land on
  // different rows at one width and share a row at the other, proving
  // `minGapPct` is actually a function of the measured width rather than
  // a constant.
  const DURATION = 10000;
  const MARKS_4PCT_APART: FinishMarkLike[] = [
    { lane: 1, racerName: 'A', timeS: 4.0, atMs: 4000 },
    { lane: 2, racerName: 'B', timeS: 4.4, atMs: 4400 },
  ];

  it('at 312px (the audience overlay\'s own phone-tier width), the pair collides onto separate rows', () => {
    vi.mocked(useElementWidth).mockReturnValue([() => {}, 312]);
    render(
      <ReplayPlayer url="/replay/a.webm" controls marks={MARKS_4PCT_APART} durationMs={DURATION} />,
    );

    const laneOne = screen.getByTestId('replay-finish-mark-1');
    const laneTwo = screen.getByTestId('replay-finish-mark-2');
    expect(laneOne.getAttribute('data-row')).not.toBe(laneTwo.getAttribute('data-row'));
  });

  it('at 640px (the ▶ modal\'s own reference width), the identical pair shares row 0', () => {
    vi.mocked(useElementWidth).mockReturnValue([() => {}, 640]);
    render(
      <ReplayPlayer url="/replay/a.webm" controls marks={MARKS_4PCT_APART} durationMs={DURATION} />,
    );

    const laneOne = screen.getByTestId('replay-finish-mark-1');
    const laneTwo = screen.getByTestId('replay-finish-mark-2');
    expect(laneOne.getAttribute('data-row')).toBe('0');
    expect(laneTwo.getAttribute('data-row')).toBe('0');
  });

  it('falls back to the 5% constant when unmeasured (null width)', () => {
    vi.mocked(useElementWidth).mockReturnValue([() => {}, null]);
    render(
      <ReplayPlayer url="/replay/a.webm" controls marks={MARKS_4PCT_APART} durationMs={DURATION} />,
    );

    // 4% apart is inside the 5% fallback band, so this still collides —
    // matching the pre-measurement (first paint) and jsdom (no
    // ResizeObserver) cases, both of which stay on the fallback forever.
    const laneOne = screen.getByTestId('replay-finish-mark-1');
    const laneTwo = screen.getByTestId('replay-finish-mark-2');
    expect(laneOne.getAttribute('data-row')).not.toBe(laneTwo.getAttribute('data-row'));
  });
});

describe('the finish caption', () => {
  it('shows the most recently crossed mark, formatted as "Lx Name t.tt s"', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();

    Object.defineProperty(video, 'currentTime', { value: 4.5, writable: true, configurable: true });
    fireEvent.timeUpdate(video);

    expect(screen.getByTestId('replay-finish-caption')).toHaveTextContent(
      'L1 Priya Torque 2.500 s',
    );
  });

  it('shows nothing before the first mark is crossed', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();

    Object.defineProperty(video, 'currentTime', { value: 1.0, writable: true, configurable: true });
    fireEvent.timeUpdate(video);

    expect(screen.queryByTestId('replay-finish-caption')).toBeNull();
  });

  it('advances to the second mark once it too has been crossed', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();

    Object.defineProperty(video, 'currentTime', { value: 5.2, writable: true, configurable: true });
    fireEvent.timeUpdate(video);

    expect(screen.getByTestId('replay-finish-caption')).toHaveTextContent(
      'L2 Xander Brake 3.076 s',
    );
  });
});

describe('clicking a tick', () => {
  it('seeks to that mark, pauses, and shows its caption', async () => {
    const user = userEvent.setup();
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();
    const pauseSpy = vi.spyOn(video, 'pause');

    await user.click(screen.getByTestId('replay-finish-mark-1'));

    expect(video.currentTime).toBeCloseTo(4.5, 5);
    expect(pauseSpy).toHaveBeenCalled();
    expect(screen.getByTestId('replay-finish-caption')).toHaveTextContent(
      'L1 Priya Torque 2.500 s',
    );
  });

  it('does nothing on the non-interactive overlay (the button is disabled)', async () => {
    render(
      <ReplayPlayer url="/replay/a.webm" controls={false} marks={MARKS} durationMs={DURATION_MS} />,
    );
    const video = getVideo();
    const pauseSpy = vi.spyOn(video, 'pause');

    fireEvent.click(screen.getByTestId('replay-finish-mark-1'));

    expect(pauseSpy).not.toHaveBeenCalled();
  });
});

describe('a key this component handles does not reach the page underneath it', () => {
  // `fireEvent` dispatches a real, bubbling `KeyboardEvent` (jsdom's DOM,
  // not React's own simulated tree) — the same path a portaled modal's
  // keydown takes to `window` in a real browser, which is exactly what let
  // `HeatReplayModal`'s Space-to-resume also fire `RaceExecution.tsx`'s own
  // global Space shortcut underneath it (a PR review reproduced this live).
  // `stopPropagation()` is what has to stop it, and this is the direct,
  // no-DOM-portal-required proof that it does.
  it('stops Space, ",", and "." from bubbling to a window listener while interactive', async () => {
    const user = userEvent.setup();
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    try {
      render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
      const video = getVideo();
      await user.click(screen.getByTestId('replay-finish-mark-1'));
      windowSpy.mockClear();

      fireEvent.keyDown(video.parentElement!, { key: ' ' });
      fireEvent.keyDown(video.parentElement!, { key: ',' });
      fireEvent.keyDown(video.parentElement!, { key: '.' });

      expect(windowSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowSpy);
    }
  });

  it('lets an unrelated key bubble normally, proving propagation is not broken outright', () => {
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    try {
      render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
      const video = getVideo();

      fireEvent.keyDown(video.parentElement!, { key: 'a' });

      expect(windowSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', windowSpy);
    }
  });

  it('does not stop propagation on the non-interactive overlay, which has no keys of its own to claim', () => {
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    try {
      render(<ReplayPlayer url="/replay/a.webm" controls={false} marks={MARKS} durationMs={DURATION_MS} />);
      const video = getVideo();

      fireEvent.keyDown(video.parentElement!, { key: ' ' });

      expect(windowSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', windowSpy);
    }
  });
});

describe('resuming', () => {
  it('space resumes playback after a freeze', async () => {
    const user = userEvent.setup();
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();
    const playSpy = vi.spyOn(video, 'play');

    await user.click(screen.getByTestId('replay-finish-mark-1'));
    // The wrapper div is what receives the keyboard focus/click, not the
    // video itself — clicking a tick doesn't move focus there for us, so
    // press Space against the container by firing on the video's own
    // parent, the same element `tabIndex`/`onKeyDown` are attached to.
    fireEvent.keyDown(video.parentElement!, { key: ' ' });

    expect(playSpy).toHaveBeenCalled();
  });

  it('clicking the player resumes playback after a freeze', async () => {
    const user = userEvent.setup();
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();
    const playSpy = vi.spyOn(video, 'play');

    await user.click(screen.getByTestId('replay-finish-mark-1'));
    fireEvent.click(video.parentElement!);

    expect(playSpy).toHaveBeenCalled();
  });
});

describe('frame stepping', () => {
  it(', steps back one frame (1/30s) while paused', async () => {
    const user = userEvent.setup();
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();
    await user.click(screen.getByTestId('replay-finish-mark-1'));
    const before = video.currentTime;

    fireEvent.keyDown(video.parentElement!, { key: ',' });

    expect(video.currentTime).toBeCloseTo(before - 1 / 30, 5);
  });

  it('. steps forward one frame (1/30s) while paused', async () => {
    const user = userEvent.setup();
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();
    await user.click(screen.getByTestId('replay-finish-mark-1'));
    const before = video.currentTime;

    fireEvent.keyDown(video.parentElement!, { key: '.' });

    expect(video.currentTime).toBeCloseTo(before + 1 / 30, 5);
  });

  it('does nothing while the video is playing (not paused)', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 1.0, writable: true, configurable: true });

    fireEvent.keyDown(video.parentElement!, { key: '.' });

    expect(video.currentTime).toBe(1.0);
  });
});

describe('the slow-motion window', () => {
  it('plays at the given rate inside the window and normal speed outside it', () => {
    render(<ReplayPlayer url="/replay/a.webm" controls rate={0.5} marks={MARKS} durationMs={DURATION_MS} />);
    const video = getVideo();

    // Well before the window (first finish at 4.5s, lead 1s -> window
    // starts at 3.5s).
    Object.defineProperty(video, 'currentTime', { value: 1.0, writable: true, configurable: true });
    fireEvent.timeUpdate(video);
    expect(video.playbackRate).toBe(1);

    // Inside the window.
    Object.defineProperty(video, 'currentTime', { value: 4.0, writable: true, configurable: true });
    fireEvent.timeUpdate(video);
    expect(video.playbackRate).toBe(0.5);

    // After the window (last finish at 5.076s, tail 0.2s -> window ends
    // at 5.276s).
    Object.defineProperty(video, 'currentTime', { value: 6.0, writable: true, configurable: true });
    fireEvent.timeUpdate(video);
    expect(video.playbackRate).toBe(1);
  });

  it('applies rate to the whole clip when there are no marks at all, preserving pre-stage-4 behaviour', () => {
    render(<ReplayPlayer url="/replay/a.webm" rate={0.5} />);
    const video = getVideo();

    expect(video.playbackRate).toBe(0.5);
  });
});

/**
 * Mutation check: offsetting a mark's `atMs` by 500ms (as if `t0OffsetMs`
 * had drifted) moves the tick's position and the seek target with it —
 * proving the timeline actually reads `atMs` rather than some other,
 * coincidentally-similar value. Run by hand while developing this file:
 * shift `MARKS[0].atMs` by 500 and this assertion fails, exactly as the
 * PR's own test plan records.
 */
describe('mark placement is load-bearing', () => {
  it('seeks to exactly atMs/1000, not a rounded or nearby value', async () => {
    const user = userEvent.setup();
    const marks: FinishMarkLike[] = [{ lane: 3, racerName: 'Test', timeS: 3.333, atMs: 3333 }];
    render(<ReplayPlayer url="/replay/a.webm" controls marks={marks} durationMs={DURATION_MS} />);
    const video = getVideo();

    await user.click(screen.getByTestId('replay-finish-mark-3'));

    expect(video.currentTime).toBeCloseTo(3.333, 5);
  });
});
