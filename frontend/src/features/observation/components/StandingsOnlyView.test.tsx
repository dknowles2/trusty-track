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
            dnfAnnotation={(n) => (n > 0 ? `(${n} DNF${n === 1 ? '' : 's'})` : null)}
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

    it('notes a DNF beside the score, without replacing it (#898)', () => {
        renderView({
            standings: [{ racerId: 1, score: 9.999, heatsCompleted: 2, dnfCount: 1, rank: 1 }],
        });

        expect(screen.getByText('9.999s')).toBeInTheDocument();
        expect(screen.getByText('(1 DNF)')).toBeInTheDocument();
    });

    // #1145: a checked-in racer whose first heat has not run yet reaches
    // this view as `score: 0, heatsCompleted: 0` — the untouched starting
    // value of every scoring strategy's aggregate, indistinguishable from a
    // genuinely fast result unless the row is guarded by `heatsCompleted`.
    it('shows a dash rather than a fabricated score for a racer with no completed heat', () => {
        renderView({
            standings: [
                { racerId: 1, score: 3.2, heatsCompleted: 2, rank: 1 },
                { racerId: 2, score: 0, heatsCompleted: 0, rank: 2 },
            ],
        });

        expect(screen.getByText('Doc Hudson')).toBeInTheDocument();
        expect(screen.queryByText('0.000s')).not.toBeInTheDocument();
        const row = screen.getByText('Doc Hudson').closest('tr');
        expect(row).toHaveTextContent('—');
    });

    it('shows nothing extra when the caller says there is nothing to say', () => {
        renderView();

        expect(screen.queryByText(/DNF/)).not.toBeInTheDocument();
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

    // The phone tier (#1144): a parent's phone rather than a wall display —
    // the `2vmin` header cells below read as 7.8px on a 390px screen (2% of
    // viewport *height*, this table's own desktop legibility floor —
    // nothing about it scales with width, which is this tier's own axis).
    describe('the phone tier (#1144)', () => {
        it('reads the header at least 12px, clearing the issue\'s own floor', () => {
            renderView({ phoneTier: true });
            // jsdom does not compute `rem` against a root font size, so this
            // reads the literal style rather than `getComputedStyle` —
            // `0.85rem` is 13.6px at the default 16px root, past 12px.
            expect(screen.getByText('Rank').style.fontSize).toBe('0.85rem');
            expect(screen.getByText('Racer').style.fontSize).toBe('0.85rem');
            expect(screen.getByText('Runs').style.fontSize).toBe('0.85rem');
        });

        it('keeps the vmin-sized header unchanged when it is not the phone tier', () => {
            renderView({ phoneTier: false });
            expect(screen.getByText('Rank').style.fontSize).toBe('2vmin');
        });

        it('renders a racer\'s name at 1rem (16px), well past the 14px floor', () => {
            renderView({ phoneTier: true });
            expect(screen.getByText('Speedy McQueen').style.fontSize).toBe('1rem');
        });
    });
});
