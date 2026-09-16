/**
 * `/race/:raceId/camera` — a device with a camera, registered the way a
 * display is (#177 stage 1b).
 *
 * **Capture is `MediaRecorder`, not `VideoEncoder` — a deliberate departure
 * from the issue's own "WebCodecs, not MediaRecorder" design, stated here
 * rather than left for a reviewer to notice.** The issue's reasoning is
 * sound (frame-accurate seeking, no `MediaRecorder` choppiness) but a
 * `VideoEncoder` pipeline needs a WebM/fMP4 *muxer* of its own — nothing
 * small and dependency-free ships in this tree, and writing one is a
 * project in itself, disproportionate to what stage 1b needs to prove. This
 * stage instead buffers `MediaRecorder`'s own time-sliced output (a `Blob`
 * every `RECORDER_TIMESLICE_MS`) in `../ring.ts`'s `RingBuffer`, and cuts a
 * clip by *concatenating* whichever slices overlap the computed window —
 * Chrome and Safari both produce a webm/mp4 whose first chunk carries the
 * container header and every later chunk appends cluster data cleanly
 * appendable this way, which is the same technique several open-source
 * "record the last N seconds" tools use in place of a full muxer.
 *
 * **The cost of that trade-off is the cut's own granularity.** `t0` itself
 * is still corrected for half the measured round trip, same as the issue
 * asks (see `../clipBounds.ts`) — but the clip's *start and end* can only
 * land on a slice boundary, so the real-world jitter on where a clip
 * actually begins is bounded by `RECORDER_TIMESLICE_MS`, not the "±1 frame
 * at 30fps" a true `VideoEncoder` cut would give. Shrinking the timeslice
 * narrows that at the cost of more, smaller `Blob`s to concatenate — left
 * at 250ms here, a comfortable margin under the 1.5s default pre-roll.
 *
 * **The browser gate still reads `WebCodecs` support, not `MediaRecorder`
 * support** — see `../browserSupport.ts`'s own docs for why that is kept
 * rather than loosened now that the encode step does not use it: it is the
 * issue's own browser matrix, and Firefox (lacking both) is the one
 * exclusion the issue names by name.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useClient, useMutation, useQuery, useSubscription } from 'urql';

import { GET_TRACKS } from '../../core/graphql/queries';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';
import { displayId, startDeviceClaimHeartbeat } from '../../observation/displayIdentity';
import {
  DisplayAssignmentSubscription,
  SET_CAMERA_TRACK,
  TimingStatsSubscription,
} from '../../observation/graphql/queries';
import IdentifyPresence from '../../observation/IdentifyPresence';
import { useIdentifyOverlay } from '../../observation/useIdentifyOverlay';
import { observeHeatResult, type SeenHeatResult } from '../../observation/resultsOverlay';
import { TIMER_STATUS_SUBSCRIPTION } from '../../racing/graphql/queries';

import {
  cameraSupport,
  INSECURE_CONTEXT_MESSAGE,
  WEBCODECS_MESSAGE,
} from '../browserSupport';
import {
  correctedT0Ms,
  latestRunningAt,
  medianMs,
  noneFallbackBounds,
  timerSyncedBounds,
  type ClipBounds,
  type Transition,
} from '../clipBounds';
import { RingBuffer, type RingChunk } from '../ring';
import { CAMERA_PING_QUERY } from '../graphql/queries';

/** ~10s of history, the issue's own estimate — a few MB at 720p/30fps. */
const RING_CAPACITY_MS = 10_000;

/** How often `MediaRecorder` hands back a `Blob` — see this file's own
 * header docs for what this trades off against a frame-accurate cut. */
const RECORDER_TIMESLICE_MS = 250;

/** How often an RTT sample is taken, and how many are kept for the median
 * `../clipBounds.ts`'s `medianMs` reduces. */
const PING_INTERVAL_MS = 8000;
const MAX_RTT_SAMPLES = 8;

type UploadStatus = 'idle' | 'recording' | 'uploading' | 'uploaded' | 'discarded' | 'error';

const CANDIDATE_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return 'video/webm';
  }
  return CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
}

