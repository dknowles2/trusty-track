/**
 * What `/camera` needs from the browser, checked up front rather than
 * discovered mid-capture (#177 stage 1b; the message split below is
 * #1294).
 *
 * Two independent gates, each with its own honest message —
 * `.claude/rules/ops.md`'s own rule for `getUserMedia`'s insecure-context
 * case ("say what is being given up, rather than failing silently or
 * blaming permissions") applies here too.
 *
 * **`VideoEncoder` is the only thing capture genuinely cannot work
 * around.** `MediaStreamTrackProcessor` used to be checked alongside it —
 * WebKit has never shipped the insertable-streams API that belongs to, on
 * iOS or on desktop, so that combined check refused every WebKit browser
 * outright and told an iPhone user already in Chrome to "use Chrome, Edge
 * or Safari 16.4+" ([#1294](https://github.com/dknowles2/trusty-track/issues/1294)):
 * self-contradictory (they *were* in Chrome), and wrong regardless of which
 * browser they tried next, since every browser on iOS is WebKit under its
 * own skin. `capture.ts`'s canvas-drawn `VideoFrame` fallback
 * (`frameSourceFor`) now covers a missing `MediaStreamTrackProcessor`
 * unconditionally, so this file no longer refuses on it — `hasTrackProcessor`
 * is still exported, for a test that wants to assert on the raw signal, but
 * nothing here gates on it.
 */

export interface CameraSupport {
  readonly webCodecs: boolean;
  readonly secureContext: boolean;
  /** The message to show in place of the camera controls, or `null` once
   * this device/browser can capture — through `MediaStreamTrackProcessor`
   * or `capture.ts`'s own fallback. `Camera.tsx` renders this verbatim;
   * nothing else decides what an operator actually sees. */
  readonly message: string | null;
}

/** The one thing capture cannot work around — see this file's own header. */
export function hasVideoEncoder(g: typeof globalThis = globalThis): boolean {
  const w = g as unknown as { VideoEncoder?: unknown };
  return typeof w.VideoEncoder !== 'undefined';
}

/** Never gates the page by itself any more (see this file's own header) —
 * kept as its own signal because `capture.ts` still branches on it (to pick
 * a frame source) and a test may want to assert on it directly, independent
 * of what message, if any, that produces. */
export function hasTrackProcessor(g: typeof globalThis = globalThis): boolean {
  const w = g as unknown as { MediaStreamTrackProcessor?: unknown };
  return typeof w.MediaStreamTrackProcessor !== 'undefined';
}

/** True on iPhone, iPad or iPod — checked on the OS token directly, not by
 * excluding other browsers' brand markers the way `isAppleWebKit` below
 * does for desktop. iOS Chrome's UA carries `CriOS`, not `Chrome`, and iOS
 * Edge's carries `EdgiOS` — which itself contains the literal substring
 * `Edg` — so a desktop-style "AppleWebKit and not {Chrome,Edge}" exclusion
 * cannot be trusted to say anything about which browser is running on iOS;
 * the OS token is the one signal that holds regardless of which browser
 * brought you here. */
export function isIOS(ua: string = navigator.userAgent): boolean {
  return /iP(hone|ad|od)/.test(ua);
}

/** True for desktop Safari (`AppleWebKit`, and none of the other engines
 * that also carry that token in their own UA) or for iOS in general
 * (`isIOS`, above — every iOS browser is WebKit, whatever it calls itself).
 * This has no feature-detectable signal of its own — WebKit's absence of
 * `MediaStreamTrackProcessor` already *is* the feature signal, read via
 * `hasTrackProcessor` — so this exists only to choose *wording*: whether a
 * missing `VideoEncoder` should say "update iOS" (where switching browsers
 * changes nothing) or name Chrome/Edge as real alternatives (where it
 * does). */
export function isAppleWebKit(ua: string = navigator.userAgent): boolean {
  const isDesktopSafari = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  return isDesktopSafari || isIOS(ua);
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

/** iOS with no `VideoEncoder` at all — never names Chrome or Edge, since on
 * iOS every browser is WebKit and switching between them changes nothing;
 * the only real fix is a newer OS. */
export const IOS_NEEDS_UPDATE_MESSAGE =
  'Instant replay needs a newer iOS — update iOS and try again in Safari.';

/** Every other browser with no `VideoEncoder`. Naming Safari 16.4+ here is
 * honest again once `capture.ts`'s fallback exists: a `MediaStreamTrackProcessor`
 * gap used to make that claim false for every WebKit build regardless of
 * version, and now does not. */
export const WEBCODECS_MESSAGE = 'Use Chrome, Edge or Safari 16.4+ on this device.';

/** Named after the environment variable `.claude/rules/ops.md` documents,
 * so a volunteer reading this message and that page's HTTPS section can
 * match the two up. */
export const INSECURE_CONTEXT_MESSAGE =
  "Trusty Track can't reach this device's camera over plain HTTP. Open this page on the " +
  'computer running the server, or turn HTTPS back on (unset TRUSTYTRACK_HTTP_ONLY).';

/**
 * The one honest message for this device, or `null` once capture can
 * proceed — through the processor path or `capture.ts`'s canvas fallback.
 * `MediaStreamTrackProcessor`'s own absence never reaches this function at
 * all: it is not a gate any more, see this file's own header.
 */
export function webCodecsMessage(
  g: typeof globalThis = globalThis,
  ua: string = navigator.userAgent,
): string | null {
  if (hasVideoEncoder(g)) return null;
  return isIOS(ua) ? IOS_NEEDS_UPDATE_MESSAGE : WEBCODECS_MESSAGE;
}

export function cameraSupport(
  g: typeof globalThis = globalThis,
  w: { isSecureContext?: boolean } = window,
  ua: string = navigator.userAgent,
): CameraSupport {
  return {
    webCodecs: hasVideoEncoder(g),
    secureContext: !isInsecureContext(w),
    message: webCodecsMessage(g, ua),
  };
}
