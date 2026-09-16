/**
 * What `/camera` needs from the browser, checked up front rather than
 * discovered mid-capture (#177 stage 1b).
 *
 * Two independent gates, each with its own honest message —
 * `.claude/rules/ops.md`'s own rule for `getUserMedia`'s insecure-context
 * case ("say what is being given up, rather than failing silently or
 * blaming permissions") applies here too.
 *
 * **`hasWebCodecs` checks both `VideoEncoder` and `MediaStreamTrackProcessor`
 * — the capture pipeline (`capture.ts`) genuinely needs both.** `VideoEncoder`
 * alone was the original check, back when this stage's capture pipeline was
 * `MediaRecorder` and the WebCodecs gate was a *proxy* for the right browser
 * matrix rather than a real prerequisite (see `capture.ts`'s own header for
 * why that version was replaced — it produced unplayable clips for nearly
 * every real capture). Now that capture genuinely goes through
 * `MediaStreamTrackProcessor` → `VideoFrame` → `VideoEncoder`, both have to
 * exist, and checking only one would pass a browser that has `VideoEncoder`
 * but not the insertable-streams API `MediaStreamTrackProcessor` belongs to.
 */

export interface CameraSupport {
  readonly webCodecs: boolean;
  readonly secureContext: boolean;
}

/** `VideoEncoder` and `MediaStreamTrackProcessor` — Chrome, Edge, Safari
 * 16.4+. Checked up front rather than letting capture fail silently
 * partway through a heat. */
export function hasWebCodecs(g: typeof globalThis = globalThis): boolean {
  const w = g as unknown as { VideoEncoder?: unknown; MediaStreamTrackProcessor?: unknown };
  return typeof w.VideoEncoder !== 'undefined' && typeof w.MediaStreamTrackProcessor !== 'undefined';
}

/**
 * Mirrors `CameraCapture.tsx`'s own rule: `window.isSecureContext === false`
 * only, never a bare `!isSecureContext` — a real browser always answers a
 * boolean, so this fires only on a genuine insecure origin (plain HTTP off
 * localhost, `TRUSTYTRACK_HTTP_ONLY`), never on a test environment that has
 * not implemented the property at all.
 */
export function isInsecureContext(w: { isSecureContext?: boolean } = window): boolean {
  return w.isSecureContext === false;
}

export function cameraSupport(
  g: typeof globalThis = globalThis,
  w: { isSecureContext?: boolean } = window,
): CameraSupport {
  return {
    webCodecs: hasWebCodecs(g),
    secureContext: !isInsecureContext(w),
  };
}

export const WEBCODECS_MESSAGE = 'Use Chrome, Edge or Safari 16.4+ on this device.';

/** Named after the environment variable `.claude/rules/ops.md` documents,
 * so a volunteer reading this message and that page's HTTPS section can
 * match the two up. */
export const INSECURE_CONTEXT_MESSAGE =
  "Trusty Track can't reach this device's camera over plain HTTP. Open this page on the " +
  'computer running the server, or turn HTTPS back on (unset TRUSTYTRACK_HTTP_ONLY).';
