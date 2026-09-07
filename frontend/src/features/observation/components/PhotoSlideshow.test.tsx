// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import PhotoSlideshow from './PhotoSlideshow';
import type { SlideshowRacer, SlideshowRacingGroup } from '../slideshow';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const RACING_GROUPS: SlideshowRacingGroup[] = [{ id: 1, name: 'Wolves', color: '#f00' }];

const racer = (over: Partial<SlideshowRacer> & { id: number }): SlideshowRacer => ({
    firstName: 'Jordan',
    lastName: 'Mitchell',
    carNumber: null,
    racerImageUrl: null,
    carImageUrl: null,
    ...over,
});

function renderSlideshow(overrides: Partial<React.ComponentProps<typeof PhotoSlideshow>> = {}) {
    return render(
        <PhotoSlideshow
            racers={[]}
            racingGroups={RACING_GROUPS}
            intervalMs={5000}
            {...overrides}
        />,
    );
}

describe('PhotoSlideshow (#175)', () => {
    it('shows the empty state when nobody has a photograph', () => {
        renderSlideshow({ racers: [racer({ id: 1 })] });

        expect(screen.getByTestId('slideshow-empty')).toBeInTheDocument();
        expect(
            screen.getByText(/No photos yet — add racer or car photos at check-in/),
        ).toBeInTheDocument();
    });

    it('distinguishes loading from having nothing to show — no "No photos yet" during the first fetch', () => {
        renderSlideshow({ racers: [], loading: true });

        expect(screen.getByTestId('slideshow-loading')).toBeInTheDocument();
        expect(screen.queryByText(/No photos yet/)).not.toBeInTheDocument();
    });

    it('renders the first racer with a photo, by car number', () => {
        renderSlideshow({
            racers: [
                racer({ id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: '/speedy.jpg' }),
                racer({ id: 2, firstName: 'Doc', lastName: 'Hudson', carNumber: 51, racerImageUrl: '/doc.jpg' }),
            ],
        });

        expect(screen.getByTestId('slideshow')).toBeInTheDocument();
        expect(screen.getByText('Doc Hudson')).toBeInTheDocument();
        expect(screen.getByText('1 of 2')).toBeInTheDocument();
    });

    it('advances to the next slide on an interval tick', () => {
        vi.useFakeTimers();
        renderSlideshow({
            racers: [
                racer({ id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: '/speedy.jpg' }),
                racer({ id: 2, firstName: 'Doc', lastName: 'Hudson', carNumber: 51, racerImageUrl: '/doc.jpg' }),
            ],
            intervalMs: 5000,
        });

        expect(screen.getByText('Doc Hudson')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(screen.getByText('Speedy McQueen')).toBeInTheDocument();
    });

    it('cleans up its interval on unmount, so a screen navigated away from leaves nothing running', () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(global, 'clearInterval');

        const { unmount } = renderSlideshow({
            racers: [
                racer({ id: 1, carNumber: 1, racerImageUrl: '/a.jpg' }),
                racer({ id: 2, carNumber: 2, racerImageUrl: '/b.jpg' }),
            ],
        });
        unmount();

        expect(clearSpy).toHaveBeenCalled();
    });

    it('does not run a timer for a single slide', () => {
        vi.useFakeTimers();
        const setSpy = vi.spyOn(global, 'setInterval');

        renderSlideshow({
            racers: [racer({ id: 1, carNumber: 1, racerImageUrl: '/a.jpg' })],
        });

        expect(setSpy).not.toHaveBeenCalled();
    });

    it('honors the name-display setting, hiding a racer photo whose only photo is their own', () => {
        renderSlideshow({
            racers: [
                racer({ id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: '/speedy.jpg' }),
            ],
            nameDisplay: 'LAST_INITIAL',
        });

        // Only a racer photo, and it's hidden under an abbreviating setting —
        // so there is nothing left to show and the empty state fires.
        expect(screen.getByTestId('slideshow-empty')).toBeInTheDocument();
    });
});
