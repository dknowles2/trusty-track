// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StandingsOnlyView, { type StandingsOnlyStanding, type StandingsOnlyRacer } from './StandingsOnlyView';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const racersMap: Record<number, StandingsOnlyRacer> = {
    1: { firstName: 'Speedy', lastName: 'McQueen', carNumber: 95 },
    2: { firstName: 'Doc', lastName: 'Hudson', carNumber: 51 },
};

const standings: StandingsOnlyStanding[] = [
    { racerId: 1, score: 3.2, heatsCompleted: 2, rank: 1 },
    { racerId: 2, score: 3.6, heatsCompleted: 2, rank: 2 },
];

function renderView(overrides: Partial<React.ComponentProps<typeof StandingsOnlyView>> = {}) {
    return render(
        <StandingsOnlyView
            standings={standings}
            racersMap={racersMap}
            nameDisplay="FULL"
            scoreLabel="Avg Time"
            formatScore={(s) => `${s.toFixed(3)}s`}
            vehicle="Car"
            scrollBehavior="PAGING"
            cycleMs={10000}
            {...overrides}
        />,
    );
}

describe('StandingsOnlyView (#663)', () => {
    it('renders every racer in the standings', () => {
        renderView();

        expect(screen.getByText('Speedy McQueen')).toBeInTheDocument();
        expect(screen.getByText('Doc Hudson')).toBeInTheDocument();
    });

    it('shows a placeholder when there are no results yet', () => {
        renderView({ standings: [] });

        expect(screen.getByText('No results yet.')).toBeInTheDocument();
        expect(screen.queryByTestId('standings-only-page-indicator')).not.toBeInTheDocument();
    });

    it('says what it is, for the identify-presence and full-screen-view plumbing to hook onto', () => {
        renderView();

        expect(screen.getByTestId('standings-only-view')).toBeInTheDocument();
    });

    it('never shows a page indicator while scrolling smoothly, even with more racers than fit', () => {
        const many = Array.from({ length: 30 }, (_, i) => ({
            racerId: i + 1,
            score: 3 + i,
            heatsCompleted: 1,
            rank: i + 1,
        }));
        renderView({ standings: many, scrollBehavior: 'SMOOTH' });

        expect(screen.queryByTestId('standings-only-page-indicator')).not.toBeInTheDocument();
    });

    it('shows a page indicator once the list needs more than one page', () => {
        // jsdom lays nothing out, so `clientHeight` reads 0 unless a test
        // sets it — real measurement is `standingsScroll.test.ts`'s job;
        // this only checks the component reaches for a second page once its
        // own measured room says the list does not fit on one.
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            value: 100, // one row's worth, at APPROX_ROW_HEIGHT_PX = 88
        });
        try {
            renderView({ scrollBehavior: 'PAGING' });
            expect(screen.getByTestId('standings-only-page-indicator')).toHaveTextContent(
                'Page 1 of 2',
            );
        } finally {
            Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
        }
    });

    it('cleans up its ticking interval on unmount, so a screen navigated away from leaves nothing running', () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(global, 'clearInterval');

        const { unmount } = renderView({ scrollBehavior: 'SMOOTH' });
        unmount();

        expect(clearSpy).toHaveBeenCalled();
    });

    it('does not throw when a standing names a racer nobody has loaded yet', () => {
        renderView({ racersMap: {} });

        expect(screen.getByText('Racer #1')).toBeInTheDocument();
        expect(screen.getByText('Racer #2')).toBeInTheDocument();
    });
});
