import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import {
    clampCrop,
    fitInitialCrop,
    outputSize,
    rotateQuarter,
    rotatedSize,
    MIN_CROP_SIZE,
    type CropRect,
    type ImageSize,
    type Quarter,
    type RotationDirection,
} from './imageEdit';

/**
 * Rotate and crop a photo client-side, on a canvas, before it ever reaches
 * `uploadImage` — the server never sees the original, and the data URL that
 * does cross the network is small (#619). Stage 1 only: this is a standalone
 * modal with nothing wired into it yet. `CameraCapture.tsx`'s capture flow,
 * `RacerForm.tsx`'s photo preview and the docs are later stages of the same
 * issue.
 */

/** How wide the crop stage renders on screen, in CSS pixels. */
const DISPLAY_MAX = 420;

/** These upload as a data URL over venue wifi (#619) — kept small. */
const MAX_OUTPUT_EDGE = 1024;

const JPEG_QUALITY = 0.85;

/** Arrow-key nudge, in the image's own natural pixels. */
const NUDGE_PX = 12;

const HANDLE_HIT_SIZE = 32; // touch-friendly — this runs on an iPad at check-in.

type Corner = 'nw' | 'ne' | 'sw' | 'se';

const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];

const OPPOSITE_CORNER: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };

function oppositeCorner(corner: Corner): Corner {
    return OPPOSITE_CORNER[corner];
}

function cornerPoint(crop: CropRect, corner: Corner): { x: number; y: number } {
    return {
        x: corner === 'nw' || corner === 'sw' ? crop.x : crop.x + crop.width,
        y: corner === 'nw' || corner === 'ne' ? crop.y : crop.y + crop.height,
    };
}

/**
 * A resize that keeps the corner opposite the one being dragged fixed —
 * the ordinary "drag a handle" interaction. Aspect-locked the same way
 * {@link clampCrop} is; kept local to the modal rather than in `imageEdit.ts`
 * because the anchor/corner concept only means something to a pointer drag.
 */
function resizeFromCorner(
    anchor: { x: number; y: number },
    corner: Corner,
    pointer: { x: number; y: number },
    aspect: number,
    imageSize: ImageSize,
): CropRect {
    const horizontalRoom = corner === 'nw' || corner === 'sw' ? anchor.x : imageSize.width - anchor.x;
    const verticalRoom = corner === 'nw' || corner === 'ne' ? anchor.y : imageSize.height - anchor.y;
    const maxWidth = Math.max(0, Math.min(horizontalRoom, verticalRoom * aspect));

    const desiredWidth = Math.abs(pointer.x - anchor.x);
    const desiredHeight = Math.abs(pointer.y - anchor.y);
    let width = Math.max(desiredWidth, desiredHeight * aspect);
    width = Math.min(width, maxWidth);
    width = Math.max(width, Math.min(MIN_CROP_SIZE * Math.max(1, aspect), maxWidth));
    const height = width / aspect;

    return {
        x: corner === 'nw' || corner === 'sw' ? anchor.x - width : anchor.x,
        y: corner === 'nw' || corner === 'ne' ? anchor.y - height : anchor.y,
        width,
        height,
    };
}

type DragState =
    | { mode: 'move'; startPointer: { x: number; y: number }; startCrop: CropRect }
    | { mode: 'resize'; corner: Corner; anchor: { x: number; y: number } };

export interface ImageCropModalProps {
    open: boolean;
    /** A data URL or object URL — either works, nothing here cares which. */
    src: string;
    /** Locked target aspect ratio (width / height). `PORTRAIT_ASPECT` or `CAR_ASPECT` from `imageEdit.ts`, typically. */
    aspect: number;
    title?: string;
    onCancel: () => void;
    /** Called with a `data:image/jpeg` URL of the rotated, cropped result. */
    onConfirm: (dataUrl: string) => void;
}

