import { useRef, useEffect, useState } from 'react';

interface CameraCaptureProps {
    onCapture: (file: File) => void;
    onClose: () => void;
}

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string>('');
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        const startCamera = async () => {
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
        
        canvas.toBlob((blob) => {
            if (blob) {
                const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
                onCapture(file);
            }
        }, 'image/jpeg', 0.8);
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
        }}>
            <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '8px', maxWidth: '100%', width: '500px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ margin: 0 }}>Take Photo</h3>
                
                {error ? (
                    <div style={{ color: 'red', padding: '20px', textAlign: 'center' }}>{error}</div>
                ) : (
                    <div style={{ position: 'relative', width: '100%', paddingTop: '75%', backgroundColor: '#000', borderRadius: '4px', overflow: 'hidden' }}>
                        <video 
                            ref={videoRef} 
                            autoPlay 
                            playsInline 
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                    </div>
                )}
                
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}>
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
