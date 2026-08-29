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

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiAlertCircleOutline, mdiArrowLeft, mdiRefresh } from '@mdi/js';

import { ACTIVITY_LOG_QUERY } from '../graphql/queries';
import {
    byDay,
    detailPairs,
    roleLabel,
    timeOfDay,
    type LogEntry,
} from '../activityLog';

const PAGE_SIZE = 200;

export default function ActivityLog() {
    const [params, setParams] = useSearchParams();
    const raceParam = params.get('race');
    const raceId = raceParam ? parseInt(raceParam) : null;

    // Off by default. An address against every line is noise until the one
    // evening somebody needs to know which device did something.
    const [showAddresses, setShowAddresses] = useState(false);

    const [{ data, fetching, error }, refetch] = useQuery({
        query: ACTIVITY_LOG_QUERY,
        variables: { raceId, limit: PAGE_SIZE, beforeId: null },
        requestPolicy: 'network-only',
    });

    const entries: LogEntry[] = useMemo(() => data?.auditLog ?? [], [data]);
    // `new Date()` at render rather than in the rules, which stay pure and let
    // a test pin what "Today" means.
    const sections = useMemo(() => byDay(entries, new Date()), [entries]);

    if (error) {
        // The query is operator-only and enforces that itself, so the ordinary
        // way to land here is a device that holds the check-in PIN or none.
        return (
            <div className="container" style={{ padding: '2rem' }}>
                <h2>Activity</h2>
                <p style={{ color: 'var(--text-muted-color)' }}>
                    This page is for the operator's device. Unlock with the operator PIN to
                    see it.
                </p>
                <Link to="/system-settings">&larr; Back to settings</Link>
            </div>
        );
    }

    return (
        <div className="container" style={{ padding: '2rem', maxWidth: '900px' }}>
            <Link
                to="/system-settings"
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: 'var(--scouting-blue)',
                    fontSize: '0.85rem',
                    marginBottom: '0.5rem',
                }}
            >
                <Icon path={mdiArrowLeft} size={0.7} /> Back to settings
            </Link>

            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    gap: '1rem',
                }}
            >
                <h2 style={{ margin: 0 }}>Activity</h2>
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
                            data-testid="show-addresses"
                            checked={showAddresses}
                            onChange={(e) => setShowAddresses(e.target.checked)}
                        />
                        Show device addresses
                    </label>
                    <button
                        className="secondary-btn"
                        data-testid="refresh-activity"
                        onClick={() => refetch({ requestPolicy: 'network-only' })}
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

            {fetching && entries.length === 0 && <p>Loading…</p>}

            {!fetching && entries.length === 0 && (
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

            {entries.length >= PAGE_SIZE && (
                <p style={{ color: 'var(--text-subtle-color)', fontSize: '0.85rem', marginTop: '1rem' }}>
                    Showing the most recent {PAGE_SIZE} entries.
                </p>
            )}
        </div>
    );
}
