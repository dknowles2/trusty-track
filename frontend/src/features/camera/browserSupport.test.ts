import { describe, expect, it } from 'vitest';
import {
  cameraSupport,
  hasTrackProcessor,
  hasVideoEncoder,
  IOS_NEEDS_UPDATE_MESSAGE,
  isAppleWebKit,
  isInsecureContext,
  isIOS,
  WEBCODECS_MESSAGE,
  webCodecsMessage,
} from './browserSupport';

// Real UA strings, one per platform combination this file's own comments
// reason about — `isIOS`/`isAppleWebKit`'s whole point is that a brand
// marker embedded in an iOS UA (`CriOS`, `EdgiOS`) cannot be trusted the
// same way a desktop one can, so the matrix below exercises exactly the
// browsers named there rather than synthetic strings that beg the question.
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.80 Mobile/15E148 Safari/604.1';
const IPHONE_EDGE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 EdgiOS/124.2478.97 Mobile/15E148 Safari/604.1';
// A legacy-shape iPad UA (explicit "iPad" token) — real for a pre-iPadOS 13
// device, and still worth covering since an old embedded webview or an
// operator's own ancient hardware can still send it.
const IPAD_LEGACY_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const DESKTOP_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
// Since iPadOS 13 (2019), Safari on iPad sends this exact desktop-class UA
// by default — byte-identical in shape to `DESKTOP_SAFARI` above, with no
// "iPad" token anywhere. `IPAD_MODERN_NAV`'s `maxTouchPoints` is the only
// signal that tells the two apart (a real Mac reports 0, an iPad reports 5)
// — see `isIOS`'s own doc comment.
const IPAD_MODERN_UA = DESKTOP_SAFARI;
const IPAD_MODERN_NAV = { platform: 'MacIntel', maxTouchPoints: 5 };
const DESKTOP_MAC_NAV = { platform: 'MacIntel', maxTouchPoints: 0 };
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DESKTOP_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';

describe('hasVideoEncoder', () => {
  it('is true when VideoEncoder exists on the global', () => {
    expect(hasVideoEncoder({ VideoEncoder: class {} } as unknown as typeof globalThis)).toBe(true);
  });

  it('is false when absent — Firefox, or an old browser of any kind', () => {
    expect(hasVideoEncoder({} as unknown as typeof globalThis)).toBe(false);
  });
});

describe('hasTrackProcessor', () => {
  it('is true when MediaStreamTrackProcessor exists on the global', () => {
    expect(
      hasTrackProcessor({ MediaStreamTrackProcessor: class {} } as unknown as typeof globalThis),
    ).toBe(true);
  });

  it('is false when absent — every WebKit build, mobile or desktop', () => {
    expect(hasTrackProcessor({} as unknown as typeof globalThis)).toBe(false);
  });
});

describe('isIOS', () => {
  it.each([
    ['iPhone Safari', IPHONE_SAFARI],
    ['iPhone Chrome (CriOS)', IPHONE_CHROME],
    ['iPhone Edge (EdgiOS)', IPHONE_EDGE],
    ['iPad Safari, legacy UA shape (explicit "iPad" token)', IPAD_LEGACY_SAFARI],
  ])('is true for %s, off the UA alone', (_name, ua) => {
    expect(isIOS(ua)).toBe(true);
  });

  it('is true for a real iPad running iPadOS 13+ — a desktop-class UA with no "iPad" token, told apart from a real Mac only by navigator.maxTouchPoints', () => {
    expect(isIOS(IPAD_MODERN_UA, IPAD_MODERN_NAV)).toBe(true);
  });

  it.each([
    ['desktop Safari', DESKTOP_SAFARI],
    ['desktop Chrome', DESKTOP_CHROME],
    ['desktop Edge', DESKTOP_EDGE],
    ['Android Chrome', ANDROID_CHROME],
    ['desktop Firefox', DESKTOP_FIREFOX],
  ])('is false for %s', (_name, ua) => {
    expect(isIOS(ua)).toBe(false);
  });

  it('is false for a real Mac (MacIntel, no touchscreen) even though the platform check alone would be ambiguous', () => {
    expect(isIOS(DESKTOP_SAFARI, DESKTOP_MAC_NAV)).toBe(false);
  });
});

describe('isAppleWebKit', () => {
  it.each([
    ['iPhone Safari', IPHONE_SAFARI],
    // The whole reason isIOS is checked independently of the desktop
    // exclusion below: these two would otherwise read as "not WebKit-only"
    // because their own UA carries a rebadged browser's brand marker.
    ['iPhone Chrome (CriOS)', IPHONE_CHROME],
    ['iPhone Edge (EdgiOS)', IPHONE_EDGE],
    ['iPad Safari, legacy UA shape', IPAD_LEGACY_SAFARI],
    ['desktop Safari', DESKTOP_SAFARI],
  ])('is true for %s', (_name, ua) => {
    expect(isAppleWebKit(ua)).toBe(true);
  });

  it('is true for a real iPad running iPadOS 13+ (desktop-class UA, told apart by maxTouchPoints)', () => {
    expect(isAppleWebKit(IPAD_MODERN_UA, IPAD_MODERN_NAV)).toBe(true);
  });

  it.each([
    ['desktop Chrome', DESKTOP_CHROME],
    ['desktop Edge', DESKTOP_EDGE],
    ['Android Chrome', ANDROID_CHROME],
    ['desktop Firefox', DESKTOP_FIREFOX],
  ])('is false for %s', (_name, ua) => {
    expect(isAppleWebKit(ua)).toBe(false);
  });
});

