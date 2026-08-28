// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { print } from 'graphql';
import RaceStats from './RaceStats';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery } from 'urql';
import { GET_RACE_STATS } from '../graphql/queries';
import { filenameFor } from '../../../utils/csv';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
    };
});

// `downloadCsv` hands the browser a Blob and clicks a synthetic anchor — real
// enough in jsdom, but nothing worth exercising here. Mocked so the export
// tests can assert on what was handed to it instead.
vi.mock('../../../utils/csv', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../utils/csv')>();
    return { ...actual, downloadCsv: vi.fn() };
});
import { downloadCsv } from '../../../utils/csv';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function statsPayload(overrides: object = {}) {
    return {
        raceId: 2,
        raceName: 'This Derby',
        scoringStrategy: 'TIMED',
        totalHeatsScheduled: 4,
        totalHeatsCompleted: 4,
        totalRacers: 4,
        laneStats: [],
        racerStats: [],
        highlights: [],
        denStats: [],
        heatResults: [],
        trackRecords: [],
        ...overrides,
    };
}

function renderStats(raceStats: object) {
    (useQuery as any).mockReturnValue([
        { data: { raceStats }, fetching: false, error: null },
        vi.fn(),
    ]);
    return render(
        <MemoryRouter initialEntries={['/race/2/stats']}>
            <Routes>
                <Route path="/race/:raceId/stats" element={<RaceStats />} />
            </Routes>
        </MemoryRouter>
    );
}

/** For the loading / error / missing-data states, where the shape of `data`
 * itself is what is under test rather than a `raceStats` payload. */
