// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import BroadcastOverlayView from './BroadcastOverlayView';

// TimerStatusBadge opens its own subscription (#616's live status badge is
// reused rather than reimplemented) — stubbed here the same way every other
// consumer of it in this tree stubs `useSubscription`.
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useSubscription: vi.fn(() => [{ data: undefined }]) };
});

afterEach(cleanup);

function renderView(overrides: Partial<React.ComponentProps<typeof BroadcastOverlayView>> = {}) {
    return render(
        <BroadcastOverlayView
            trackId={1}
            heatLabel="Round 1, Heat 2"
            isExhibition={false}
            lanes={[
                { lane: 1, racer: { id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95 } },
                { lane: 2, racer: { id: 2, firstName: 'Doc', lastName: 'Hudson', carNumber: 51 } },
            ]}
            laneColors={[]}
            nameDisplay="FULL"
            vehicle="Car"
            standings={[
                { racerId: 1, score: 3.501, rank: 1 },
                { racerId: 2, score: 3.9, rank: 2 },
            ]}
            racersMap={{
                1: { firstName: 'Speedy', lastName: 'McQueen' },
                2: { firstName: 'Doc', lastName: 'Hudson' },
            }}
            scoreLabel="Avg Time"
            formatScore={(score) => `${score.toFixed(3)}s`}
            showStandingsTicker={true}
            finishBanner={null}
            {...overrides}
        />,
    );
}

describe('BroadcastOverlayView (#616)', () => {
    it('says what it is, for the full-screen-view plumbing to hook onto', () => {
        renderView();
        expect(screen.getByTestId('overlay-view')).toBeInTheDocument();
    });

    it('names the round and heat in the lower-third bar', () => {
        renderView();
        expect(screen.getByTestId('overlay-lower-third')).toHaveTextContent('Round 1, Heat 2');
    });

    it('says "Between heats" rather than an empty bar when nothing is armed', () => {
        renderView({ heatLabel: null, lanes: [] });
        expect(screen.getByTestId('overlay-lower-third')).toHaveTextContent('Between heats');
    });

    it('lists each lane, its racer and car number', () => {
        renderView();
        const bar = screen.getByTestId('overlay-lower-third');
        expect(bar).toHaveTextContent('Speedy McQueen');
        expect(bar).toHaveTextContent('Car #95');
        expect(bar).toHaveTextContent('Doc Hudson');
        expect(bar).toHaveTextContent('Car #51');
    });

    it('abbreviates a name under the resolved name-display setting (#552)', () => {
        renderView({ nameDisplay: 'LAST_INITIAL' });
        expect(screen.getByTestId('overlay-lower-third')).toHaveTextContent('Speedy M.');
        expect(screen.queryByText('Speedy McQueen')).not.toBeInTheDocument();
    });

    it('shows an Exhibition badge for a free-race heat on the track', () => {
        renderView({ isExhibition: true, heatLabel: 'Car exhibition run' });
        expect(screen.getByText('Exhibition')).toBeInTheDocument();
    });

    it('shows the compact top-5 standings ticker when enabled', () => {
        renderView();
        const ticker = screen.getByTestId('overlay-standings-ticker');
        expect(ticker).toHaveTextContent('Speedy McQueen');
        expect(ticker).toHaveTextContent('3.501s');
        expect(ticker).toHaveTextContent('Doc Hudson');
    });

    it('hides the ticker entirely when the operator turns it off', () => {
        renderView({ showStandingsTicker: false });
        expect(screen.queryByTestId('overlay-standings-ticker')).not.toBeInTheDocument();
    });

    it('hides the ticker when there are no standings yet, even if enabled', () => {
        // The same "no blank card" rule the slideshow and check-in views
        // follow: an empty ticker says nothing useful over a stream.
        renderView({ standings: [] });
        expect(screen.queryByTestId('overlay-standings-ticker')).not.toBeInTheDocument();
    });

    it('renders no finish banner until one is supplied', () => {
        renderView();
        expect(screen.queryByTestId('overlay-finish-banner')).not.toBeInTheDocument();
    });

    it('reveals a finish banner in finishing order, with times', () => {
        renderView({
            finishBanner: {
                lanes: [
                    { laneNumber: 2, place: 2, racerName: 'Doc Hudson', time: 3.9 },
                    { laneNumber: 1, place: 1, racerName: 'Speedy McQueen', time: 3.501 },
                ],
            },
        });
        const banner = screen.getByTestId('overlay-finish-banner');
        const text = banner.textContent ?? '';
        expect(text.indexOf('Speedy McQueen')).toBeLessThan(text.indexOf('Doc Hudson'));
        expect(banner).toHaveTextContent('3.501s');
    });

    it('names a broken track record on the finish banner', () => {
        renderView({
            finishBanner: {
                lanes: [{ laneNumber: 1, place: 1, racerName: 'Speedy McQueen', time: 2.874 }],
                recordBreak: {
                    newSeconds: 2.874,
                    newHolder: 'Speedy McQueen',
                    previousSeconds: 2.891,
                    previousHolder: 'Jimmy Legend',
                    previousRaceName: 'Derby 2019',
                },
            },
        });
        expect(screen.getByTestId('overlay-finish-banner')).toHaveTextContent('New track record!');
        expect(screen.getByTestId('overlay-finish-banner')).toHaveTextContent('Jimmy Legend');
    });

    it('renders no image anywhere — text only, deliberately (see this file\'s own module docstring)', () => {
        renderView({
            finishBanner: {
                lanes: [{ laneNumber: 1, place: 1, racerName: 'Speedy McQueen', time: 2.874 }],
            },
        });
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
});
