import { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import ReplayPlayer from './ReplayPlayer';
import { finishMarks, type LaneResultLike } from '../finishFrames';
import { DEFAULT_REPLAY_SETTINGS } from '../replayPlayback';

export interface HeatReplayClipLike {
  readonly cameraId: string;
  readonly url: string;
  /** Only known for a *stored* clip (#177 stage 2) — absent for the
   * results-flow player's own live shape, which never calls this modal.
   * Needed to place finish-frame markers (#177 stage 4) and to bound the
   * slow-motion window; a clip with no known duration gets neither. */
  readonly durationMs?: number;
  readonly t0OffsetMs?: number;
}

export interface HeatReplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The heat's own label, for the modal's title — "Heat 12", not an id. */
  heatLabel: string;
  clips: readonly HeatReplayClipLike[];
  /** This heat's own lane results (#177 stage 4) — `heat.lanes`, already
   * on hand at every call site (the Schedule tab and Race Control's
   * Previous Heats both already render a lane list for the same heat).
   * Omitted renders the clip with no finish-frame markers, the same as a
   * clip whose `durationMs` is unknown. */
  lanes?: readonly LaneResultLike[];
  /** This heat's own lane colours (`colorForLane`) — optional, the same
   * as `ReplayPlayer`'s own prop it is forwarded to. */
  laneColor?: (lane: number) => string | null | undefined;
}

/**
 * ▶ on a heat with a stored clip (#177 stage 2) — the Schedule tab's row
 * and phone card, and Race Control's Previous Heats list, all open this
 * same modal rather than each growing its own player.
 *
 * Muted (`ReplayPlayer`'s own rule, load-bearing for `autoPlay`), with
 * native `controls` so an operator can pause and scrub a clip they opened
 * on purpose — unlike the auto-playing overlay `Observation.tsx` uses right
 * after a result, which times itself and offers no controls at all. A
 * camera picker appears only once there is something to pick between; one
 * clip needs no tabs. The camera picker's own order is `clips`' own array
 * order, which the server hands back already sorted by the operator's own
 * camera order (#177 stage 4, `.claude/rules/displays.md`'s "Multi-camera
 * ordering") — nothing here re-sorts it.
 */
export default function HeatReplayModal({
  isOpen,
  onClose,
  heatLabel,
  clips,
  lanes,
  laneColor,
}: HeatReplayModalProps) {
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  // `clips` can change under an already-open modal (a second camera's clip
  // lands while the operator is looking at the first) — fall back to the
  // first clip whenever the selection no longer names one that exists,
  // rather than freezing on a stale pick or going blank.
  const active =
    clips.find((c) => c.cameraId === selectedCameraId) ?? clips[0] ?? null;

  // Finish-frame markers and the slow-motion window both apply here too
  // (#177 stage 4, `.claude/rules/displays.md`) — an operator reviewing a
  // stored clip on purpose gets the same timeline the results-flow player
  // does. There is no per-display setting to read a slow-motion rate from
  // (this modal is not scoped to one screen), so it always uses the
  // issue's own default rate rather than leaving the window permanently
  // unused here.
  const marks =
    active && active.durationMs != null && active.t0OffsetMs != null && lanes
      ? finishMarks({ t0OffsetMs: active.t0OffsetMs, durationMs: active.durationMs }, lanes)
      : [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Replay — ${heatLabel}`} maxWidth="640px">
      {active ? (
        <>
          {clips.length > 1 && (
            <div
              data-testid="heat-replay-camera-picker"
              style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}
            >
              {clips.map((clip) => (
                <button
                  key={clip.cameraId}
                  type="button"
                  className={clip.cameraId === active.cameraId ? 'primary-btn' : 'secondary-btn'}
                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                  onClick={() => setSelectedCameraId(clip.cameraId)}
                >
                  {clip.cameraId}
                </button>
              ))}
            </div>
          )}
          <ReplayPlayer
            key={active.url}
            url={active.url}
            controls
            autoPlay={false}
            rate={DEFAULT_REPLAY_SETTINGS.rate}
            marks={marks}
            durationMs={active.durationMs}
            laneColor={laneColor}
            style={{ width: '100%', maxWidth: '100%', maxHeight: '60vh' }}
          />
        </>
      ) : (
        <p>No clip is available for this heat any more.</p>
      )}
    </Modal>
  );
}