function renderWithResult(result: { data?: unknown; fetching: boolean; error?: unknown }) {
    (useQuery as any).mockReturnValue([result, vi.fn()]);
    return render(
        <MemoryRouter initialEntries={['/race/2/stats']}>
            <Routes>
                <Route path="/race/:raceId/stats" element={<RaceStats />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('the track record section', () => {
    const records = [
        {
            timeSeconds: 2.951,
            racerName: 'Ada Speed',
            carNumber: 7,
            raceId: 1,
            raceName: 'Derby 2025',
            raceDate: '2025-03-14T09:00:00',
        },
        {
            timeSeconds: 3.104,
            racerName: 'Bea Swift',
            carNumber: 12,
            raceId: 2,
            raceName: 'This Derby',
            raceDate: '2026-03-13T09:00:00',
        },
    ];

    it('shows the record holder, their race, and the all-time list', () => {
        renderStats(statsPayload({ trackRecords: records }));

        expect(screen.getByTestId('track-record-section')).toBeTruthy();
        // Once on the hero card, once in the all-time table.
        expect(screen.getAllByText('2.951s').length).toBe(2);
        expect(screen.getAllByText(/Ada Speed/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Derby 2025/).length).toBeGreaterThan(0);
        // The second-fastest car appears in the all-time table.
        expect(screen.getByText(/Bea Swift/)).toBeTruthy();
    });

    it('marks a record set at this event, and only then', () => {
        renderStats(statsPayload({ trackRecords: records }));

        // The record itself stands from an earlier race, so the hero card
        // carries no badge — but Bea's row, set at this race, is marked.
        expect(screen.queryByText('Set at this event!')).toBeNull();
        expect(screen.getByText('This event')).toBeTruthy();
    });

    it('celebrates a record set at this event on the card itself', () => {
        renderStats(
            statsPayload({
                trackRecords: [{ ...records[0], raceId: 2, raceName: 'This Derby' }],
            })
        );
        expect(screen.getByText('Set at this event!')).toBeTruthy();
    });

    it('is absent when the track has no records', () => {
        renderStats(statsPayload());
        expect(screen.queryByTestId('track-record-section')).toBeNull();
    });
});

describe('the race stats query', () => {
    it('asks for every field it renders', () => {
        // The failure this guards against is a mock written from what the
        // component reads rather than what the query selects, which is how a
        // field ends up rendering as undefined against a real backend.
        const document = print(GET_RACE_STATS);
        for (const field of [
            'raceId', 'raceName', 'scoringStrategy',
            'totalHeatsScheduled', 'totalHeatsCompleted', 'totalRacers',
            'lane', 'avgTime', 'heatCount', 'relativeAdvantagePct',
            'racerId', 'firstName', 'lastName', 'carNumber', 'denName',
            'heatsCompleted', 'minTime', 'maxTime', 'meanTime', 'stdDev',
            'type', 'roundName', 'heatNumber', 'globalHeatNumber', 'racerName',
            'time', 'margin',
            'denId', 'denColor', 'racerCount', 'avgScore', 'bestRacerName',
            'racerFirstName', 'racerLastName', 'place',
            'timeSeconds', 'raceDate',
        ]) {
            expect(document).toContain(field);
        }
    });
});

describe('loading, error and empty states', () => {
    it('shows a loading message while fetching, before any data has arrived', () => {
        renderWithResult({ data: undefined, fetching: true, error: undefined });
        expect(screen.getByText('Loading stats...')).toBeInTheDocument();
    });

    it('shows an error message when the query fails', () => {
        renderWithResult({ data: undefined, fetching: false, error: new Error('boom') });
        expect(screen.getByText('Error loading stats')).toBeInTheDocument();
        expect(screen.queryByText('Loading stats...')).toBeNull();
    });

    it('shows a not-yet-available message when the race has no stats at all', () => {
        renderWithResult({ data: { raceStats: null }, fetching: false, error: undefined });
        expect(screen.getByText('No stats available for this race yet.')).toBeInTheDocument();
    });

    it('shows "invalid race id" rather than querying with a bad param', () => {
        (useQuery as any).mockReturnValue([{ data: undefined, fetching: false, error: undefined }, vi.fn()]);
        render(
            <MemoryRouter initialEntries={['/race/not-a-number/stats']}>
                <Routes>
                    <Route path="/race/:raceId/stats" element={<RaceStats />} />
                </Routes>
            </MemoryRouter>
        );
        expect(screen.getByText('Invalid Race ID')).toBeInTheDocument();
    });

    it('asks the operator to complete heats rather than showing empty sections', () => {
        renderStats(statsPayload({ totalHeatsCompleted: 0, totalHeatsScheduled: 4, totalRacers: 4 }));

        expect(
            screen.getByText('No heat results recorded yet. Complete some heats to see statistics.')
        ).toBeInTheDocument();
        // The overview cards still show — there just isn't a results section
        // to render nothing interesting for.
        expect(screen.getByText('Heats Completed')).toBeInTheDocument();
        expect(screen.queryByText('Lane Fairness')).toBeNull();
    });
});

describe('per-racer stats: sorting', () => {
    const racers = [
        { racerId: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 3, denName: 'Wolves', heatsCompleted: 4, heatsScheduled: 4, minTime: 3.1, maxTime: 3.9, meanTime: 3.5, stdDev: 0.3, timesPerLane: [] },
        { racerId: 2, firstName: 'Bea', lastName: 'Swift', carNumber: 1, denName: 'Tigers', heatsCompleted: 4, heatsScheduled: 4, minTime: 2.8, maxTime: 3.2, meanTime: 3.0, stdDev: 0.15, timesPerLane: [] },
        { racerId: 3, firstName: 'Cy', lastName: 'Quick', carNumber: 2, denName: 'Bears', heatsCompleted: 4, heatsScheduled: 4, minTime: 2.5, maxTime: 3.6, meanTime: 3.2, stdDev: 0.4, timesPerLane: [] },
    ];

    // "Std Dev" is unique to this table — the lane-fairness table above it
    // also has a column that starts with "Avg".
    function racerTable() {
        return screen.getByRole('columnheader', { name: /Std Dev/ }).closest('table')!;
    }

    it('sorts by mean time ascending by default', () => {
        renderStats(statsPayload({ racerStats: racers }));
        const rows = within(racerTable()).getAllByRole('row');
        expect(rows[1]).toHaveTextContent('Bea Swift');
        expect(rows[2]).toHaveTextContent('Cy Quick');
        expect(rows[3]).toHaveTextContent('Ada Lovelace');
    });

    it('re-sorts on the clicked column (handleSort)', async () => {
        const user = userEvent.setup();
        renderStats(statsPayload({ racerStats: racers }));

        await user.click(screen.getByRole('columnheader', { name: /Min/ }));

        const rows = within(racerTable()).getAllByRole('row');
        // Ascending by minTime: Cy (2.5), Bea (2.8), Ada (3.1).
        expect(rows[1]).toHaveTextContent('Cy Quick');
        expect(rows[2]).toHaveTextContent('Bea Swift');
        expect(rows[3]).toHaveTextContent('Ada Lovelace');
    });

    it('reverses direction on a second click of the same column', async () => {
        const user = userEvent.setup();
        renderStats(statsPayload({ racerStats: racers }));

        const minHeader = screen.getByRole('columnheader', { name: /Min/ });
        await user.click(minHeader); // ascending by minTime
        await user.click(minHeader); // descending by minTime

        const rows = within(racerTable()).getAllByRole('row');
        expect(rows[1]).toHaveTextContent('Ada Lovelace');
        expect(rows[2]).toHaveTextContent('Bea Swift');
        expect(rows[3]).toHaveTextContent('Cy Quick');
    });

    it('resets to ascending when a different column is clicked', async () => {
        const user = userEvent.setup();
        renderStats(statsPayload({ racerStats: racers }));

        const minHeader = screen.getByRole('columnheader', { name: /Min/ });
        await user.click(minHeader); // ascending by minTime
        await user.click(minHeader); // descending by minTime
        await user.click(screen.getByRole('columnheader', { name: /Max/ })); // fresh column: ascending

        const rows = within(racerTable()).getAllByRole('row');
        // Ascending by maxTime: Bea (3.2), Cy (3.6), Ada (3.9).
        expect(rows[1]).toHaveTextContent('Bea Swift');
        expect(rows[2]).toHaveTextContent('Cy Quick');
        expect(rows[3]).toHaveTextContent('Ada Lovelace');
    });
});

describe('CSV exports', () => {
    it('exports heat results with the fields the page has for them', async () => {
        const user = userEvent.setup();
        const heatResults = [
            {
                roundName: 'Round 1', heatNumber: 2, globalHeatNumber: 5, lane: 3,
                carNumber: 7, racerFirstName: 'Ada', racerLastName: 'Lovelace',
                time: 3.501, place: 1,
            },
        ];
        renderStats(statsPayload({ heatResults }));

        await user.click(screen.getByText('Export Heat Results'));

        expect(downloadCsv).toHaveBeenCalledTimes(1);
        const [filename, rows] = (downloadCsv as any).mock.calls[0];
        expect(filename).toBe(filenameFor('This Derby', 'heat-results'));
        expect(rows[0]).toEqual([
            'Round', 'Heat #', 'Global Heat #', 'Lane', 'Car #', 'First Name', 'Last Name', 'Time (s)', 'Place',
        ]);
        expect(rows[1]).toEqual(['Round 1', 2, 5, 3, 7, 'Ada', 'Lovelace', 3.501, 1]);
    });

    it('exports racer stats with the fields the page has for them', async () => {
        const user = userEvent.setup();
        const racerStats = [
            {
                racerId: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 3,
                denName: 'Wolves', heatsCompleted: 4, heatsScheduled: 4,
                minTime: 3.1, maxTime: 3.9, meanTime: 3.5, stdDev: 0.3, timesPerLane: [],
            },
        ];
        renderStats(statsPayload({ racerStats }));

        await user.click(screen.getByText('Export Racer Stats'));

        expect(downloadCsv).toHaveBeenCalledTimes(1);
        const [filename, rows] = (downloadCsv as any).mock.calls[0];
        expect(filename).toBe(filenameFor('This Derby', 'racer-stats'));
        expect(rows[0]).toEqual(['Car #', 'First Name', 'Last Name', 'Den', 'Heats', 'Min (s)', 'Avg (s)', 'Max (s)', 'Std Dev']);
        expect(rows[1]).toEqual([3, 'Ada', 'Lovelace', 'Wolves', 4, 3.1, 3.5, 3.9, 0.3]);
    });
});

describe('lane fairness', () => {
    const laneStats = [
        { lane: 1, avgTime: 3.501, heatCount: 4, relativeAdvantagePct: 1.2 },
        { lane: 2, avgTime: 3.6, heatCount: 4, relativeAdvantagePct: -0.9 },
        { lane: 3, avgTime: null, heatCount: 0, relativeAdvantagePct: null },
    ];

    it('shows each lane\'s average time, heat count and signed advantage', () => {
        renderStats(statsPayload({ laneStats }));

        const table = screen.getByText('Advantage %').closest('table')!;
        const rows = within(table).getAllByRole('row');
        expect(rows[1]).toHaveTextContent('Lane 1');
        expect(rows[1]).toHaveTextContent('3.501s');
        expect(rows[1]).toHaveTextContent('+1.20%');
        expect(rows[2]).toHaveTextContent('Lane 2');
        expect(rows[2]).toHaveTextContent('-0.90%');
        // A lane nobody has run yet has no average and no advantage to report.
        expect(rows[3]).toHaveTextContent('Lane 3');
        expect(rows[3]).toHaveTextContent('—');
    });
});

describe('highlights', () => {
    it('shows the fastest heat and the closest race, each labelled', () => {
        renderStats(statsPayload({
            highlights: [
                { type: 'FASTEST_HEAT', roundName: 'Round 1', heatNumber: 2, globalHeatNumber: 5, racerName: 'Ada Lovelace', time: 3.123, margin: null },
                { type: 'CLOSEST_RACE', roundName: 'Round 2', heatNumber: 1, globalHeatNumber: null, racerName: null, time: null, margin: 0.014 },
            ],
        }));

        expect(screen.getByText('Fastest Heat')).toBeInTheDocument();
        expect(screen.getByText('3.123s')).toBeInTheDocument();
        expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
        expect(screen.getByText('Round 1, Heat 5')).toBeInTheDocument();

        expect(screen.getByText('Closest Race')).toBeInTheDocument();
        expect(screen.getByText('Δ 0.014s')).toBeInTheDocument();
        // No globalHeatNumber on this one — falls back to the round-local number.
        expect(screen.getByText('Round 2, Heat 1')).toBeInTheDocument();
    });

    it('is absent when the race has no highlights yet', () => {
        renderStats(statsPayload({ highlights: [] }));
        expect(screen.queryByText('Top Moments')).toBeNull();
    });
});

describe('den comparison', () => {
    it('shows each den\'s racer count, average score and best racer', () => {
        renderStats(statsPayload({
            denStats: [
                { denId: 1, denName: 'Wolves', denColor: '#ff0000', racerCount: 5, avgScore: 3.45, bestRacerName: 'Ada Lovelace' },
                { denId: 2, denName: 'Tigers', denColor: '#00ff00', racerCount: 3, avgScore: null, bestRacerName: null },
            ],
        }));

        const table = screen.getByText('Best Racer').closest('table')!;
        const rows = within(table).getAllByRole('row');
        expect(rows[1]).toHaveTextContent('Wolves');
        expect(rows[1]).toHaveTextContent('5');
        expect(rows[1]).toHaveTextContent('3.450s');
        expect(rows[1]).toHaveTextContent('Ada Lovelace');
        // No score and no standout racer yet — both fall back to an em dash.
        expect(rows[2]).toHaveTextContent('Tigers');
        expect(rows[2]).toHaveTextContent('—');
    });

    it('is absent when the race has no dens', () => {
        renderStats(statsPayload({ denStats: [] }));
        expect(screen.queryByText('Den Comparison')).toBeNull();
    });
});
