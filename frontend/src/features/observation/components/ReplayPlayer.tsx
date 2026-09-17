import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import LaneBadge from '../../../components/ui/LaneBadge';
import { isWithinSlowMotionWindow, slowMotionWindow, type FinishMark } from '../finishFrames';

/**
 * The one place a replay clip becomes a `<video>` element (#177 stage 2),
 * now also the one place a heat's finish-frame markers get drawn under it
 * (#177 stage 4).
 *
 * Extracted out of `Observation.tsx`'s own inline JSX, which used to be the
 * only caller — stage 2 adds a second one, the Schedule tab / Race Control's
 * ▶ modal for a *stored* clip, and duplicating the element rather than
 * sharing it would be two places free to disagree about something as small
 * as `muted` (load-bearing: browsers refuse `autoPlay` on an unmuted video
 * with no user gesture behind it).
 *
 * Deliberately not itself a modal, a picker, or anything about *which*
 * clip is playing — `Observation.tsx` still owns the showings/rate step
 * machine (`replayPlayback.ts`) and its own overlay chrome, and the
 * Schedule-tab modal (`HeatReplayModal.tsx`) owns the camera picker. This
 * component is only the element both of those hand a URL to.
 *
 * **`controls` is also what decides whether the finish-frame timeline is
 * interactive** (#177 stage 4) — the exact same signal this component
 * already used to distinguish the auto-playing, hands-off overlay from a
 * clip somebody opened on purpose. The auto-playing overlay (`controls`
 * false) draws its ticks and captions but offers nothing to click or a
 * keyboard shortcut to press; the ▶ modal (`controls` true) does both. See
 * `.claude/rules/displays.md`'s "Finish frames and slow motion" for the
 * full account of what a mark actually is and how honestly it can be
 * placed.
 */

export type FinishMarkLike = Pick<FinishMark, 'lane' | 'racerName' | 'timeS' | 'atMs'>;

export interface ReplayPlayerProps {
  /** `GET /replay/<name>` — same-origin, credential-free (#552's reasoning
   * extended to video, `.claude/rules/displays.md`). */
  url: string;
  /** `HTMLMediaElement.playbackRate` — the issue's own "slow it down"
   * request. `1` (ordinary speed) when a caller has no opinion.
   *
   * With no `marks`, this applies to the *whole* clip, unchanged from
   * before stage 4 — the auto-playing overlay's own `showings`/`rate`
   * setting is the only caller that ever passed anything but the default
   * here before this stage. With `marks` (and a known `durationMs`), it
   * instead applies only inside the slow-motion window
   * (`finishFrames.slowMotionWindow`) — normal speed everywhere else, so a
   * clip's lead-in and its final second of camera settling are not
   * dragged out at half speed for no reason. */
  rate?: number;
  /** Whether to start playing the instant the element mounts. `true` for
   * the auto-playing display overlay; `false` for a clip somebody opened on
   * purpose from the Schedule tab, where native `controls` (below) are what
   * starts it instead. */
  autoPlay?: boolean;
  /** Native browser scrubber/play-pause, **and** whether the finish-frame
   * timeline below is interactive — see this component's own docstring for
   * why the two share one flag. Off for the auto-playing overlay (nobody
   * is meant to interact with it — it is timed by `replayPlayback.ts` and
   * disappears on its own); on for a clip somebody opened to review. */
  controls?: boolean;
  onEnded?: () => void;
  style?: CSSProperties;
  className?: string;
  /** This clip's own finish-frame markers (#177 stage 4,
   * `finishFrames.finishMarks`) — already filtered to lanes with a real,
   * in-clip crossing. Omitted or empty renders no timeline strip at all. */
  marks?: readonly FinishMarkLike[];
  /** The clip's own known duration in milliseconds — `ReplayClip.durationMs`
   * from the server, not `HTMLVideoElement.duration` (which can read
   * `Infinity` on a still-buffering WebM, or a frame or two off from the
   * figure the clip was actually cut to). Positions the timeline's ticks
   * and bounds the slow-motion window; omitted renders no strip and no
   * window regardless of `marks`. */
  durationMs?: number;
  /** This heat's own lane colours (`colorForLane`), for the timeline's
   * `LaneBadge` dots — optional, since a clip with no track lane-colour
   * configuration still gets ticks, just uncoloured ones. */
  laneColor?: (lane: number) => string | null | undefined;
}

/** The issue's own frame-stepping unit — `,`/`.` move exactly one frame
 * while paused. 30fps is this app's own capture rate throughout #177
 * (`docs/instant-replay.md`, the FakeCamera fixture), not a guess. */
const FRAME_SECONDS = 1 / 30;

/** The auto-playing overlay's own sizing — unchanged from what
 * `Observation.tsx` inlined before this was extracted, so the display
 * surfaces this already ships on are pixel-identical. A caller that wants a
 * different size (the Schedule-tab modal, sized to its own dialog) passes
 * `style` to override it. */
