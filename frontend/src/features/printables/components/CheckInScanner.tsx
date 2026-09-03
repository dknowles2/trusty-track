import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@mdi/react';
import { mdiAlertCircleOutline, mdiQrcodeScan } from '@mdi/js';

import {
    canScan,
    matchByCarNumber,
    resolveScan,
    type ScannableRacer,
} from '../scanning';
import { useTerminology } from '../../../context/TerminologyContext';

interface Props {
    raceId: number;
    racers: readonly ScannableRacer[];
    /** A racer was identified — open their check-in. */
    onRacer: (racerId: number) => void;
    onClose: () => void;
}

/** Chromium's `BarcodeDetector`, which TypeScript's DOM types do not know. */
interface DetectedBarcode {
    rawValue: string;
}
interface BarcodeDetectorLike {
    detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorConstructor = new (options?: {
    formats?: string[];
}) => BarcodeDetectorLike;

/** How often to look at the video. Fast enough to feel instant, slow enough
 *  not to pin a Raspberry Pi's CPU while the camera is open. */
const SCAN_INTERVAL_MS = 200;

const MESSAGES = {
    'not-a-code': 'That is not a Trusty Track code.',
    'unknown-racer': 'That code is for a racer who is no longer on this roster.',
} as const;

/**
 * Scan a printed check-in code, or type a car number.
 *
 * Both, always — not scanning-with-a-fallback. A code gets creased, a camera
 * will not focus, and the operator has a queue behind the table.
 */
export default function CheckInScanner({ raceId, racers, onRacer, onClose }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    // Whether the camera itself failed to open — the message names the
    // vehicle word (#551), read fresh at render rather than captured by the
    // effect below, so a terminology change does not need to restart the
    // camera stream just to reword an error nobody is seeing yet.
    const [cameraBlocked, setCameraBlocked] = useState(false);
    const [message, setMessage] = useState('');
    const [typed, setTyped] = useState('');
    const scanning = canScan();
    const { vehicle, vehicleLower } = useTerminology();

    // Which payload the last message was about, so a code held in front of the
    // camera does not re-report itself forty times a second.
    const lastSeen = useRef<string | null>(null);

    const handlePayload = useCallback(
        (payload: string) => {
            if (payload === lastSeen.current) return;
            lastSeen.current = payload;

            const result = resolveScan(payload, raceId, racers);
            if (result.status === 'ok') {
                onRacer(result.racerId);
                return;
            }
            if (result.status === 'wrong-race') {
                setMessage(
                    `That code is for a different race (#${result.raceId}). ` +
                        'Check the sheet it came from.',
                );
                return;
            }
            setMessage(MESSAGES[result.status]);
        },
        [raceId, racers, onRacer],
    );

    useEffect(() => {
        if (!scanning) return;

        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | undefined;

        const start = async () => {
            // `navigator.mediaDevices` does not exist at all outside a
            // secure context (https:// or localhost), so calling straight
            // into it throws a bare TypeError indistinguishable, to the
            // operator, from a permissions refusal — the wrong thing to
            // troubleshoot when the real cause is TRUSTYTRACK_HTTP_ONLY or a
            // check-in tablet reached by plain http://<lan-ip>. Checked
            // against `=== false` rather than falsy: a real browser always
            // reports a boolean here, so this only fires on a genuine
            // insecure origin, never on an environment that has not
            // implemented the property at all.
            if (window.isSecureContext === false) {
                setCameraBlocked(true);
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' },
                });
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) videoRef.current.srcObject = stream;
            } catch (err) {
                console.error('Error accessing camera:', err);
                setCameraBlocked(true);
                return;
            }

            const Detector = (
                window as unknown as { BarcodeDetector: BarcodeDetectorConstructor }
            ).BarcodeDetector;
            const detector = new Detector({ formats: ['qr_code'] });

            timer = setInterval(async () => {
                const video = videoRef.current;
                if (!video || video.readyState < 2) return;
                try {
                    const codes = await detector.detect(video);
                    if (codes.length > 0) handlePayload(codes[0].rawValue);
                } catch (err) {
                    // A frame that will not decode is the normal case, not an
                    // error worth showing the operator.
                    console.debug('barcode detect failed', err);
                }
            }, SCAN_INTERVAL_MS);
        };

        start();

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            streamRef.current?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        };
    }, [scanning, handlePayload]);

    const submitTyped = (event: React.FormEvent) => {
        event.preventDefault();
        const result = matchByCarNumber(racers, typed);
        if (result.status === 'ok') {
            onRacer(result.racer.id);
            return;
        }
        if (result.status === 'ambiguous') {
            setMessage(
                `More than one racer has ${vehicleLower} number ${typed.trim()} — find them by name.`,
            );
            return;
        }
        setMessage(`No racer has ${vehicleLower} number ${typed.trim()}.`);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {scanning && !cameraBlocked ? (
                <div
                    style={{
                        position: 'relative',
                        width: '100%',
                        paddingTop: '62%',
                        background: 'var(--text-emphasis-color)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                    }}
                >
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        data-testid="scanner-video"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />
                    <div
                        aria-hidden
                        style={{
                            position: 'absolute',
                            inset: '18%',
                            border: '3px solid var(--cub-scouting-gold)',
                            borderRadius: '12px',
                            pointerEvents: 'none',
                        }}
                    />
                </div>
            ) : (
                <div
                    style={{
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start',
                        background: 'var(--warning-bg-color)',
                        border: '1px solid var(--warning-alt-border-color)',
                        borderRadius: '8px',
                        padding: '12px',
                        fontSize: '0.9rem',
                    }}
                >
                    <Icon path={mdiAlertCircleOutline} size={0.9} color="var(--caution-icon-color)" />
                    <span>
                        {cameraBlocked
                            ? window.isSecureContext === false
                                ? 'The camera needs a secure connection. Open Trusty Track on ' +
                                    'the computer running the server, or switch HTTPS back on. ' +
                                    `Type a ${vehicleLower} number instead.`
                                : `Could not open the camera. Type a ${vehicleLower} number instead.`
                            : 'This browser cannot scan QR codes — Chrome and Edge can. ' +
                                `Type the ${vehicleLower} number instead; everything else works the same.`}
                    </span>
                </div>
            )}

            {message && (
                <div role="status" style={{ color: 'var(--error)', fontSize: '0.9rem' }}>
                    {message}
                </div>
            )}

            <form onSubmit={submitTyped} style={{ display: 'flex', gap: '8px' }}>
                <label htmlFor="scan-car-number" style={{ alignSelf: 'center' }}>
                    {vehicle} number
                </label>
                <input
                    id="scan-car-number"
                    value={typed}
                    autoFocus={!scanning}
                    onChange={(e) => setTyped(e.target.value)}
                    style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid var(--input-border-color)',
                    }}
                />
                <button type="submit" className="primary-btn" style={{ padding: '8px 16px' }}>
                    <Icon path={mdiQrcodeScan} size={0.8} style={{ marginRight: '6px' }} />
                    Find
                </button>
            </form>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="secondary-btn" onClick={onClose}>
                    Done
                </button>
            </div>
        </div>
    );
}
