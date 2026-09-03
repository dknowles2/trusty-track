import { useRef, useEffect, useState } from 'react';
import ImageCropModal from './ImageCropModal';

interface CameraCaptureProps {
    onCapture: (file: File) => void;
    onClose: () => void;
    /**
     * Locked target aspect ratio for the crop step that follows a capture —
     * `PORTRAIT_ASPECT` for a racer's own portrait, `CAR_ASPECT` for a car
     * photo (#619). Different callers photograph different things, so this
     * is the caller's call rather than something guessed here.
     */
    aspect: number;
}

/**
 * A photo taken here has always gone straight from the webcam frame to
 * `onCapture`, with no chance to straighten or centre it — the messy-photo
 * problem #619 exists to fix. `handleCapture` now only lifts the raw frame
 * onto a canvas; `ImageCropModal` (#619 stage 1) is what turns that into the
 * rotated, cropped result `onCapture` actually receives. The live camera
 * stream is left running while the crop step is up — nothing here stops it —
 * so cancelling the crop returns to the same viewfinder rather than
 * re-requesting the camera.
 */
export default function CameraCapture({ onCapture, onClose, aspect }: CameraCaptureProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [error, setError] = useState<string>('');
    const streamRef = useRef<MediaStream | null>(null);
    // The raw captured frame, waiting to be rotated and cropped. Set means
    // "show the crop step instead of the viewfinder" — the video element
    // unmounts while this is set, so the crop modal (its own full-screen
    // overlay) is not competing with the viewfinder's for the top of the
    // stack. The `ref` callback below reattaches the still-live stream when
    // the video element remounts on cancel.
    const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);

    useEffect(() => {
        const startCamera = async () => {
            // `navigator.mediaDevices` does not exist at all outside a secure
            // context (https:// or localhost), so calling straight into it
            // throws a bare TypeError that reads, to a volunteer, exactly
            // like a permissions problem — the wrong thing to go troubleshoot
            // when the actual cause is TRUSTYTRACK_HTTP_ONLY or a second
            // device reached by plain http://<lan-ip>. Checked against
            // `=== false` rather than falsy: a real browser always reports a
            // boolean here, and only an explicit `false` is worth a
            // different message than the ordinary permissions one below.
            if (window.isSecureContext === false) {
                setError(
                    'The camera needs a secure connection. Open Trusty Track on ' +
                        'the computer running the server, or switch HTTPS back on.',
                );
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' } // Prefer back camera on mobile
                });
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error("Error accessing camera:", err);
                setError("Could not access camera. Please ensure permissions are granted.");
            }
        };

        startCamera();

        return () => {
            // Cleanup stream
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const handleCapture = () => {
        if (!videoRef.current) return;

        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0);

        // An intermediate frame, not the final upload — `ImageCropModal`
        // re-encodes whatever the operator confirms, downscaled, at its own
        // quality setting. This capture just needs to survive the round trip
        // to an `<img>` and back onto a canvas.
        setCapturedDataUrl(canvas.toDataURL('image/jpeg', 0.92));
    };

    const handleCropConfirm = (dataUrl: string) => {
        onCapture(dataUrlToFile(dataUrl, `capture-${Date.now()}.jpg`));
        setCapturedDataUrl(null);
    };

    if (capturedDataUrl) {
        return (
            <ImageCropModal
                open
                src={capturedDataUrl}
                aspect={aspect}
                onCancel={() => setCapturedDataUrl(null)}
                onConfirm={handleCropConfirm}
            />
        );
    }

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'var(--overlay-backdrop-strong-color)',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
        }}>
            <div style={{ backgroundColor: 'var(--surface-color)', padding: '10px', borderRadius: '8px', maxWidth: '100%', width: '500px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ margin: 0 }}>Take Photo</h3>

                {error ? (
                    <div style={{ color: 'red', padding: '20px', textAlign: 'center' }}>{error}</div>
                ) : (
                    <div style={{ position: 'relative', width: '100%', paddingTop: '75%', backgroundColor: 'var(--text-emphasis-color)', borderRadius: '4px', overflow: 'hidden' }}>
                        <video
                            ref={(el) => {
                                videoRef.current = el;
                                // The video element unmounts and remounts
                                // whenever the crop step opens and is
                                // cancelled; `streamRef` outlives both, so
                                // reattach it here rather than only in the
                                // one-time effect above, which never runs
                                // again after the initial mount.
                                if (el && streamRef.current) {
                                    el.srcObject = streamRef.current;
                                }
                            }}
                            autoPlay
                            playsInline
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                    </div>
                )}

                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid var(--input-border-color)', background: 'var(--surface-color)', cursor: 'pointer' }}>
                        Cancel
                    </button>
                    {!error && (
                        <button onClick={handleCapture} className="primary-btn" style={{ flex: 1, padding: '10px', cursor: 'pointer' }}>
                            Capture
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * The inverse of a canvas's own `toDataURL` — glue between what the crop
 * modal hands back and the `File` shape `onCapture` has always taken.
 * `atob`/`Uint8Array` rather than `fetch(dataUrl)`, which is unnecessary
 * ceremony for bytes already in hand and not something every test
 * environment implements for a `data:` URL.
 */
function dataUrlToFile(dataUrl: string, filename: string): File {
    const [header, base64] = dataUrl.split(',');
    const mime = /data:(.*?);base64/.exec(header)?.[1] ?? 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mime });
}
