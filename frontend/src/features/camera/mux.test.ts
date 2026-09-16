import { describe, expect, it } from 'vitest';
import { muxChunks } from './mux';
import type { RingChunk } from './ring';
import type { EncodedFrame, VideoTrackInfo } from './capture';

const TRACK: VideoTrackInfo = { codec: 'V_VP8', width: 320, height: 240, frameRate: 15 };

function frame(startMs: number, endMs: number, isKeyframe: boolean, timestampUs: number): RingChunk<EncodedFrame> {
  // A handful of non-zero bytes stands in for real encoded VP8 data — the
  // muxer treats it as opaque, so its own content never matters here, only
  // that it round-trips into the file untouched.
  const data = new Uint8Array([startMs % 256, endMs % 256, isKeyframe ? 1 : 0]);
  return { startMs, endMs, isKeyframe, data: { data, isKeyframe, timestampUs } };
}

describe('muxChunks', () => {
  it('produces a non-empty video/webm blob', () => {
    const chunks = [frame(0, 33, true, 0), frame(33, 66, false, 33_000)];
    const blob = muxChunks(chunks, TRACK);
    expect(blob.type).toBe('video/webm');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('writes a real WebM/EBML header — this is the property MediaRecorder concatenation never had', async () => {
    const chunks = [frame(0, 33, true, 0), frame(33, 66, false, 33_000)];
    const blob = muxChunks(chunks, TRACK);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // The EBML magic number every Matroska/WebM file starts with.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it('writes a real header even when every chunk timestamp is far from zero', async () => {
    // The exact shape a ring cut produces: absolute encoder timestamps from
    // deep into a long recording session, not timestamps starting at 0.
    // `firstTimestampBehavior: 'offset'` is what makes this still produce a
    // valid file — this is the regression case for a muxer configured
    // without it (or for hand-rolled concatenation, which had no timestamp
    // handling at all).
    const chunks = [
      frame(30_000, 30_033, true, 30_000_000),
      frame(30_033, 30_066, false, 30_033_000),
    ];
    const blob = muxChunks(chunks, TRACK);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('grows with more chunks', () => {
    const one = muxChunks([frame(0, 33, true, 0)], TRACK);
    const three = muxChunks(
      [frame(0, 33, true, 0), frame(33, 66, false, 33_000), frame(66, 99, false, 66_000)],
      TRACK,
    );
    expect(three.size).toBeGreaterThan(one.size);
  });
});
