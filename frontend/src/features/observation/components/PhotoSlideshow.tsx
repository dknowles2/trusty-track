/**
 * The racers' photographs, between heats (#175).
 *
 * Check-in collects a headshot and a picture of the car, and they appeared on
 * screen only while that racer was in the heat — a few seconds each, once per
 * round. Most of an event is the gaps.
 *
 * Full-bleed and sized in `vmin`, like projector mode: this is for a screen
 * across a room, not a laptop. The rules — who is in it, in what order, and
 * what happens when the roster moves underneath it — are in `slideshow.ts`.
 */

import { useEffect, useState } from 'react';

import {
    NOTHING_TO_SHOW,
    clampIndex,
    nextIndex,
    slidesFor,
    type SlideshowRacingGroup,
    type SlideshowRacer,
} from '../slideshow';
import { useTerminology } from '../../../context/TerminologyContext';
import type { NameDisplay } from '../../core/displayName';

interface Props {
    racers: readonly SlideshowRacer[];
    racingGroups: readonly SlideshowRacingGroup[];
    /** How long each racer stays up, from the display's assignment. */
    intervalMs: number;
    /**
     * Whether the roster is still on its way.
     *
     * Without this the empty state fires during the first fetch, so a screen
     * switched to the slideshow says "No photos yet" for a moment before the
     * photographs appear — on a projector, in front of the room, and it reads
     * as the answer rather than as a wait.
     */
    loading?: boolean;
    /** How much of a racer's name — and whether their own photograph — this
     * screen may show (#552). Defaults to `'FULL'`, today's only behaviour,
     * for any caller that has not resolved the setting yet. */
    nameDisplay?: NameDisplay | string;
}

export default function PhotoSlideshow({
    racers,
    racingGroups,
    intervalMs,
    loading = false,
    nameDisplay = 'FULL',
}: Props) {
    const slides = slidesFor(racers, racingGroups, nameDisplay);
    const [index, setIndex] = useState(0);
    const { vehicleLower } = useTerminology();

    // Hold position when the roster changes underneath us. A photo uploaded at
    // the desk mid-round adds a slide, and resetting to the first child every
    // time would mean never reaching the end of a sixty-strong pack.
    const safeIndex = clampIndex(index, slides.length);

    useEffect(() => {
        if (slides.length <= 1) return;
        const timer = setInterval(
            () => setIndex((current) => nextIndex(clampIndex(current, slides.length), slides.length)),
            Math.max(1000, intervalMs),
        );
        return () => clearInterval(timer);
    }, [slides.length, intervalMs]);

    if (slides.length === 0) {
        return (
            <div
                data-testid={loading ? 'slideshow-loading' : 'slideshow-empty'}
                style={{
                    height: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4vmin',
                    textAlign: 'center',
                    color: 'var(--display-text-subtle-color)',
                    fontSize: '3vmin',
                }}
            >
                {loading ? '' : NOTHING_TO_SHOW}
            </div>
        );
    }

    const slide = slides[safeIndex];

    return (
        <div
            data-testid="slideshow"
            style={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2vmin',
                padding: '3vmin',
                boxSizing: 'border-box',
                overflow: 'hidden',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    gap: '3vmin',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 1,
                    minHeight: 0,
                    width: '100%',
                }}
            >
                {/* Both photos when both exist, and whichever one there is
                    otherwise — a racer with only a car photo is still worth a
                    slide, and their family still wants to see it. */}
                {slide.racerImageUrl && (
                    <img
                        src={slide.racerImageUrl}
                        alt={slide.name}
                        style={{ maxHeight: '100%', maxWidth: '45%', objectFit: 'contain', borderRadius: '2vmin' }}
                    />
                )}
                {slide.carImageUrl && (
                    <img
                        src={slide.carImageUrl}
                        alt={slide.carName ? `${slide.name}'s ${vehicleLower}, ${slide.carName}` : `${slide.name}'s ${vehicleLower}`}
                        style={{ maxHeight: '100%', maxWidth: '45%', objectFit: 'contain', borderRadius: '2vmin' }}
                    />
                )}
            </div>

            <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '5vmin', fontWeight: 'bold', color: 'var(--display-text-color)', lineHeight: 1.1 }}>
                    {slide.carNumber != null && (
                        <span style={{ color: 'var(--display-accent-color)' }}>#{slide.carNumber} </span>
                    )}
                    {slide.name}
                </div>
                {(slide.carName || slide.racingGroupName) && (
                    <div style={{ fontSize: '3vmin', color: 'var(--display-text-faint-color)', marginTop: '1vmin' }}>
                        {slide.carName}
                        {slide.carName && slide.racingGroupName ? ' · ' : ''}
                        {slide.racingGroupName && (
                            <span
                                style={{
                                    borderLeft: slide.racingGroupColor ? `0.6vmin solid ${slide.racingGroupColor}` : undefined,
                                    paddingLeft: slide.racingGroupColor ? '1vmin' : undefined,
                                }}
                            >
                                {slide.racingGroupName}
                            </span>
                        )}
                    </div>
                )}
                <div style={{ fontSize: '2vmin', color: 'var(--display-text-faintest-color)', marginTop: '1.5vmin' }}>
                    {safeIndex + 1} of {slides.length}
                </div>
            </div>
        </div>
    );
}