export default function ImageCropModal({
    open,
    src,
    aspect,
    title = 'Crop photo',
    onCancel,
    onConfirm,
}: ImageCropModalProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);

    const [imageSize, setImageSize] = useState<ImageSize | null>(null);
    const [rotation, setRotation] = useState<Quarter>(0);
    const [crop, setCrop] = useState<CropRect | null>(null);

    // A fresh photo starts from nothing rather than showing the last one's
    // crop while the new image loads. Adjusted during render — the same
    // "track the previous prop, reset when it changes" idiom
    // `RacerCombobox` uses — rather than an effect, so there is no extra
    // render showing the stale crop before the reset lands.
    const [loadedSrc, setLoadedSrc] = useState(src);
    if (src !== loadedSrc) {
        setLoadedSrc(src);
        setImageSize(null);
        setCrop(null);
        setRotation(0);
    }

    const rotated = imageSize ? rotatedSize(imageSize, rotation) : null;
    const scale = rotated ? DISPLAY_MAX / Math.max(rotated.width, rotated.height) : 1;

    const handleImageLoad = () => {
        const img = imgRef.current;
        if (!img) return;
        const size = { width: img.naturalWidth, height: img.naturalHeight };
        setImageSize(size);
        setRotation(0);
        setCrop(fitInitialCrop(size, aspect));
    };

    const handleRotate = (direction: RotationDirection) => {
        if (!imageSize) return;
        const next = rotateQuarter(rotation, direction);
        setRotation(next);
        setCrop(fitInitialCrop(rotatedSize(imageSize, next), aspect));
    };

    const toNatural = useCallback(
        (clientX: number, clientY: number) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return { x: 0, y: 0 };
            return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
        },
        [scale],
    );

    const handlePointerMove = useCallback(
        (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || !rotated) return;
            const pointer = toNatural(e.clientX, e.clientY);
            if (drag.mode === 'move') {
                const dx = pointer.x - drag.startPointer.x;
                const dy = pointer.y - drag.startPointer.y;
                const moved: CropRect = {
                    ...drag.startCrop,
                    x: drag.startCrop.x + dx,
                    y: drag.startCrop.y + dy,
                };
                setCrop(clampCrop(moved, rotated, aspect));
            } else {
                setCrop(resizeFromCorner(drag.anchor, drag.corner, pointer, aspect, rotated));
            }
        },
        [aspect, rotated, toNatural],
    );

    // `{ once: true }` on the listener (below) removes the pointerup
    // handler itself once it has fired, so this only has pointermove left
    // to clean up — deliberately, so this callback need not reference its
    // own name from inside its own body.
    const handlePointerUp = useCallback(() => {
        dragRef.current = null;
        window.removeEventListener('pointermove', handlePointerMove);
    }, [handlePointerMove]);

    useEffect(() => {
        // Belt and braces: if the modal unmounts mid-drag, don't leak the
        // window listeners onto whatever renders next.
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [handlePointerMove, handlePointerUp]);

    const beginMove = (e: React.PointerEvent) => {
        if (!crop) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = { mode: 'move', startPointer: toNatural(e.clientX, e.clientY), startCrop: crop };
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
    };

    const beginResize = (e: React.PointerEvent, corner: Corner) => {
        if (!crop) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = { mode: 'resize', corner, anchor: cornerPoint(crop, oppositeCorner(corner)) };
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
    };

    const handleCropKeyDown = (e: React.KeyboardEvent) => {
        if (!crop || !rotated) return;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -NUDGE_PX;
        else if (e.key === 'ArrowRight') dx = NUDGE_PX;
        else if (e.key === 'ArrowUp') dy = -NUDGE_PX;
        else if (e.key === 'ArrowDown') dy = NUDGE_PX;
        else return;
        e.preventDefault();
        setCrop(clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy }, rotated, aspect));
    };

    const handleConfirm = () => {
        const img = imgRef.current;
        if (!img || !imageSize || !rotated || !crop) return;

        // Draw the whole photo, rotated, onto a canvas at its natural
        // resolution — then lift the crop rectangle off that.
        const rotatedCanvas = document.createElement('canvas');
        rotatedCanvas.width = rotated.width;
        rotatedCanvas.height = rotated.height;
        const rctx = rotatedCanvas.getContext('2d');
        if (!rctx) return;
        rctx.translate(rotated.width / 2, rotated.height / 2);
        rctx.rotate((rotation * Math.PI) / 180);
        rctx.drawImage(img, -imageSize.width / 2, -imageSize.height / 2);

        const { width: outW, height: outH } = outputSize(crop, MAX_OUTPUT_EDGE);
        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const octx = outCanvas.getContext('2d');
        if (!octx) return;
        octx.drawImage(rotatedCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH);

        onConfirm(outCanvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };

    if (!open) return null;

    const ready = imageSize !== null && rotated !== null && crop !== null;
    const displayW = rotated ? rotated.width * scale : DISPLAY_MAX;
    const displayH = rotated ? rotated.height * scale : DISPLAY_MAX * (1 / aspect);

    return (
        <Modal isOpen={open} onClose={onCancel} title={title} maxWidth="500px">
            <div
                ref={containerRef}
                style={{
                    position: 'relative',
                    width: displayW,
                    height: displayH,
                    maxWidth: '100%',
                    margin: '0 auto',
                    background: 'var(--text-emphasis-color)',
                    overflow: 'hidden',
                    borderRadius: '6px',
                    touchAction: 'none',
                }}
            >
                {/* One element throughout — swapping in a second <img> once
                    `imageSize` is known would re-mount it and lose the load
                    this already did. Hidden (rather than absent) until then,
                    so `handleImageLoad` has somewhere to read a natural size
                    from. */}
                <img
                    ref={imgRef}
                    src={src}
                    alt="Photo being cropped"
                    onLoad={handleImageLoad}
                    style={
                        imageSize
                            ? {
                                  position: 'absolute',
                                  left: '50%',
                                  top: '50%',
                                  width: imageSize.width * scale,
                                  height: imageSize.height * scale,
                                  maxWidth: 'none',
                                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                                  transformOrigin: 'center center',
                              }
                            : { display: 'none' }
                    }
                />

                {crop && rotated && (
                    <div
                        role="group"
                        aria-label="Crop area. Drag to move, drag a corner to resize, or use the arrow keys."
                        tabIndex={0}
                        onKeyDown={handleCropKeyDown}
                        onPointerDown={beginMove}
                        style={{
                            position: 'absolute',
                            left: crop.x * scale,
                            top: crop.y * scale,
                            width: crop.width * scale,
                            height: crop.height * scale,
                            boxSizing: 'border-box',
                            border: '2px solid var(--scouting-blue)',
                            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
                            cursor: 'move',
                            outlineOffset: '2px',
                        }}
                    >
                        {CORNERS.map((corner) => (
                            <div
                                key={corner}
                                onPointerDown={(e) => beginResize(e, corner)}
                                style={{
                                    position: 'absolute',
                                    width: HANDLE_HIT_SIZE,
                                    height: HANDLE_HIT_SIZE,
                                    left: corner === 'nw' || corner === 'sw' ? -HANDLE_HIT_SIZE / 2 : undefined,
                                    right: corner === 'ne' || corner === 'se' ? -HANDLE_HIT_SIZE / 2 : undefined,
                                    top: corner === 'nw' || corner === 'ne' ? -HANDLE_HIT_SIZE / 2 : undefined,
                                    bottom: corner === 'sw' || corner === 'se' ? -HANDLE_HIT_SIZE / 2 : undefined,
                                    cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <div
                                    style={{
                                        width: 14,
                                        height: 14,
                                        borderRadius: '50%',
                                        background: 'var(--cub-scouting-gold)',
                                        boxShadow: '0 0 0 2px var(--scouting-blue)',
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                )}

                {!ready && (
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--white, #fff)',
                            fontSize: '0.85rem',
                        }}
                    >
                        Loading photo…
                    </div>
                )}
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-subtle-color)', margin: '10px 0 0' }}>
                Drag to reposition, drag a corner to resize, or use the arrow keys.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
                <button type="button" className="secondary-btn" onClick={() => handleRotate('left')} disabled={!ready}>
                    ⟲ Rotate left
                </button>
                <button type="button" className="secondary-btn" onClick={() => handleRotate('right')} disabled={!ready}>
                    ⟳ Rotate right
                </button>
            </div>

            <div
                style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    marginTop: '1.5rem',
                    paddingTop: '1rem',
                    borderTop: '1px solid var(--divider-color)',
                }}
            >
                <button type="button" className="secondary-btn" onClick={onCancel}>
                    Cancel
                </button>
                <button type="button" className="primary-btn" onClick={handleConfirm} disabled={!ready}>
                    Use this photo
                </button>
            </div>
        </Modal>
    );
}
