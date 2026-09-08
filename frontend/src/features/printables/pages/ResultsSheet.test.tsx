// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useQuery } from 'urql';
import ResultsSheet from './ResultsSheet';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

interface RaceFixtureRound {
    id: number;
    name: string | null;
    roundNumber: number;
    advancementSource: string | null;
}

interface RaceFixtureLeaderboardEntry {
    racerId: number;
    rank: number;
    firstName: string;
    lastName: string;
    carNumber: number | null;
    racingGroupName: string | null;
    score: number;
    heatsCompleted: number;
}

interface RaceFixture {
    id: number;
    name: string;
    dateTime: string;
    location: string;
    scoringStrategy: string;
    resolvedNameDisplay: string;
    rounds: RaceFixtureRound[];
    leaderboard: RaceFixtureLeaderboardEntry[];
    racers: { id: number; excludedFromStandings: boolean }[];
    awards: unknown[];
}

const RACE: RaceFixture = {
    id: 1,
    name: 'Pack 42 Derby',
    dateTime: '2026-03-14T09:30:00',
    location: 'St Anne’s Hall',
    scoringStrategy: 'TIMED',
    resolvedNameDisplay: 'FULL',
    rounds: [{ id: 1, name: null, roundNumber: 1, advancementSource: null }],
    leaderboard: [
        {
            racerId: 1,
            rank: 1,
            firstName: 'Ada',
            lastName: 'Lovelace',
            carNumber: 42,
            racingGroupName: 'Wolves',
            score: 3.1,
            heatsCompleted: 4,
        },
    ],
    racers: [{ id: 1, excludedFromStandings: false }],
    awards: [],
};

/**
 * `ResultsSheet` issues two `useQuery` calls: the static `GetResultsSheet`
 * document (a parsed `gql` node) and, once it has read the race's
 * championship round ids, a dynamically-built raw-string query aliasing
 * `leaderboard(roundId:)` per round (`championshipResultsQuery`) — or the
 * paused `Noop` fallback when there is none. This dispatches each call's
 * mocked response by which one it is, the same way the real client would
 * answer two different requests.
 */
function mockData(raceOverrides: Partial<RaceFixture> = {}, championshipEntriesByRoundId: Record<number, unknown[]> = {}) {
    const race = { ...RACE, ...raceOverrides };
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((opts: { query: unknown }) => {
        const isGqlDoc = typeof opts.query === 'object' && opts.query !== null;
        const name = isGqlDoc
            ? // @ts-expect-error - reaching into the parsed gql AST for its operation name
              opts.query.definitions?.[0]?.name?.value
            : (opts.query as string);

        if (name === 'GetResultsSheet') {
            return [{ data: { race, initialConfig: { printablesTheme: null } }, fetching: false, error: undefined }, vi.fn()];
        }
        // The championship query (or the paused Noop fallback) — build a
        // `race` payload carrying one aliased field per round id.
        const championshipRace: Record<string, unknown> = { id: race.id };
        for (const [roundId, entries] of Object.entries(championshipEntriesByRoundId)) {
            championshipRace[`round${roundId}`] = entries;
        }
        return [{ data: { race: championshipRace }, fetching: false, error: undefined }, vi.fn()];
    });
}

function open() {
    return render(
        <MemoryRouter initialEntries={['/race/1/print/results']}>
            <Routes>
                <Route path="/race/:raceId/print/results" element={<ResultsSheet />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('ResultsSheet', () => {
    it('prints the overall table with no championship section when the race has none', () => {
        mockData();
        open();

        expect(screen.getByText('Overall standings')).toBeInTheDocument();
        expect(screen.getByText('Qualifying rounds only.')).toBeInTheDocument();
    });

    // #869 — the printed sheet used to leave the championship round out
    // entirely, pointing readers at an "awards above" section a race with
    // no awards defined never has.
    it('prints a table for a raced championship round, right after the overall table', () => {
        mockData(
            {
                rounds: [
                    { id: 1, name: null, roundNumber: 1, advancementSource: null },
                    { id: 2, name: 'Grand Finals', roundNumber: 2, advancementSource: 'ALL' },
                ],
            },
            {
                2: [
                    {
                        racerId: 1,
                        rank: 1,
                        firstName: 'Zack',
                        lastName: 'Quick',
                        carNumber: 401,
                        score: 3.0,
                        heatsCompleted: 1,
                    },
                ],
            },
        );
        open();

        const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
        // Toolbar heading first ("Results sheet"), then the overall table,
        // then the championship table — before any per-den table.
        expect(headings).toEqual(['Results sheet', 'Overall standings', 'Grand Finals']);
        expect(screen.getByText('Zack Quick')).toBeInTheDocument();
        expect(
            screen.getByText('Qualifying rounds only — the championship result is above.'),
        ).toBeInTheDocument();
    });

    it('leaves an unraced championship round off the sheet', () => {
        mockData(
            {
                rounds: [
                    { id: 1, name: null, roundNumber: 1, advancementSource: null },
                    { id: 2, name: 'Grand Finals', roundNumber: 2, advancementSource: 'ALL' },
                ],
            },
            {
                // A placeholder-only round: nobody has raced it yet.
                2: [
                    {
                        racerId: -1,
                        rank: 1,
                        firstName: '',
                        lastName: '',
                        carNumber: null,
                        score: 0,
                        heatsCompleted: 0,
                    },
                ],
            },
        );
        open();

        expect(screen.queryByText('Grand Finals')).not.toBeInTheDocument();
        expect(screen.getByText('Qualifying rounds only.')).toBeInTheDocument();
    });

    // #883 — two racers tied for first used to print as 1 / 2.
    it('keeps a shared rank on the printed overall table', () => {
        mockData({
            leaderboard: [
                { racerId: 1, rank: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 1, racingGroupName: 'Wolves', score: 3.0, heatsCompleted: 4 },
                { racerId: 2, rank: 1, firstName: 'Grace', lastName: 'Hopper', carNumber: 2, racingGroupName: 'Wolves', score: 3.0, heatsCompleted: 4 },
                { racerId: 3, rank: 3, firstName: 'Alan', lastName: 'Turing', carNumber: 3, racingGroupName: 'Wolves', score: 3.5, heatsCompleted: 4 },
            ],
        });
        open();

        const overallRows = screen.getAllByRole('row').slice(1, 4); // skip the header row
        const places = overallRows.map((row) => row.querySelector('.heat-sheet-num')?.textContent);
        expect(places).toEqual(['1', '1', '3']);
    });
});