describe('isInsecureContext', () => {
  it('is true only for an explicit false, mirroring CameraCapture.tsx', () => {
    expect(isInsecureContext({ isSecureContext: false })).toBe(true);
  });

  it('is false for an explicit true', () => {
    expect(isInsecureContext({ isSecureContext: true })).toBe(false);
  });

  it('is false when the property does not exist at all — a test environment', () => {
    expect(isInsecureContext({})).toBe(false);
  });
});

describe('webCodecsMessage', () => {
  const withoutEncoder = {} as unknown as typeof globalThis;
  const withEncoderNoProcessor = { VideoEncoder: class {} } as unknown as typeof globalThis;
  const withBoth = {
    VideoEncoder: class {},
    MediaStreamTrackProcessor: class {},
  } as unknown as typeof globalThis;

  it('is the iOS-specific message on an iPhone with no VideoEncoder — never names Chrome or Edge', () => {
    const message = webCodecsMessage(withoutEncoder, IPHONE_SAFARI);
    expect(message).toBe(IOS_NEEDS_UPDATE_MESSAGE);
    expect(message).not.toMatch(/Chrome|Edge/);
  });

  it('is the iOS-specific message on an iPhone running Chrome with no VideoEncoder — the UA names Chrome, but switching to it changes nothing on iOS', () => {
    expect(webCodecsMessage(withoutEncoder, IPHONE_CHROME)).toBe(IOS_NEEDS_UPDATE_MESSAGE);
  });

  it('is the iOS-specific message on a legacy-UA iPad with no VideoEncoder', () => {
    expect(webCodecsMessage(withoutEncoder, IPAD_LEGACY_SAFARI)).toBe(IOS_NEEDS_UPDATE_MESSAGE);
  });

  it('is the iOS-specific message on a real iPadOS 13+ iPad with no VideoEncoder — the desktop-class UA alone would say "Use Chrome, Edge or Safari" to a device where that is exactly #1294\'s self-contradiction', () => {
    const message = webCodecsMessage(withoutEncoder, IPAD_MODERN_UA, IPAD_MODERN_NAV);
    expect(message).toBe(IOS_NEEDS_UPDATE_MESSAGE);
    expect(message).not.toMatch(/Chrome|Edge/);
  });

  it('is null on an iPhone that has VideoEncoder but not MediaStreamTrackProcessor — capture.ts\'s fallback covers it', () => {
    expect(webCodecsMessage(withEncoderNoProcessor, IPHONE_SAFARI)).toBeNull();
  });

  it('is null on an iPhone with both — the ordinary processor path', () => {
    expect(webCodecsMessage(withBoth, IPHONE_SAFARI)).toBeNull();
  });

  it('is the generic message on a non-Apple desktop browser with no VideoEncoder', () => {
    expect(webCodecsMessage(withoutEncoder, DESKTOP_CHROME)).toBe(WEBCODECS_MESSAGE);
  });

  it('is the generic message on desktop Safari with no VideoEncoder — not the iOS wording', () => {
    expect(webCodecsMessage(withoutEncoder, DESKTOP_SAFARI)).toBe(WEBCODECS_MESSAGE);
  });

  it('is null on desktop Safari with VideoEncoder but no MediaStreamTrackProcessor — the same fallback applies there too', () => {
    expect(webCodecsMessage(withEncoderNoProcessor, DESKTOP_SAFARI)).toBeNull();
  });

  it('is the generic message on Firefox with no VideoEncoder', () => {
    expect(webCodecsMessage(withoutEncoder, DESKTOP_FIREFOX)).toBe(WEBCODECS_MESSAGE);
  });

  it('is null wherever VideoEncoder exists, regardless of the processor', () => {
    expect(webCodecsMessage(withBoth, DESKTOP_CHROME)).toBeNull();
    expect(webCodecsMessage(withEncoderNoProcessor, ANDROID_CHROME)).toBeNull();
  });
});

describe('cameraSupport', () => {
  it('combines all three checks', () => {
    const support = cameraSupport(
      { VideoEncoder: class {}, MediaStreamTrackProcessor: class {} } as unknown as typeof globalThis,
      { isSecureContext: true },
      DESKTOP_CHROME,
    );
    expect(support).toEqual({ webCodecs: true, secureContext: true, message: null });
  });

  it('reports an insecure, unsupported browser correctly, with the iOS message on an iPhone', () => {
    const support = cameraSupport({} as unknown as typeof globalThis, { isSecureContext: false }, IPHONE_SAFARI);
    expect(support).toEqual({
      webCodecs: false,
      secureContext: false,
      message: IOS_NEEDS_UPDATE_MESSAGE,
    });
  });

  it('is usable (message null) on an iPhone missing only MediaStreamTrackProcessor', () => {
    const support = cameraSupport(
      { VideoEncoder: class {} } as unknown as typeof globalThis,
      { isSecureContext: true },
      IPHONE_SAFARI,
    );
    expect(support.message).toBeNull();
  });

  it('gives a real iPadOS 13+ iPad the iOS message, not the generic one, when VideoEncoder is missing', () => {
    const support = cameraSupport(
      {} as unknown as typeof globalThis,
      { isSecureContext: true },
      IPAD_MODERN_UA,
      IPAD_MODERN_NAV,
    );
    expect(support.message).toBe(IOS_NEEDS_UPDATE_MESSAGE);
  });
});
