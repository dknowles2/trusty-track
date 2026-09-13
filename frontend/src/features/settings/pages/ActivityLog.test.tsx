// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useClient, useQuery, useSubscription } from 'urql';
import ActivityLog from './ActivityLog';
import { ACTIVITY_LOG_QUERY, ACTIVITY_LOG_LIVE_QUERY } from '../graphql/queries';
import { GET_RACES_NAV } from '../../core/graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn(), useSubscription: vi.fn(), useClient: vi.fn() };
});

const STORAGE_KEY = 'trustytrack.activityLive';

const mainRefetch = vi.fn();
const clientQuery = vi.fn();

const entry = (id: number) => ({
    id,
    at: '2026-09-13T12:00:00Z',
    action: 'createRace',
    role: 'OPERATOR',
    outcome: 'OK',
    summary: `Entry ${id}`,
    noteworthy: false,
    raceId: 1,
    sourceIp: null,
    details: null,
});

/**
 * Renders the page with an optional `?race=` filter.
 *
 * `rerenderSame` re-renders the identical element — used after changing what
 * the mocked `ACTIVITY_LOG_QUERY` returns, since `ActivityLog`'s own "adjust
 * state during render" merge only runs when `data` is a genuinely new
 * reference, which nothing inside a single render pass produces on its own.
 */
function renderPage(raceQuery = '?race=1') {
    const buildUi = () => (
        <MemoryRouter initialEntries={[`/activity${raceQuery}`]}>
            <ActivityLog />
        </MemoryRouter>
    );
    const utils = render(buildUi());
    // A fresh element each call, not the same object handed back a second
    // time — some ancestor here (react-router's own provider, most likely)
    // otherwise short-circuits and never re-invokes `ActivityLog` at all.
    return { ...utils, rerenderSame: () => utils.rerender(buildUi()) };
}

/**
 * The most recent `useSubscription` call matching a race id in its
 * variables — `undefined` is the paused, no-race call every render makes at
 * least once. The *most recent* one, not merely the first: `ActivityLog`
 * hands `useRaceStateChanged` a fresh handler on every render so it always
 * closes over the current `loaded` (see that file's own comment), so an
 * earlier call's handler can close over a `loaded` a later render replaced.
 */
function subscriptionCallFor(raceId: number | undefined) {
    const calls = vi.mocked(useSubscription).mock.calls;
    for (let i = calls.length - 1; i >= 0; i--) {
        const call = calls[i];
        if ((call[0] as { variables?: { raceId?: number } }).variables?.raceId === raceId) return call;
    }
    return undefined;
}

// A stable reference, not recreated per render: the component's own "adjust
// state during render" merge (`data !== processedData`) relies on urql only
// handing back a new `data` object when a new result actually arrives — a
// naive mock that built a fresh object on every call never satisfied that
// comparison and looped forever. Starts `undefined` (the "still fetching"
// state a real first render is in) so a test that wants a populated `loaded`
// sets it once and forces one `rerenderSame()`, the same shape a real fetch
// resolving would produce.
let mainQueryData: { auditLog: ReturnType<typeof entry>[] } | undefined;
const racesNavData = { races: [] as { id: number }[] };

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // jsdom does not implement scrollTo; the chip's click handler calls it to
    // return the operator to the top of the page.
    window.scrollTo = vi.fn();
    mainQueryData = undefined;

    clientQuery.mockReturnValue({ toPromise: () => Promise.resolve({ data: { auditLog: [] } }) });
    vi.mocked(useClient).mockReturnValue({ query: clientQuery } as unknown as ReturnType<typeof useClient>);

    vi.mocked(useQuery).mockImplementation((args: { query: unknown }) => {
        if (args.query === ACTIVITY_LOG_QUERY) {
            return [
                { data: mainQueryData, fetching: mainQueryData === undefined, error: undefined },
                mainRefetch,
            ] as unknown as ReturnType<typeof useQuery>;
        }
        if (args.query === GET_RACES_NAV) {
            return [
                { data: racesNavData, fetching: false, error: undefined },
                vi.fn(),
            ] as unknown as ReturnType<typeof useQuery>;
        }
        throw new Error(`unexpected useQuery call: ${JSON.stringify(args)}`);
    });

    vi.mocked(useSubscription).mockReturnValue([
        { fetching: false, data: undefined, error: undefined },
        vi.fn(),
    ] as unknown as ReturnType<typeof useSubscription>);
});

afterEach(() => {
    cleanup();
});