function extensionFor(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

function secondsAgo(fromMs: number | null, nowMs: number): string | null {
  if (fromMs === null) return null;
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (seconds < 1) return 'just now';
  if (seconds === 1) return '1s ago';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1m ago' : `${minutes}m ago`;
}

export default function Camera() {
  const { raceId: raceIdParam } = useParams<{ raceId: string }>();
  const raceId = parseInt(raceIdParam || '0');
  const [searchParams] = useSearchParams();
  const fake = searchParams.get('fake') === '1';

  const displayIdParam = searchParams.get('displayId');
  const thisDisplayId = useMemo(() => displayId(displayIdParam), [displayIdParam]);
  useEffect(() => startDeviceClaimHeartbeat(thisDisplayId), [thisDisplayId]);

  const [assignmentResult] = useSubscription({
    query: DisplayAssignmentSubscription,
    variables: { displayId: thisDisplayId, raceId, role: 'CAMERA' },
    pause: !raceId,
  });
  const assignment = assignmentResult.data?.displayAssignment ?? null;
  const identify = useIdentifyOverlay(assignment);

  const [{ data: configData }] = useQuery({ query: INITIAL_CONFIG_QUERY });
  const demoMode = configData?.initialConfig?.demoMode ?? false;

  const [{ data: tracksData }] = useQuery({ query: GET_TRACKS });
  const tracks: { id: number; name: string; timerType: string }[] = tracksData?.tracks ?? [];
  const trackId: number | null = assignment?.trackId ?? null;
  const selectedTrack = tracks.find((t) => t.id === trackId) ?? null;
  const [, setCameraTrack] = useMutation(SET_CAMERA_TRACK);

  const [{ data: timerData }] = useSubscription({
    query: TIMER_STATUS_SUBSCRIPTION,
    variables: { trackId: trackId ?? 0 },
    pause: !trackId,
  });
  const rawTransitions = timerData?.timerStatus?.status?.transitions;
  const transitions: Transition[] = useMemo(() => rawTransitions ?? [], [rawTransitions]);
  const transitionsRef = useRef(transitions);
  // Synced in an effect, never during render — React Compiler's own
  // `react-hooks/refs` rule forbids mutating a ref's `.current` mid-render,
  // and this ref only ever needs to hold the *latest* value for the async
  // upload work below to read, not the value as of this particular render.
  useEffect(() => {
    transitionsRef.current = transitions;
  }, [transitions]);

  const [{ data: timingData }] = useSubscription({
    query: TimingStatsSubscription,
    variables: { raceId },
    pause: !raceId,
  });

  const support = useMemo(() => cameraSupport(), []);
  const usable = fake || (support.webCodecs && support.secureContext && !demoMode);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ringRef = useRef(new RingBuffer<Blob>(RING_CAPACITY_MS));
  const recorderMimeRef = useRef<string>('video/webm');
  const rttSamplesRef = useRef<number[]>([]);
  const rttMedianRef = useRef(0);
  const selectedTrackRef = useRef(selectedTrack);
  useEffect(() => {
    selectedTrackRef.current = selectedTrack;
  }, [selectedTrack]);

  const [status, setStatus] = useState<UploadStatus>('idle');
  const [lastClipAt, setLastClipAt] = useState<number | null>(null);
  const [lastClipUrl, setLastClipUrl] = useState<string | null>(null);
  const [showReplayHere, setShowReplayHere] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const client = useClient();

  const [ringSpanSec, setRingSpanSec] = useState(0);

  // A one-second tick, purely for "last clip Ns ago" and the buffer span —
  // the same elapsed-wall-clock-time shape `standingsScroll.ts` uses rather
  // than a counter that could drift. `ringRef.current` is read here, inside
  // an effect, rather than during render — React Compiler's `react-hooks/
  // refs` rule forbids the latter.
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      setRingSpanSec(Math.round(ringRef.current.spanMs() / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Half the measured round trip, per the issue's own sync method. A plain
  // query is timed rather than a dedicated ping route — see
  // `graphql/queries.ts`'s own docs for why `version` is the right one to
  // time.
  useEffect(() => {
    if (!usable) return;
    let cancelled = false;
    const ping = async () => {
      const start = performance.now();
      try {
        await client.query(CAMERA_PING_QUERY, {}, { requestPolicy: 'network-only' }).toPromise();
      } catch {
        return;
      }
      if (cancelled) return;
      const rtt = performance.now() - start;
      const samples = rttSamplesRef.current;
      samples.push(rtt);
      if (samples.length > MAX_RTT_SAMPLES) samples.shift();
      rttMedianRef.current = medianMs(samples);
    };
    void ping();
    const id = window.setInterval(() => void ping(), PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [usable, client]);

  // The list of cameras this device can see, so a device with more than one
  // gets a picker — read once support is confirmed, since enumerating
  // devices before a permission prompt has fired reports no labels at all
  // on some browsers.
  useEffect(() => {
    if (!usable || fake) return;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'videoinput')))
      .catch(() => setDevices([]));
  }, [usable, fake]);

  // Capture itself: getUserMedia, a live preview, and MediaRecorder feeding
  // the ring buffer. Skipped entirely in fake mode or when this device/
  // context cannot support it.
  useEffect(() => {
    if (!usable || fake) return;
    // Captured once, here, rather than read again in the cleanup — the same
    // `RingBuffer` instance the whole component's life through, but the
    // linter cannot tell that from a plain `useRef` and warns about reading
    // `.current` in a cleanup that may run after it changed.
    const ring = ringRef.current;
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let cancelled = false;
    let lastChunkEndMs = Date.now();

    navigator.mediaDevices
      .getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
        const mimeType = pickMimeType();
        recorderMimeRef.current = mimeType;
        recorder = new MediaRecorder(s, { mimeType });
        lastChunkEndMs = Date.now();
        recorder.ondataavailable = (event) => {
          if (event.data.size === 0) return;
          const endMs = Date.now();
          ring.push({ startMs: lastChunkEndMs, endMs, data: event.data });
          lastChunkEndMs = endMs;
        };
        recorder.start(RECORDER_TIMESLICE_MS);
        setStatus('recording');
      })
      .catch(() => setStatus('error'));

    return () => {
      cancelled = true;
      recorder?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      ring.clear();
    };
  }, [usable, fake, deviceId]);

  const uploadClip = useCallback(
    async (args: {
      heatId: number;
      recordedAt: string;
      bounds: ClipBounds;
      blob: Blob;
      mimeType: string;
    }) => {
      setStatus('uploading');
      const attempt = () => {
        const form = new FormData();
        form.set('race_id', String(raceId));
        form.set('heat_id', String(args.heatId));
        form.set('recorded_at', args.recordedAt);
        form.set('camera_id', thisDisplayId);
        form.set('t0_offset_ms', String(Math.round(args.bounds.t0OffsetMs)));
        form.set('duration_ms', String(Math.round(args.bounds.endMs - args.bounds.startMs)));
        form.set('file', args.blob, `clip.${extensionFor(args.mimeType)}`);
        return fetch('/replay/', { method: 'POST', body: form });
      };

      let response: Response;
      try {
        response = await attempt();
      } catch {
        try {
          response = await attempt();
        } catch {
          setStatus('error');
          return;
        }
      }

      if (response.status === 409) {
        // The heat's result changed between capture and upload — discard,
        // per the issue's own rule. Not an error: the operator corrected a
        // time or re-ran the heat, and there is nothing left for this clip
        // to be a replay of.
        setStatus('discarded');
        return;
      }
      if (!response.ok) {
        // One retry on a genuine server/network hiccup, per the brief.
        try {
          response = await attempt();
        } catch {
          setStatus('error');
          return;
        }
        if (!response.ok) {
          setStatus('error');
          return;
        }
      }
      const body: { url: string } = await response.json();
      setLastClipUrl(body.url);
      setLastClipAt(Date.now());
      setStatus('uploaded');
    },
    [raceId, thisDisplayId],
  );

  type TimingStatsPayload = NonNullable<NonNullable<typeof timingData>['timingStats']>;

  const [seenHeatResult, setSeenHeatResult] = useState<SeenHeatResult>(null);
  // The result the "adjust state during render" block below has decided is
  // new and worth cutting a clip for — cleared once the effect that reads
  // it has started, so it never re-fires for the same result twice.
  const [pendingResult, setPendingResult] = useState<TimingStatsPayload | null>(null);
  const timingStats = timingData?.timingStats ?? null;

  // Adjust state during render — the exact `seen === null` edge-detector
  // `Observation.tsx`'s own "Sync results overlay state" block already uses
  // for `resultsOverlay.ts`, applied here to decide when a clip is worth
  // cutting rather than when to pop a banner. This may only ever call
  // `setState`, never read `Date.now()` or a ref — the actual capture work
  // below is deliberately a separate effect for that reason.
  if (usable && trackId && timingStats) {
    const observation = observeHeatResult(seenHeatResult, timingStats);
    if (observation.seen !== seenHeatResult) {
      setSeenHeatResult(observation.seen);
      if (observation.isNew) {
        setPendingResult(timingStats);
      }
    }
  }

  // The actual cut-and-upload, triggered by `pendingResult` above rather
  // than woven into the render-time comparison — this is where `Date.now()`
  // and the transitions/track refs are read, which only an effect may do.
  useEffect(() => {
    if (!pendingResult) return;
    const result = pendingResult;
    const laneTimesSec = (result.lanes ?? [])
      .map((l: { time?: number | null }) => l.time)
      .filter((t: number | null | undefined): t is number => typeof t === 'number' && t > 0);

    void (async () => {
      let bounds: ClipBounds;
      if (selectedTrackRef.current?.timerType === 'NONE') {
        bounds = noneFallbackBounds(Date.now());
      } else {
        const runningAt = latestRunningAt(transitionsRef.current);
        if (runningAt === null) return;
        bounds = timerSyncedBounds(correctedT0Ms(runningAt, rttMedianRef.current), laneTimesSec);
      }

      if (fake) {
        const res = await fetch('/fake-camera.webm');
        if (!res.ok) return;
        const blob = await res.blob();
        await uploadClip({
          heatId: result.heatId,
          recordedAt: result.recordedAt,
          bounds,
          blob,
          mimeType: 'video/webm',
        });
        return;
      }

      const chunks: RingChunk<Blob>[] = ringRef.current.covering(bounds.startMs, bounds.endMs);
      if (chunks.length === 0) return;
      const mimeType = recorderMimeRef.current;
      const blob = new Blob(chunks.map((c) => c.data), { type: mimeType });
      await uploadClip({ heatId: result.heatId, recordedAt: result.recordedAt, bounds, blob, mimeType });
    })();
  }, [pendingResult, fake, uploadClip]);

  if (!raceId) {
    return (
      <div className="container" style={{ padding: '20px' }}>
        <p>No race selected.</p>
      </div>
    );
  }

  if (demoMode) {
    return (
      <div className="container" style={{ padding: '20px', maxWidth: '640px' }}>
        <h1>Camera</h1>
        <p style={{ color: 'var(--text-muted-color)' }}>
          Cameras are off on the public demo — a clip upload writes a file to disk with no
          credential attached, the same reason photo uploads are refused here.
        </p>
      </div>
    );
  }

  if (!fake && support.secureContext === false) {
    return (
      <div className="container" style={{ padding: '20px', maxWidth: '640px' }}>
        <h1>Camera</h1>
        <p style={{ color: 'var(--error-color)' }}>{INSECURE_CONTEXT_MESSAGE}</p>
      </div>
    );
  }

  if (!fake && !support.webCodecs) {
    return (
      <div className="container" style={{ padding: '20px', maxWidth: '640px' }}>
        <h1>Camera</h1>
        <p style={{ color: 'var(--error-color)' }}>{WEBCODECS_MESSAGE}</p>
      </div>
    );
  }

  const lastClipText = secondsAgo(lastClipAt, now);
  const timerTypeNone = selectedTrack?.timerType === 'NONE';

  const STATUS_WORD: Record<UploadStatus, string | null> = {
    idle: null,
    recording: null,
    uploading: 'uploading…',
    uploaded: 'uploaded',
    discarded: 'discarded (the result changed before the clip finished uploading)',
    error: 'upload failed — will try again on the next result',
  };
  const statusWord = STATUS_WORD[status];

  const statusLine = trackId
    ? `Listening to ${selectedTrack?.name ?? 'this track'}'s timer` +
      (fake ? '' : ` · buffer ${ringSpanSec}s`) +
      (lastClipText ? ` · last clip ${lastClipText}` : '') +
      (timerTypeNone ? ' · no electronic timer — cutting a fixed clip around each result' : '') +
      (statusWord ? ` · ${statusWord}` : '')
    : 'Pick a track to start listening for its results.';

  return (
    <div className="container" style={{ padding: '20px', maxWidth: '640px' }}>
      <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {assignment?.name ?? 'Camera'}
      </h1>

      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Track
        <select
          aria-label="Which track this camera listens to"
          value={trackId ?? ''}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) setCameraTrack({ displayId: thisDisplayId, trackId: id });
          }}
          style={{
            display: 'block',
            marginTop: '0.3rem',
            padding: '0.4rem 0.6rem',
            borderRadius: '8px',
            border: '1px solid var(--input-border-color)',
            width: '100%',
          }}
        >
          <option value="">Choose a track…</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {devices.length > 1 && (
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          Camera
          <select
            aria-label="Which camera to use"
            value={deviceId ?? ''}
            onChange={(e) => setDeviceId(e.target.value || undefined)}
            style={{
              display: 'block',
              marginTop: '0.3rem',
              padding: '0.4rem 0.6rem',
              borderRadius: '8px',
              border: '1px solid var(--input-border-color)',
              width: '100%',
            }}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Camera'}
              </option>
            ))}
          </select>
        </label>
      )}

      {!fake && (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          data-testid="camera-preview"
          style={{ width: '100%', borderRadius: '12px', background: '#000', aspectRatio: '16 / 9' }}
        />
      )}

      <p data-testid="camera-status-line" style={{ margin: '0.75rem 0', color: 'var(--text-muted-color)' }}>
        {statusLine}
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="checkbox"
          checked={showReplayHere}
          onChange={(e) => setShowReplayHere(e.target.checked)}
        />
        Show the replay here too
      </label>

      {showReplayHere && lastClipUrl && (
        <video
          src={lastClipUrl}
          controls
          data-testid="camera-own-replay"
          style={{ width: '100%', marginTop: '0.75rem', borderRadius: '12px' }}
        />
      )}
    </div>
  );
}
