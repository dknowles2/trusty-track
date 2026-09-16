/**
 * What `/camera` needs from the browser, checked up front rather than
 * discovered mid-capture (#177 stage 1b).
 *
 * Two independent gates, each with its own honest message —
 * `.claude/rules/ops.md`'s own rule for `getUserMedia`'s insecure-context
 * case ("say what is being given up, rather than failing silently or
 * blaming permissions") applies here too.
 *
 * **Gated on `WebCodecs` presence even though the capture pipeline itself
 * goes through `MediaRecorder`, not `VideoEncoder`** — see `Camera.tsx`'s
 * own module docs for the muxing trade-off this stage makes. `WebCodecs`
 * support is kept as the gate because it is a reliable proxy for the exact
 * browser matrix the issue names (Chrome, Edge, Safari 16.4+) and excludes
 * the one browser the issue calls out by name (Firefox, which lacks both
 * `WebCodecs` and a `MediaRecorder` implementation this stage has verified
 * produces a webm a `<video>` element seeks cleanly) — not because this
 * stage's own encode step reads a single `VideoEncoder` API.
 */

export interface CameraSupport {
  readonly webCodecs: boolean;
  readonly secureContext: boolean;
}

/** `VideoEncoder`/`MediaStreamTrackProcessor` — Chrome, Edge, Safari 16.4+.
 * Checked up front rather than letting capture fail silently partway
 * through a heat. */
export function hasWebCodecs(g: typeof globalThis = globalThis): boolean {
  return typeof (g as unknown as { VideoEncoder?: unknown }).VideoEncoder !== 'undefined';
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