describe('the Live toggle', () => {
    it('is off by default', () => {
        renderPage();
        expect(screen.getByTestId('live-activity')).not.toBeChecked();
    });

    it('reads a device that already turned it on', () => {
        window.localStorage.setItem(STORAGE_KEY, 'on');
        renderPage();
        expect(screen.getByTestId('live-activity')).toBeChecked();
    });

    it('persists across a remount, the same shape as the finish chime', () => {
        const { unmount } = renderPage();
        fireEvent.click(screen.getByTestId('live-activity'));
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('on');

        unmount();
        renderPage();
        expect(screen.getByTestId('live-activity')).toBeChecked();
    });

    it('subscribes to the filtered race only once Live is switched on', () => {
        renderPage();
        // Off: the hook is still called (hooks are unconditional), but with
        // no race id at all — `ActivityLog` passes `undefined` rather than a
        // real id whenever Live is off, so there is nothing a stray message
        // could be delivered against even before `pause` is considered.
        const pausedCall = subscriptionCallFor(undefined);
        expect((pausedCall?.[0] as { pause?: boolean } | undefined)?.pause).toBe(true);

        fireEvent.click(screen.getByTestId('live-activity'));

        const liveCall = subscriptionCallFor(1);
        expect((liveCall?.[0] as { pause?: boolean } | undefined)?.pause).toBe(false);
    });
});

describe('a race_state event while Live is on', () => {
    it('refetches the front page — even for a kind the normalized cache could merge on its own', () => {
        window.localStorage.setItem(STORAGE_KEY, 'on');
        renderPage();

        const call = subscriptionCallFor(1);
        expect(call).toBeDefined();
        const handler = call![1] as (previous: unknown, data: unknown) => unknown;

        // HEAT_RESULT with a heat payload is exactly the kind `useRaceStateChanged`'s
        // default gate swallows on every *other* screen (#12) — the activity log
        // still needs it, since it means a fresh audit entry exists.
        handler(undefined, { raceStateChanged: { raceId: 1, kind: 'HEAT_RESULT', heat: { id: 9 } } });

        expect(clientQuery).toHaveBeenCalledWith(
            ACTIVITY_LOG_LIVE_QUERY,
            { raceId: 1, limit: 200, beforeId: null },
            { requestPolicy: 'network-only' },
        );
    });

    it('leaves the subscription paused, so urql never delivers it an event', () => {
        // Live off means the socket is paused rather than open-but-ignored —
        // real urql never invokes this handler at all while `pause` is true,
        // which is what "off = today's behaviour exactly" actually rests on.
        renderPage();

        const call = subscriptionCallFor(undefined);
        expect((call?.[0] as { pause?: boolean } | undefined)?.pause).toBe(true);
        expect(clientQuery).not.toHaveBeenCalled();
    });

    it('shows a "new entries" chip rather than changing the list immediately, and keeps what was already loaded', async () => {
        window.localStorage.setItem(STORAGE_KEY, 'on');
        const { rerenderSame } = renderPage();

        // The page's own first page has already loaded, same as any operator
        // who opened this page before switching Live on.
        mainQueryData = { auditLog: [entry(2), entry(1)] };
        rerenderSame();
        expect(screen.getByTestId('activity-entry-2')).toBeInTheDocument();
        expect(screen.getByTestId('activity-entry-1')).toBeInTheDocument();

        clientQuery.mockReturnValue({
            toPromise: () => Promise.resolve({ data: { auditLog: [entry(3), entry(2), entry(1)] } }),
        });
        const call = subscriptionCallFor(1);
        const handler = call![1] as (previous: unknown, data: unknown) => unknown;
        handler(undefined, { raceStateChanged: { raceId: 1, kind: 'OTHER' } });

        const chip = await screen.findByTestId('activity-new-entries');
        expect(chip).toHaveTextContent('1 new entry');
        expect(screen.queryByTestId('activity-entry-3')).toBeNull();

        fireEvent.click(chip);
        expect(await screen.findByTestId('activity-entry-3')).toBeInTheDocument();
        // What was already on screen survives the merge — the whole point of
        // buffering rather than replacing outright.
        expect(screen.getByTestId('activity-entry-2')).toBeInTheDocument();
        expect(screen.getByTestId('activity-entry-1')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-new-entries')).toBeNull();
    });
});

describe('filters', () => {
    it('carries the race filter onto the live poll', () => {
        window.localStorage.setItem(STORAGE_KEY, 'on');
        renderPage('?race=42');

        const call = subscriptionCallFor(42);
        const handler = call![1] as (previous: unknown, data: unknown) => unknown;
        handler(undefined, { raceStateChanged: { raceId: 42, kind: 'OTHER' } });

        expect(clientQuery).toHaveBeenCalledWith(
            ACTIVITY_LOG_LIVE_QUERY,
            { raceId: 42, limit: 200, beforeId: null },
            { requestPolicy: 'network-only' },
        );
    });
});
