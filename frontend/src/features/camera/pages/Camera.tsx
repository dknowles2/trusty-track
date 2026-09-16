/**
 * `/race/:raceId/camera` — a device with a camera, registered the way a
 * display is (#177 stage 1b).
 *
 * **Capture is WebCodecs, as the issue specifies** — `MediaStreamTrackProcessor`
 * → `VideoEncoder` → a keyframe-aware ring (`../capture.ts`, `../ring.ts`) →
 * a real WebM mux (`../mux.ts`). An earlier version of this file used
 * `MediaRecorder` instead, reasoning that a `VideoEncoder` pipeline needed a
 * muxer this tree did not have; that version shipped a correctness bug a
 * review caught before merge, not just an accepted trade-off. `MediaRecorder`
 * emits its container header only in the *first* timesliced `Blob` of a
 * recording session, and the ring's own age-based eviction discarded that
 * first chunk like any other once a session ran longer than the ring's
 * ~10s capacity — which every real capture does, since a camera is opened
 * and aimed well before the first heat and left running for the length of
 * the event. Every clip cut after that point was built from headerless
 * fragments with nothing for a decoder to configure itself from: not a
 * `<video>`-playable file, for nearly all real-world usage. See
 * `../capture.ts`'s and `../ring.ts`'s own headers for the fix in full, and
 * `../mux.ts`'s for why a real muxer removes the "does the container have a
 * header" question from this file's own problem entirely.
 *
 * **`FakeCamera` (`?fake=1`) goes through this exact same pipeline.** The
 * `MediaRecorder` version's fake path was a plain `fetch` of a canned file,
 * bypassing capture entirely — which is how the header/eviction bug above
 * shipped with `instantReplay.spec.ts` fully green: the path under
 * automated test was never the path a real capture actually took. Fake mode
 * now differs only in *where the `MediaStreamTrack` comes from*
 * (`../capture.ts`'s `fakeCameraTrack`, a looping `<video>` of
 * `fake-camera.webm` captured off an offscreen `<canvas>`) — the encode,
 * ring, cut, mux and upload code after that point is identical, so this is
 * what the functional and docs e2e specs actually exercise.
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
import { RingBuffer } from '../ring';
import {
  fakeCameraTrack,
  startCapture,
  type CaptureHandle,
  type EncodedFrame,
  type VideoTrackInfo,
} from '../capture';
import { muxChunks } from '../mux';
import { CAMERA_PING_QUERY } from '../graphql/queries';

/** ~10s of history, the issue's own estimate — a few MB at 720p/30fps. */
const RING_CAPACITY_MS = 10_000;

/** How often an RTT sample is taken, and how many are kept for the median
 * `../clipBounds.ts`'s `medianMs` reduces. */
const PING_INTERVAL_MS = 8000;
const MAX_RTT_SAMPLES = 8;

type UploadStatus = 'idle' | 'recording' | 'uploading' | 'uploaded' | 'discarded' | 'error';

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
  // A test-only override, read once at mount — `instantReplay.spec.ts`'s own
  // post-eviction case wants to prove a cut still works once the ring has
  // aged past its original opening keyframe, and waiting out a real 10s
  // window on every run costs real wall-clock time and real CPU (the ring
  // keeps encoding the whole time) across a shard already running the rest
  // of the functional suite alongside it. Shrinking the window is the same
  // proof at a fraction of the cost; a real camera never sets this.
  const ringCapacityOverrideMs = Number(searchParams.get('ringMs')) || undefined;

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
  const ringRef = useRef(new RingBuffer<EncodedFrame>(ringCapacityOverrideMs ?? RING_CAPACITY_MS));
  const videoTrackInfoRef = useRef<VideoTrackInfo | null>(null);
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

  // Capture itself: a real `getUserMedia` track or `FakeCamera`'s
  // canvas-captured one, both fed into the identical WebCodecs pipeline —
  // see this file's own header for why that unification matters. Skipped
  // entirely when this device/context cannot support it.
  useEffect(() => {
    if (!usable) return;
    // Captured once, here, rather than read again in the cleanup — the same
    // `RingBuffer` instance the whole component's life through, but the
    // linter cannot tell that from a plain `useRef` and warns about reading
    // `.current` in a cleanup that may run after it changed.
    const ring = ringRef.current;
    let cancelled = false;
    let mediaStream: MediaStream | null = null;
    let fakeSource: { track: MediaStreamTrack; stop: () => void } | null = null;
    let captureHandle: CaptureHandle | null = null;

    void (async () => {
      try {
        let track: MediaStreamTrack;
        if (fake) {
          fakeSource = await fakeCameraTrack();
          track = fakeSource.track;
        } else {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: deviceId ? { deviceId: { exact: deviceId } } : true,
            audio: false,
          });
          if (cancelled) {
            mediaStream.getTracks().forEach((t) => t.stop());
            return;
          }
          if (videoRef.current) videoRef.current.srcObject = mediaStream;
          [track] = mediaStream.getVideoTracks();
        }
        if (cancelled) {
          fakeSource?.stop();
          return;
        }
        captureHandle = await startCapture(track, ring, (error) => {
          // The one place a capture failure is surfaced beyond the status
          // line, which only has room for "error".
          console.error('Camera capture error', error);
        });
        videoTrackInfoRef.current = captureHandle.track;
        if (!cancelled) setStatus('recording');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      void captureHandle?.stop();
      mediaStream?.getTracks().forEach((t) => t.stop());
      fakeSource?.stop();
      ring.clear();
      videoTrackInfoRef.current = null;
    };
  }, [usable, fake, deviceId]);

  const uploadClip = useCallback(
    async (args: { heatId: number; recordedAt: string; bounds: ClipBounds; blob: Blob }) => {
      setStatus('uploading');
      const attempt = () => {
        const form = new FormData();
        form.set('race_id', String(raceId));
        form.set('heat_id', String(args.heatId));
        form.set('recorded_at', args.recordedAt);
        form.set('camera_id', thisDisplayId);
        form.set('t0_offset_ms', String(Math.round(args.bounds.t0OffsetMs)));
        form.set('duration_ms', String(Math.round(args.bounds.endMs - args.bounds.startMs)));
        form.set('file', args.blob, 'clip.webm');
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
  // Real and fake capture share this one path entirely (see this file's own
  // header) — there is no longer a `fake` branch here at all.
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
      const t0Ms = bounds.startMs + bounds.t0OffsetMs;

      const trackInfo = videoTrackInfoRef.current;
      if (!trackInfo) return;

      // The ring's own keyframe-aware cut — see `ring.ts`'s own header for
      // why this, not `bounds.startMs`/`bounds.endMs` verbatim, is what a
      // valid clip actually needs.
      const chunks = ringRef.current.coveringFromKeyframe(bounds.startMs, bounds.endMs);
      if (chunks.length === 0) return;

      const blob = muxChunks(chunks, trackInfo);
      // The muxed clip's own first chunk is very often earlier than the
      // originally requested `bounds.startMs` (it had to start on a
      // keyframe) — `t0OffsetMs` is recomputed against wherever the file
      // actually begins, not the request.
      const actualStartMs = chunks[0].startMs;
      const actualEndMs = chunks[chunks.length - 1].endMs;
      const adjustedBounds: ClipBounds = {
        startMs: actualStartMs,
        endMs: actualEndMs,
        t0OffsetMs: t0Ms - actualStartMs,
      };
      await uploadClip({
        heatId: result.heatId,
        recordedAt: result.recordedAt,
        bounds: adjustedBounds,
        blob,
      });
    })();
  }, [pendingResult, uploadClip]);

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
