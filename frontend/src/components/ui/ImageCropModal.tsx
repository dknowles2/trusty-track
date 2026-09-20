import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import {
    clampCrop,
    deriveScale,
    fitInitialCrop,
    outputSize,
    rotateCrop,
    rotateQuarter,
    rotatedSize,
    MIN_CROP_SIZE,
    type CropRect,
    type ImageEdit,
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
    /**
     * Seed the crop from a stored edit rather than starting fresh (#1241) —
     * `RacerForm.tsx`'s Rotate / Recrop reopens this modal on a photo's
     * *original*, and without these the operator would lose whatever
     * rotation/crop was already on file and have to redo it from scratch.
     * Applied once, the instant the image finishes loading: rotation is set
     * first, then `initialCrop` is run through `clampCrop` against the
     * *rotated* frame at that rotation — clamped, not used verbatim,
     * because the original on disk might have been replaced by a shorter
     * or narrower one since the edit was recorded. Both are optional and
     * independent of one another only in the sense that either may be
     * omitted; a caller with an edit on file always has both, since
     * `imageEdit.ts`'s `ImageEdit` carries them as one record.
     */
    initialRotation?: Quarter;
    initialCrop?: CropRect;
    /**
     * The footer's two buttons, per-caller vocabulary for what confirming
     * or backing out actually means here (#1242). A first-time capture
     * (`CameraCapture.tsx`) is genuinely choosing *whether* to use this
     * shot, so the defaults below fit it unchanged; `RacerForm.tsx`'s
     * Rotate / Recrop reopens this same modal against a photo already on
     * file, where the real question is "keep what's on file, or replace it
     * with this edit" — a different pair of words for a different action,
     * not a second name for the same one (`.claude/rules/
     * terminology-and-names.md`'s "one name per action" is about a
     * destination having one name everywhere, not about two distinct
     * actions sharing a verb).
     */
    confirmLabel?: string;
    cancelLabel?: string;
    onCancel: () => void;
    /**
     * Called with a `data:image/jpeg` URL of the rotated, cropped result,
     * and the `ImageEdit` (rotation + crop, in the rotated frame's own
     * pixel space) that produced it — the same record `initialRotation`/
     * `initialCrop` take back in, so a caller can store it and hand it
     * straight back on the next recrop with no conversion either way
     * (#1241).
     */
    onConfirm: (dataUrl: string, edit: ImageEdit) => void;
}

