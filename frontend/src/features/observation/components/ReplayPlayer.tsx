import type { CSSProperties } from 'react';

/**
 * The one place a replay clip becomes a `<video>` element (#177 stage 2).
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
 */
export interface ReplayPlayerProps {
  /** `GET /replay/<name>` — same-origin, credential-free (#552's reasoning
   * extended to video, `.claude/rules/displays.md`). */
  url: string;
  /** `HTMLMediaElement.playbackRate` — the issue's own "slow it down"
   * request. `1` (ordinary speed) when a caller has no opinion, which is
   * every caller except the auto-playing overlay's own `showings`/`rate`
   * setting. */
  rate?: number;
  /** Whether to start playing the instant the element mounts. `true` for
   * the auto-playing display overlay; `false` for a clip somebody opened on
   * purpose from the Schedule tab, where native `controls` (below) are what
   * starts it instead. */
  autoPlay?: boolean;
  /** Native browser scrubber/play-pause. Off for the auto-playing overlay
   * (nobody is meant to interact with it — it is timed by `replayPlayback.ts`
   * and disappears on its own); on for a clip somebody opened to review. */
  controls?: boolean;
  onEnded?: () => void;
  style?: CSSProperties;
  className?: string;
}

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

export default function ReplayPlayer({
  url,
  rate = 1,
  autoPlay = true,
  controls = false,
  onEnded,
  style,
  className,
}: ReplayPlayerProps) {
  return (
    <video
      // No internal `key` here on purpose — the caller sets one on the
      // `<ReplayPlayer>` element itself when it needs a *repeat* showing of
      // the identical URL to actually restart (`Observation.tsx`'s own
      // overlay keys on `${clip.url}-${clipIndex}-${playCount}`, since a
      // second showing of the same clip has the same URL and a bare prop
      // update would not restart `autoPlay`). A caller that only ever shows
      // a clip once (the Schedule-tab modal) needs no key at all.
      src={url}
      autoPlay={autoPlay}
      muted
      playsInline
      controls={controls}
      data-testid="replay-video"
      ref={(el) => {
        if (el) el.playbackRate = rate;
      }}
      style={{ ...OVERLAY_STYLE, ...style }}
      className={className}
      onEnded={onEnded}
    />
  );
}