const OVERLAY_STYLE: CSSProperties = {
  width: '80vmin',
  maxWidth: '90vw',
  maxHeight: '70vh',
  borderRadius: '12px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
};

/** "L3 Xander Brake 3.076 s" — the caption both the timeline caption and
 * the frozen-frame overlay use, so the two never say the same fact two
 * different ways. Not `formatLaneTime` (`"3.076s"`, no space) — this reads
 * better as a sentence fragment than as a table cell. */
function captionFor(mark: FinishMarkLike): string {
  return `L${mark.lane} ${mark.racerName} ${mark.timeS.toFixed(3)} s`;
}

/** The one sentence this file promises about precision, everywhere a mark
 * is shown — see `.claude/rules/displays.md`'s "Finish frames and slow
 * motion" for the full account of the RTT-estimate-plus-a-frame-or-two it
 * is describing. */
export const FINISH_MARK_PRECISION_NOTE =
  "Finish marks are placed from the timer's own times; expect them within a frame or two of the picture.";

export default function ReplayPlayer({
  url,
  rate = 1,
  autoPlay = true,
  controls = false,
  onEnded,
  style,
  className,
  marks = [],
  durationMs,
  laneColor,
}: ReplayPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeMark, setActiveMark] = useState<FinishMarkLike | null>(null);
  const [frozen, setFrozen] = useState(false);

  // `controls` is the caller's existing signal for "somebody may touch
  // this" — see the component docstring for why the timeline reuses it
  // rather than a second prop.
  const interactive = controls;

  const sortedMarks = useMemo(() => [...marks].sort((a, b) => a.atMs - b.atMs), [marks]);
  const slowWindow = useMemo(
    () => (durationMs != null ? slowMotionWindow(sortedMarks, durationMs) : null),
    [sortedMarks, durationMs],
  );

  /** Read the video's own current position and update everything that
   * depends on it: which mark's caption is showing, and (inside a
   * slow-motion window) the playback rate. Called from the frame-sync
   * effect below on every frame/tick, and also called directly right
   * after every *programmatic* seek (a tick click, a frame step) — a
   * jsdom `<video>` does not reliably fire `timeupdate` on a bare
   * `currentTime` assignment the way a real browser does, and a click or
   * keypress should not have to wait for one anyway. */
  const syncFromVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const atMs = video.currentTime * 1000;
    let current: FinishMarkLike | null = null;
    for (const mark of sortedMarks) {
      if (mark.atMs <= atMs) current = mark;
      else break;
    }
    setActiveMark(current);
    // With no marks at all, `rate` keeps its pre-stage-4 meaning: the
    // whole clip plays at it. With marks (and a known duration), it
    // applies only inside the slow-motion window.
    video.playbackRate = sortedMarks.length === 0 ? rate : isWithinSlowMotionWindow(atMs, slowWindow) ? rate : 1;
  }, [sortedMarks, slowWindow, rate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // `requestVideoFrameCallback` is what makes the caption/rate change
    // land on the frame it belongs to rather than up to 250ms late
    // (`timeupdate`'s own granularity) — most Chromium/Safari builds
    // support it; jsdom (these tests) and Firefox fall back to
    // `timeupdate`, still correct, just coarser.
    const withRvfc = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (withRvfc.requestVideoFrameCallback && withRvfc.cancelVideoFrameCallback) {
      let cancelled = false;
      let handle = 0;
      const tick = () => {
        if (cancelled) return;
        syncFromVideo();
        handle = withRvfc.requestVideoFrameCallback!(tick);
      };
      handle = withRvfc.requestVideoFrameCallback(tick);
      return () => {
        cancelled = true;
        withRvfc.cancelVideoFrameCallback!(handle);
      };
    }
    video.addEventListener('timeupdate', syncFromVideo);
    return () => video.removeEventListener('timeupdate', syncFromVideo);
  }, [syncFromVideo]);

  /** Click a tick: seek there and freeze, with the lane time overlaid —
   * only reachable when `interactive` (the timeline itself renders its
   * buttons `disabled` otherwise, so this is a second guard, not the only
   * one). */
  const seekAndFreeze = (mark: FinishMarkLike) => {
    const video = videoRef.current;
    if (!video || !interactive) return;
    video.currentTime = mark.atMs / 1000;
    video.pause();
    setFrozen(true);
    syncFromVideo();
  };

  const resume = () => {
    const video = videoRef.current;
    if (!video || !interactive || !frozen) return;
    setFrozen(false);
    void video.play();
  };

  const stepFrame = (deltaFrames: 1 | -1) => {
    const video = videoRef.current;
    if (!video || !interactive || !video.paused) return;
    const maxSeconds = durationMs != null ? durationMs / 1000 : Infinity;
    video.currentTime = Math.min(maxSeconds, Math.max(0, video.currentTime + deltaFrames * FRAME_SECONDS));
    syncFromVideo();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (e.key !== ' ' && e.key !== ',' && e.key !== '.') return;
    // These three are the only keys this component claims. `preventDefault`
    // alone is not enough: `Modal` portals to `document.body`
    // (`ReactDOM.createPortal`), so the native keydown still bubbles from
    // there past this element's own place in the React tree and reaches
    // `window` — where `RaceExecution.tsx`'s own race-day shortcuts also
    // listen for Space. Reproduced live in review: freezing an earlier
    // heat's replay from Previous Heats and pressing Space to resume it
    // also silently advanced the *active* heat underneath the modal.
    // `stopPropagation()` is what actually stops that — the same fix
    // `RaceExecution.tsx`'s own preferences popover already uses for its
    // Escape key, for the identical reason (a narrower, local concern
    // claiming a key before the shortcuts effect underneath it can see
    // it). `RaceExecution`'s own `replayModalOpen` prop is belt and
    // braces on top, for a key this component does not itself handle.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === ' ') {
      resume();
    } else if (e.key === ',') {
      stepFrame(-1);
    } else {
      stepFrame(1);
    }
  };

  const hasStrip = sortedMarks.length > 0 && !!durationMs;

  return (
    <div
      data-testid="replay-player-frame"
      style={{ display: 'inline-block' }}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      onClick={interactive && frozen ? resume : undefined}
    >
      <video
        // No internal `key` here on purpose — the caller sets one on the
        // `<ReplayPlayer>` element itself when it needs a *repeat* showing
        // of the identical URL to actually restart (`Observation.tsx`'s own
        // overlay keys on `${clip.url}-${clipIndex}-${playCount}`, since a
        // second showing of the same clip has the same URL and a bare prop
        // update would not restart `autoPlay`). A caller that only ever
        // shows a clip once (the Schedule-tab modal) needs no key at all.
        src={url}
        autoPlay={autoPlay}
        muted
        playsInline
        controls={controls}
        data-testid="replay-video"
        ref={(el) => {
          videoRef.current = el;
          if (el) el.playbackRate = sortedMarks.length === 0 ? rate : 1;
        }}
        style={{ ...OVERLAY_STYLE, ...style, display: 'block' }}
        className={className}
        onEnded={onEnded}
      />
      {activeMark && (
        // A small dark pill with fixed white text, deliberately not a
        // theme token: this component is mounted both inside an ordinary
        // light modal (`HeatReplayModal`) and over a dark, full-screen
        // display overlay (`Observation.tsx`) — `--display-text-color`
        // defaults to white at `:root` regardless of which of those two
        // it is read in, so using it here read as invisible white-on-white
        // inside the modal. A caption that supplies its own contrast, the
        // same broadcast-lower-third approach `BroadcastOverlayView.tsx`
        // already uses for the identical reason, reads correctly in both.
        <div
          data-testid="replay-finish-caption"
          style={{
            marginTop: '4px',
            padding: '2px 10px',
            borderRadius: '6px',
            background: 'rgba(0, 0, 0, 0.72)',
            fontSize: '0.9rem',
            fontWeight: 600,
            textAlign: 'center',
            color: '#ffffff',
            display: 'inline-block',
          }}
        >
          {captionFor(activeMark)}
        </div>
      )}
      {hasStrip && (
        <div
          data-testid="replay-finish-timeline"
          title={FINISH_MARK_PRECISION_NOTE}
          style={{
            position: 'relative',
            height: '28px',
            marginTop: '4px',
            borderRadius: '6px',
            background: 'rgba(128, 128, 128, 0.25)',
          }}
        >
          {sortedMarks.map((mark) => (
            <button
              key={mark.lane}
              type="button"
              // `disabled` rather than simply not rendering an
              // `onClick` — the audience overlay's own ticks must be
              // "nothing clickable", and a disabled button is also
              // unreachable by keyboard focus, not merely inert on a
              // pointer event.
              disabled={!interactive}
              aria-label={`Seek to ${captionFor(mark)}`}
              data-testid={`replay-finish-mark-${mark.lane}`}
              onClick={
                interactive
                  ? (e) => {
                      e.stopPropagation();
                      seekAndFreeze(mark);
                    }
                  : undefined
              }
              style={{
                position: 'absolute',
                left: `${(mark.atMs / durationMs!) * 100}%`,
                top: 0,
                bottom: 0,
                transform: 'translateX(-50%)',
                background: 'none',
                border: 'none',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                cursor: interactive ? 'pointer' : 'default',
              }}
            >
              <LaneBadge color={laneColor?.(mark.lane)} style={{ fontSize: '0.75rem' }}>
                {mark.lane}
              </LaneBadge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
