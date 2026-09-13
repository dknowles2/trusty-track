/**
 * What happened, and when (#219).
 *
 * An operator finishes an event and finds a time they do not recognise, or a
 * round that is not the one they built. The database holds the current state
 * and, until now, no record of how it got there.
 *
 * The rules are in `activityLog.ts`; the sentence on each line comes from the
 * server, rendered from the entry alone so it cannot drift as the race changes
 * underneath it.
 */

import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useClient, useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiAlertCircleOutline, mdiRefresh } from '@mdi/js';

import BackLink from '../../core/components/BackLink';
import { GET_RACES_NAV } from '../../core/graphql/queries';
import { useRaceStateChanged } from '../../core/hooks/useRaceStateChanged';
import { ACTIVITY_LOG_LIVE_QUERY, ACTIVITY_LOG_QUERY } from '../graphql/queries';
import { applyPendingEntries, pendingSince, readLiveSetting, writeLiveSetting } from '../activityLive';
import {
    appendPage,
    byDay,
    detailPairs,
    hasAnotherPage,
    roleLabel,
    timeOfDay,
    type LogEntry,
} from '../activityLog';

const PAGE_SIZE = 200;

/**
 * One race's own live subscription, for the "all races" view (#1078).
 *
 * `useRaceStateChanged` is one hook per race — there is no argument-free
 * "every race" channel (`.claude/rules/frontend-screens.md`'s "The race list
 * survives a second tab" explains why `racesChanged` itself stays a bare
 * signal rather than growing this kind of per-race payload). With no race
 * filter, Live opens one subscription per race in the list instead — all of
 * them multiplexed over the single shared `graphql-ws` socket
 * (`api/graphqlClient.ts`), not a socket each, and bounded by `GET_RACES_NAV`
 * itself (the backend's `Query.races` defaults to `limit=100`) rather than
 * literally every race an install has ever run. Cheap on a single-operator
 * LAN either way, and the only way to cover the unfiltered view without a
 * second backend channel.
 */
function RaceLiveWatcher({ raceId, onEvent }: { raceId: number; onEvent: () => void }) {
    useRaceStateChanged(raceId, onEvent, { alwaysRefetch: true });
    return null;
}

