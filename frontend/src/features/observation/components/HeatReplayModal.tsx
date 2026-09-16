import { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import ReplayPlayer from './ReplayPlayer';

export interface HeatReplayClipLike {
  readonly cameraId: string;
  readonly url: string;
}

export interface HeatReplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The heat's own label, for the modal's title — "Heat 12", not an id. */
  heatLabel: string;
  clips: readonly HeatReplayClipLike[];
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
 * clip needs no tabs.
 */
export default function HeatReplayModal({ isOpen, onClose, heatLabel, clips }: HeatReplayModalProps) {
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  // `clips` can change under an already-open modal (a second camera's clip
  // lands while the operator is looking at the first) — fall back to the
  // first clip whenever the selection no longer names one that exists,
  // rather than freezing on a stale pick or going blank.
  const active =
    clips.find((c) => c.cameraId === selectedCameraId) ?? clips[0] ?? null;

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
            style={{ width: '100%', maxWidth: '100%', maxHeight: '60vh' }}
          />
        </>
      ) : (
        <p>No clip is available for this heat any more.</p>
      )}
    </Modal>
  );
}
