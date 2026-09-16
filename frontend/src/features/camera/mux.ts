/**
 * Wrapping a cut set of encoded chunks into a real, seekable WebM file
 * (#177 stage 1b, revised after review) — the half of the fix that lives
 * outside `capture.ts`/`ring.ts`.
 *
 * `webm-muxer` (MIT, `Vanilagy/webm-muxer`) writes an ordinary EBML/Segment/
 * Tracks header once, from the video track's own declared codec and
 * dimensions, and a Cues element for seeking — every finalized file is
 * self-sufficient, regardless of which raw `EncodedVideoChunk` bytes were
 * fed into it. That is the property `MediaRecorder`'s own blob-per-slice
 * output never had (the header lived *inside* the first data chunk, not
 * written fresh per output) and is what let this stage move the "does the
 * container have a header" problem out of `ring.ts` entirely — `ring.ts`'s
 * own `coveringFromKeyframe` only has to find a valid *decode* starting
 * point (a keyframe), not worry about which of the retained chunks happens
 * to carry a container header, because none of them do and none of them
 * need to.
 *
 * `addVideoChunkRaw` rather than reconstructing real `EncodedVideoChunk`
 * objects from `capture.ts`'s own copied bytes — the muxer only reads the
 * bytes, the type and the timestamp, and `EncodedFrame` already carries all
 * three untouched from the encoder's own output callback.
 */

import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import type { RingChunk } from './ring';
import type { EncodedFrame, VideoTrackInfo } from './capture';

/**
 * @param chunks the ring's own `coveringFromKeyframe` result — oldest
 *   (a keyframe) first. Never called with an empty array; the caller's job
 *   to decide there is nothing to upload.
 */
export function muxChunks(chunks: readonly RingChunk<EncodedFrame>[], track: VideoTrackInfo): Blob {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: track.codec, width: track.width, height: track.height, frameRate: track.frameRate },
    // The ring's own timestamps are the encoder's absolute, since-the-track-
    // opened microseconds — never 0 at the cut point. `'offset'` is exactly
    // the case this option exists for (`webm-muxer`'s own doc comment: "when
    // directly pumping video frames ... from a MediaTrackStream"): it rebases
    // every chunk in this file by the first one's own timestamp, so the
    // muxed file itself still starts at 0 the way a decoder expects.
    firstTimestampBehavior: 'offset',
  });

  for (const chunk of chunks) {
    muxer.addVideoChunkRaw(chunk.data.data, chunk.data.isKeyframe ? 'key' : 'delta', chunk.data.timestampUs);
  }
  muxer.finalize();

  return new Blob([target.buffer], { type: 'video/webm' });
}