export default function ActivityLog() {
    const [params, setParams] = useSearchParams();
    const raceParam = params.get('race');
    const raceId = raceParam ? parseInt(raceParam) : null;

    // Off by default. An address against every line is noise until the one
    // evening somebody needs to know which device did something.
    const [showAddresses, setShowAddresses] = useState(false);

    // `beforeId` is the page cursor; `loaded` is every page fetched so far,
    // merged (#889). A race filter change has to start back at page one — a
    // cursor from one filter names nothing under another — so that reset
    // happens during render (comparing against the previous render's
    // `raceId`, the officially documented "adjusting state when a prop
    // changes" shape — see https://react.dev/learn/you-might-not-need-an-effect),
    // rather than in an effect that would show a stale page for one frame
    // first. `RaceControl` uses the same shape for its own pinned selection.
    const [beforeId, setBeforeId] = useState<number | null>(null);
    const [loaded, setLoaded] = useState<LogEntry[]>([]);
    const [previousRaceId, setPreviousRaceId] = useState(raceId);

    // Live (#1078): off by default, remembered per device, the same shape as
    // the finish chime. New entries wait in `pending` — a chip below the
    // filter line — rather than landing straight in `loaded`, so an operator
    // who has scrolled down or loaded older pages does not have the page grow
    // out from under them.
    const [live, setLive] = useState(() => readLiveSetting());
    const [pending, setPending] = useState<LogEntry[]>([]);

    if (previousRaceId !== raceId) {
        setPreviousRaceId(raceId);
        if (beforeId !== null) setBeforeId(null);
        if (pending.length !== 0) setPending([]);
    }

    const [{ data, fetching, error }, refetch] = useQuery({
        query: ACTIVITY_LOG_QUERY,
        variables: { raceId, limit: PAGE_SIZE, beforeId },
        requestPolicy: 'network-only',
    });

    const page: LogEntry[] = useMemo(() => data?.auditLog ?? [], [data]);

    // Merge this page onto what is loaded the moment new data arrives — the
    // same "adjust state during render" shape as the race-filter reset
    // above, rather than an effect: this is "sync a newly arrived response
    // into state" with no further computation, exactly what
    // `react-hooks/set-state-in-effect` flags, and an effect would show a
    // stale page for one extra frame regardless. `processedData` guards
    // against looping — `setLoaded` triggers a re-render, but `data` itself
    // only changes when urql completes a new fetch, so the check is false on
    // the very next pass. `beforeId === null` means this is a fresh first
    // page (a filter change or Refresh) rather than "Load older entries"
    // continuing the list already on screen.
    const [processedData, setProcessedData] = useState(data);
    if (data && data !== processedData) {
        setProcessedData(data);
        setLoaded((prev) => appendPage(prev, page, beforeId === null));
    }

    const canLoadMore = hasAnotherPage(page, PAGE_SIZE);

    const handleRefresh = () => {
        if (pending.length !== 0) setPending([]);
        if (beforeId === null) {
            refetch({ requestPolicy: 'network-only' });
        } else {
            setBeforeId(null);
        }
    };

    const handleLoadMore = () => {
        const last = loaded[loaded.length - 1];
        if (last) setBeforeId(last.id);
    };

    // Bumped on every toggle, and read back by an in-flight live poll's own
    // `.then` (below) before it acts on what it fetched — a reviewer's own
    // finding on #1078's PR. A `race_state` event can start a poll and Live
    // be switched off before that poll's response lands; without this, the
    // stale `.then` still calls `setPending`, flashing the "N new entries"
    // chip back onto a page that toggling off was supposed to leave exactly
    // as it was. Read and written only from event handlers and promise
    // callbacks, never from the render body itself, so it carries none of
    // the "ref touched during render" trap `loaded` is deliberately closed
    // over by value for elsewhere in this file.
    const liveEpochRef = useRef(0);

    const handleToggleLive = (enabled: boolean) => {
        liveEpochRef.current += 1;
        setLive(enabled);
        writeLiveSetting(enabled);
        // Off is meant to read as "exactly today's behaviour" — a chip left
        // over from a moment ago would say otherwise.
        if (!enabled && pending.length !== 0) setPending([]);
    };

    const handleShowPending = () => {
        setLoaded((prev) => applyPendingEntries(prev, pending));
        setPending([]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Live's own poll: always the newest page for the current filter,
    // through `ACTIVITY_LOG_LIVE_QUERY` rather than the visible query above —
    // see that document's own comment for why a shared key would matter here.
    // A plain function, recreated each render so it always closes over the
    // current `loaded` — `useSubscription` (inside `useRaceStateChanged` and
    // `RaceLiveWatcher`) keeps its own ref to the latest handler and does not
    // resubscribe when it changes identity, so there is nothing to memoize
    // here, and memoizing it would mean either a stale `loaded` or a ref
    // written during render.
    const client = useClient();
    const handleLiveEvent = () => {
        const epoch = liveEpochRef.current;
        client
            .query(
                ACTIVITY_LOG_LIVE_QUERY,
                { raceId, limit: PAGE_SIZE, beforeId: null },
                { requestPolicy: 'network-only' },
            )
            .toPromise()
            .then((result) => {
                // Live may have been switched off (or the race filter
                // changed and switched back on) while this was in flight —
                // `handleToggleLive` bumped the epoch, so a stale response
                // here is dropped rather than resurrecting the chip.
                if (epoch !== liveEpochRef.current) return;
                const fresh: LogEntry[] = result.data?.auditLog ?? [];
                setPending(pendingSince(loaded, fresh));
            })
            .catch(() => {
                // Best-effort: a failed live refresh leaves the operator no
                // worse off than before Live existed — Refresh still works.
            });
    };

    // Filtered to one race: a single subscription on that race. Filtered to
    // "all races": no bare "every race" channel exists (see `RaceLiveWatcher`
    // above), so the race list is fetched only to open one subscription per
    // race — see that component's own comment for why that is still cheap.
    const filteredToRace = raceId != null;
    const [{ data: racesForLiveData }] = useQuery({
        query: GET_RACES_NAV,
        pause: !live || filteredToRace,
    });
    const racesForLive: { id: number }[] = racesForLiveData?.races ?? [];
    const liveRaceIds: number[] =
        live && !filteredToRace ? racesForLive.map((race) => race.id) : [];

    useRaceStateChanged(live && filteredToRace ? (raceId ?? undefined) : undefined, handleLiveEvent, {
        pause: !live || !filteredToRace,
        alwaysRefetch: true,
    });

    // `new Date()` at render rather than in the rules, which stay pure and let
    // a test pin what "Today" means.
    const sections = useMemo(() => byDay(loaded, new Date()), [loaded]);

    if (error) {
        // The query is operator-only and enforces that itself, so the ordinary
        // way to land here is a device that holds the check-in PIN or none.
        return (
            <div className="container" style={{ padding: '2rem' }}>
                <h2>Activity log</h2>
                <p style={{ color: 'var(--text-muted-color)' }}>
                    This page is for the operator's device. Unlock with the operator PIN to
                    see it.
                </p>
                <BackLink destination={{ to: '/system-settings', label: 'Back to settings' }} />
            </div>
        );
    }

    return (
        <div className="container" style={{ padding: '2rem', maxWidth: '900px' }}>
            <BackLink destination={{ to: '/system-settings', label: 'Back to settings' }} />

            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    gap: '1rem',
                }}
            >
                <h2 style={{ margin: 0 }}>Activity log</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <label
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '0.85rem',
                            color: 'var(--text-strong-muted-color)',
                            cursor: 'pointer',
                        }}
                    >
                        <input
                            type="checkbox"
                            data-testid="live-activity"
                            checked={live}
                            onChange={(e) => handleToggleLive(e.target.checked)}
                        />
                        Live
                    </label>
                    <label
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '0.85rem',
                            color: 'var(--text-strong-muted-color)',
                            cursor: 'pointer',
                        }}
                    >
                        <input
                            type="checkbox"
                            data-testid="show-addresses"
                            checked={showAddresses}
                            onChange={(e) => setShowAddresses(e.target.checked)}
                        />
                        Show device addresses
                    </label>
                    <button
                        className="secondary-btn"
                        data-testid="refresh-activity"
                        onClick={handleRefresh}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 12px', fontSize: '0.85rem' }}
                    >
                        <Icon path={mdiRefresh} size={0.7} /> Refresh
                    </button>
                </div>
            </div>

            <p style={{ color: 'var(--text-muted-color)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                Everything anyone has done, newest first — including anything a device was
                refused. Heat results say whether the timer recorded them or somebody typed
                them in.
                {raceId != null && (
                    <>
                        {' '}
                        Showing one race only.{' '}
                        <button
                            data-testid="clear-race-filter"
                            onClick={() => setParams({})}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                font: 'inherit',
                                color: 'var(--scouting-blue)',
                                textDecoration: 'underline',
                                cursor: 'pointer',
                            }}
                        >
                            Show everything
                        </button>
                        .
                    </>
                )}
            </p>

            {pending.length > 0 && (
                <p style={{ marginTop: '0.5rem' }}>
                    <button
                        className="secondary-btn"
                        data-testid="activity-new-entries"
                        onClick={handleShowPending}
                        style={{ fontSize: '0.85rem', padding: '4px 12px' }}
                    >
                        {pending.length} new {pending.length === 1 ? 'entry' : 'entries'} — show
                    </button>
                </p>
            )}

            {fetching && loaded.length === 0 && <p>Loading…</p>}

            {!fetching && loaded.length === 0 && (
                <p data-testid="activity-empty" style={{ color: 'var(--text-muted-color)' }}>
                    Nothing recorded yet.
                </p>
            )}

            {sections.map((section) => (
                <section key={`${section.day}-${section.entries[0].id}`} style={{ marginTop: '1.5rem' }}>
                    <h3
                        style={{
                            fontSize: '0.95rem',
                            color: 'var(--text-heading-alt-color)',
                            borderBottom: '1px solid var(--border-faint-color)',
                            paddingBottom: '0.3rem',
                            margin: '0 0 0.5rem',
                        }}
                    >
                        {section.label}
                    </h3>
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {section.entries.map((entry) => (
                            <li
                                key={entry.id}
                                data-testid={`activity-entry-${entry.id}`}
                                data-outcome={entry.outcome}
                                style={{
                                    display: 'flex',
                                    gap: '0.75rem',
                                    padding: '0.5rem 0',
                                    borderBottom: '1px solid #f2f2f2',
                                    alignItems: 'baseline',
                                }}
                            >
                                <span
                                    style={{
                                        fontVariantNumeric: 'tabular-nums',
                                        color: 'var(--text-subtle-color)',
                                        fontSize: '0.85rem',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {timeOfDay(entry.at)}
                                </span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span
                                        style={{
                                            fontWeight: entry.noteworthy ? 600 : 400,
                                            color: entry.outcome === 'OK' ? 'var(--text-strong-color)' : 'var(--danger-strong-color)',
                                        }}
                                    >
                                        {entry.noteworthy && entry.outcome !== 'OK' && (
                                            <Icon
                                                path={mdiAlertCircleOutline}
                                                size={0.7}
                                                style={{ verticalAlign: '-2px', marginRight: '4px' }}
                                            />
                                        )}
                                        {entry.summary}
                                    </span>
                                    <span style={{ color: 'var(--text-quiet-color)', fontSize: '0.85rem' }}>
                                        {' · '}
                                        {roleLabel(entry.role)}
                                        {showAddresses && entry.sourceIp ? ` · ${entry.sourceIp}` : ''}
                                    </span>
                                    {detailPairs(entry.details).length > 0 && (
                                        <div
                                            style={{
                                                fontSize: '0.8rem',
                                                color: 'var(--text-subtle-color)',
                                                marginTop: '2px',
                                                wordBreak: 'break-word',
                                            }}
                                        >
                                            {detailPairs(entry.details)
                                                .map((pair) => `${pair.label}: ${pair.value}`)
                                                .join(' · ')}
                                        </div>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ol>
                </section>
            ))}

            {canLoadMore && (
                <p style={{ marginTop: '1rem' }}>
                    <button
                        className="secondary-btn"
                        data-testid="load-older-activity"
                        onClick={handleLoadMore}
                        disabled={fetching}
                        style={{ fontSize: '0.85rem', padding: '4px 12px' }}
                    >
                        {fetching ? 'Loading…' : 'Load older entries'}
                    </button>
                </p>
            )}

            {liveRaceIds.map((watchedRaceId: number) => (
                <RaceLiveWatcher key={watchedRaceId} raceId={watchedRaceId} onEvent={handleLiveEvent} />
            ))}
        </div>
    );
}