export default function ImageCropModal({
    open,
    src,
    aspect,
    title = 'Crop photo',
    confirmLabel = 'Use this photo',
    cancelLabel = 'Cancel',
    initialRotation,
    initialCrop,
    onCancel,
    onConfirm,
}: ImageCropModalProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);

    const [imageSize, setImageSize] = useState<ImageSize | null>(null);
    const [rotation, setRotation] = useState<Quarter>(0);
    const [crop, setCrop] = useState<CropRect | null>(null);
    // The container's own rendered width, in CSS pixels — `null` until the
    // first measurement. Read rather than assumed because the container
    // also carries `maxWidth: '100%'`: inside a modal narrower than
    // `DISPLAY_MAX`, it renders smaller than the width its own inline style
    // asks for, and a `scale` derived from that constant would then convert
    // a pointer's screen position to the wrong natural-pixel position (#1094).
    const [containerWidth, setContainerWidth] = useState<number | null>(null);

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

    // Memoized, not recomputed inline — `rotatedSize` returns a fresh object
    // literal on every call, so an inline `imageSize ? rotatedSize(...) :
    // null` gave `rotated` a new identity on *every* render, including the
    // ones a drag's own `setCrop` calls trigger. `handlePointerMove` below
    // depends on `rotated`, so it churned identity mid-drag too — which is
    // itself survivable now that the drag's own listeners are captured once
    // by closure (see `startDragListeners`) rather than kept in sync via a
    // dependency array, but there is no reason to leave the churn in place
    // for the next callback that depends on `rotated` to be surprised by.
    const rotated = useMemo(
        () => (imageSize ? rotatedSize(imageSize, rotation) : null),
        [imageSize, rotation],
    );
    const scale = deriveScale(rotated, containerWidth, DISPLAY_MAX);

    // Measured after every layout, not just on mount: rotating swaps which
    // edge is longest, and the browser only reports the *previous* frame's
    // width to a `ResizeObserver` callback that fires asynchronously, which
    // is a stale value for the render that needs it. `useLayoutEffect` plus
    // a synchronous `getBoundingClientRect()` catches the container's real
    // width before the browser paints; the `ResizeObserver` beneath it only
    // has to catch what neither a prop nor a state change causes — the
    // modal's own width changing because the window was resized.
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        setContainerWidth(el.getBoundingClientRect().width);
        // Re-measure whenever the intended size changes — a rotation swaps
        // which edge is longest, which changes the container's own inline
        // width before this can measure it. `setContainerWidth` is stable
        // and bails out on an unchanged value, so this isn't the growing
        // dependency chain it looks like.
    }, [rotated?.width, rotated?.height]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width;
            if (width) setContainerWidth(width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const handleImageLoad = () => {
        const img = imgRef.current;
        if (!img) return;
        const size = { width: img.naturalWidth, height: img.naturalHeight };
        setImageSize(size);
        // Seed from a stored edit when one was given (#1241) — rotation
        // first, then the crop, clamped against the rotated frame *at that
        // rotation* rather than the unrotated `size`, since `crop`'s own
        // coordinates (stored or freshly dragged) are always expressed in
        // whatever frame is currently rotated to. Clamping rather than
        // using `initialCrop` verbatim is what keeps this safe even if the
        // photo on disk has since been replaced by a differently sized one.
        const rotation = initialRotation ?? 0;
        setRotation(rotation);
        const rotatedAtLoad = rotatedSize(size, rotation);
        setCrop(
            initialCrop
                ? clampCrop(initialCrop, rotatedAtLoad, aspect)
                : fitInitialCrop(rotatedAtLoad, aspect),
        );
    };

    const handleRotate = (direction: RotationDirection) => {
        if (!imageSize || !rotated || !crop) return;
        const next = rotateQuarter(rotation, direction);
        setRotation(next);
        // `rotated` is the size `crop` is currently expressed in — the
        // display size at the rotation on screen right now, not the
        // original photo — which is what `rotateCrop` needs to turn the
        // existing selection rather than resetting it (#1240).
        setCrop(rotateCrop(crop, rotated, direction, aspect));
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

    // The listener a drag in progress needs to remove when it ends — kept in
    // a ref, not a memoized callback, so the function that ends a drag can
    // remove *itself* (registered under both `pointerup` and `pointercancel`)
    // without referencing its own binding from inside its own body.
    const endDragRef = useRef<() => void>(() => {});

    useEffect(() => {
        // Belt and braces: if the modal unmounts mid-drag, don't leak the
        // window listeners onto whatever renders next.
        return () => endDragRef.current();
    }, []);

    // Pointer capture makes `e.currentTarget` keep receiving this pointer's
    // events even once it has moved off the small handle it started on —
    // without it, a fast drag near a 32px hit target can hand the gesture to
    // whatever element the pointer ends up over instead (#1094, suspect 2).
    // The events still bubble to `window` under capture, so the listeners
    // added below still see them.
    const capturePointer = (e: React.PointerEvent) => {
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // Some pointer types (and jsdom, which the vitest suite runs
            // under) don't implement capture — the drag still works via the
            // window listeners alone, just without the extra reliability.
        }
    };

    // Registers the move/up/cancel listeners for one drag gesture and hands
    // back nothing — `dragRef` (set by the caller before this runs) and
    // `endDragRef` are the only state a caller needs to touch. A cancelled
    // gesture (the browser deciding mid-drag that this is a page scroll or a
    // system gesture instead — far more a touch thing than a mouse one) gets
    // exactly the same cleanup a normal release does, or `dragRef` stays set
    // and the box keeps following a pointer that has stopped sending events
    // (#1094, suspect 2). `{ once: true }` on both removes whichever one
    // fires; `endDrag` removes the other, since the browser does not clean
    // up a `{ once: true }` listener's un-fired sibling on its own.
    const startDragListeners = () => {
        const endDrag = () => {
            dragRef.current = null;
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', endDrag);
            window.removeEventListener('pointercancel', endDrag);
        };
        endDragRef.current = endDrag;
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', endDrag, { once: true });
        window.addEventListener('pointercancel', endDrag, { once: true });
    };

    const beginMove = (e: React.PointerEvent) => {
        if (!crop) return;
        e.preventDefault();
        e.stopPropagation();
        capturePointer(e);
        dragRef.current = { mode: 'move', startPointer: toNatural(e.clientX, e.clientY), startCrop: crop };
        startDragListeners();
    };

    const beginResize = (e: React.PointerEvent, corner: Corner) => {
        if (!crop) return;
        e.preventDefault();
        e.stopPropagation();
        capturePointer(e);
        dragRef.current = { mode: 'resize', corner, anchor: cornerPoint(crop, oppositeCorner(corner)) };
        startDragListeners();
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

        onConfirm(outCanvas.toDataURL('image/jpeg', JPEG_QUALITY), { rotation, crop });
    };

    if (!open) return null;

    const ready = imageSize !== null && rotated !== null && crop !== null;
    const displayW = rotated ? rotated.width * scale : DISPLAY_MAX;
    const displayH = rotated ? rotated.height * scale : DISPLAY_MAX * (1 / aspect);

    return (
        <Modal isOpen={open} onClose={onCancel} title={title} maxWidth="500px">
            <div
                ref={containerRef}
                data-testid="image-crop-stage"
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
                    // An `<img>` is natively draggable by default, and a
                    // `mousedown` that starts a native drag on it swallows
                    // the pointer sequence a browser-compat mouse event would
                    // otherwise still send — `preventDefault` on `pointerdown`
                    // does not reliably stop that (#1094, suspect 3). It
                    // sits directly under the crop box, so this matters
                    // whenever a drag's first move lands a pixel outside a
                    // handle's own hit area and onto the photo beneath it.
                    draggable={false}
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
                                  userSelect: 'none',
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
                            touchAction: 'none',
                            userSelect: 'none',
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
                    {cancelLabel}
                </button>
                <button type="button" className="primary-btn" onClick={handleConfirm} disabled={!ready}>
                    {confirmLabel}
                </button>
            </div>
        </Modal>
    );
}
