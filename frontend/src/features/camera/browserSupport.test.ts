import { describe, expect, it } from 'vitest';
import { cameraSupport, hasWebCodecs, isInsecureContext } from './browserSupport';

describe('hasWebCodecs', () => {
  it('is true when both VideoEncoder and MediaStreamTrackProcessor exist on the global', () => {
    expect(
      hasWebCodecs({
        VideoEncoder: class {},
        MediaStreamTrackProcessor: class {},
      } as unknown as typeof globalThis),
    ).toBe(true);
  });

  it('is false when both are absent — Firefox', () => {
    expect(hasWebCodecs({} as unknown as typeof globalThis)).toBe(false);
  });

  it('is false when only VideoEncoder exists — the capture pipeline needs MediaStreamTrackProcessor too', () => {
    expect(hasWebCodecs({ VideoEncoder: class {} } as unknown as typeof globalThis)).toBe(false);
  });

  it('is false when only MediaStreamTrackProcessor exists', () => {
    expect(
      hasWebCodecs({ MediaStreamTrackProcessor: class {} } as unknown as typeof globalThis),
    ).toBe(false);
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

describe('cameraSupport', () => {
  it('combines both checks', () => {
    const support = cameraSupport(
      { VideoEncoder: class {}, MediaStreamTrackProcessor: class {} } as unknown as typeof globalThis,
      { isSecureContext: true },
    );
    expect(support).toEqual({ webCodecs: true, secureContext: true });
  });

  it('reports an insecure, unsupported browser correctly', () => {
    const support = cameraSupport({} as unknown as typeof globalThis, { isSecureContext: false });
    expect(support).toEqual({ webCodecs: false, secureContext: false });
  });
});
