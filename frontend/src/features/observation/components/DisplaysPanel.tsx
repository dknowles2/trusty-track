/**
 * The operator's list of audience displays (#174).
 *
 * Each screen registers itself by subscribing, so this list fills in on its
 * own as displays are opened around the room — there is nothing to add by
 * hand, and nothing to add *before* an event either.
 *
 * A screen that has gone quiet stays listed and says so. That is how the
 * operator finds out the projector at the back has dropped off the wifi, and
 * it is why nothing here removes a row automatically: a display switched off
 * looks exactly like one whose network died, and only a person can tell them
 * apart.
 */

import { useState } from 'react';
import { useMutation, useQuery, useSubscription } from 'urql';
import { Icon } from '@mdi/react';
import { mdiCheckCircle, mdiCircleOutline, mdiClose, mdiPencil } from '@mdi/js';

import {
    ADVANCE_DISPLAY,
    ASSIGN_DISPLAY,
    DISPLAYS_QUERY,
    DisplaysSubscription,
    FORGET_DISPLAY,
    RACE_AWARD_COUNT_QUERY,
    RENAME_DISPLAY,
} from '../graphql/queries';
import { viewCycles, viewOptionsFor, type DisplayView } from '../displayView';

interface DisplayRow {
    displayId: string;
    name: string;
    view: DisplayView;
    cycleSeconds: number;
    description: string;
    pacedByAPerson: boolean;
    connected: boolean;
}

export default function DisplaysPanel({ raceId }: { raceId: number }) {
    // Query and subscription both: the query answers on load, the
    // subscription keeps it current. A subscription alone shows an empty list
    // until something changes, which on a quiet minute is most of the event.
    const [queryResult] = useQuery({ query: DISPLAYS_QUERY, variables: { raceId }, pause: !raceId });
    const [liveResult] = useSubscription({ query: DisplaysSubscription, variables: { raceId }, pause: !raceId });

    // Whether the ceremony is worth offering at all. Read fresh on every
    // visit to this tab, so an award set up a minute ago on the Awards page
    // is reflected here — the cached answer would be the one from before it
    // existed.
    const [awardsResult] = useQuery({
        query: RACE_AWARD_COUNT_QUERY,
        variables: { raceId },
        pause: !raceId,
        requestPolicy: 'cache-and-network',
    });
    const hasAwards = (awardsResult.data?.race?.awards?.length ?? 0) > 0;

    const [, assignDisplay] = useMutation(ASSIGN_DISPLAY);
    const [, advanceDisplay] = useMutation(ADVANCE_DISPLAY);
    const [, renameDisplay] = useMutation(RENAME_DISPLAY);
    const [, forgetDisplay] = useMutation(FORGET_DISPLAY);

    const [renaming, setRenaming] = useState<string | null>(null);
    const [draftName, setDraftName] = useState('');

    const displays: DisplayRow[] = liveResult.data?.displays ?? queryResult.data?.displays ?? [];

    if (displays.length === 0) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                <p style={{ margin: 0 }}>No audience displays are open yet.</p>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                    Open <strong>Live</strong> on a screen anywhere on this network and it will
                    appear here — there is nothing to set up first.
                </p>
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
            {displays.map((display) => (
                <div
                    key={display.displayId}
                    data-testid={`display-${display.displayId}`}
                    style={{
                        border: '1px solid #ddd',
                        borderRadius: '12px',
                        padding: '0.85rem 1rem',
                        background: display.connected ? 'white' : '#fafafa',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        alignItems: 'center',
                    }}
                >
                    <Icon
                        path={display.connected ? mdiCheckCircle : mdiCircleOutline}
                        size={0.8}
                        color={display.connected ? '#2e7d32' : '#bbb'}
                    />

                    <div style={{ flex: 1, minWidth: '180px' }}>
                        {renaming === display.displayId ? (
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    renameDisplay({ displayId: display.displayId, name: draftName });
                                    setRenaming(null);
                                }}
                                style={{ display: 'flex', gap: '0.4rem' }}
                            >
                                <input
                                    autoFocus
                                    value={draftName}
                                    onChange={(e) => setDraftName(e.target.value)}
                                    placeholder="e.g. Gym north"
                                    style={{ flex: 1, padding: '0.3rem', borderRadius: '4px', border: '1px solid #ccc' }}
                                />
                                <button type="submit" className="secondary-btn" style={{ padding: '0.3rem 0.7rem' }}>
                                    Save
                                </button>
                            </form>
                        ) : (
                            <>
                                <strong>{display.name}</strong>{' '}
                                <button
                                    type="button"
                                    aria-label={`Rename ${display.name}`}
                                    onClick={() => {
                                        setRenaming(display.displayId);
                                        setDraftName(display.name);
                                    }}
                                    style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer' }}
                                >
                                    <Icon path={mdiPencil} size={0.6} color="#888" />
                                </button>
                                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                                    {display.connected ? display.description : 'Not connected'}
                                </div>
                            </>
                        )}
                    </div>

                    <select
                        aria-label={`What ${display.name} shows`}
                        value={display.view}
                        onChange={(e) =>
                            assignDisplay({
                                displayId: display.displayId,
                                view: e.target.value as DisplayView,
                            })
                        }
                        style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid #ccc' }}
                    >
                        {/* The ceremony is missing from a race with no awards
                            — it would send the screen to a page with nothing
                            on it — but stays for a screen already showing
                            one, or the row would say nothing about what it is
                            doing. */}
                        {viewOptionsFor(hasAwards, display.view).map((option) => (
                            <option key={option.view} value={option.view}>
                                {option.label}
                            </option>
                        ))}
                    </select>

                    {/* Every view that advances on a timer gets the same
                        seconds control — the tab cycle and the photo
                        slideshow alike. Naming views here was the bug: the
                        slideshow cycled at an interval nothing offered to
                        change. */}
                    {viewCycles(display.view) && (
                        <label style={{ fontSize: '0.85rem', color: '#666' }}>
                            every{' '}
                            <input
                                type="number"
                                min={1}
                                aria-label={`Cycle interval for ${display.name}`}
                                value={display.cycleSeconds}
                                onChange={(e) => {
                                    const seconds = parseInt(e.target.value);
                                    // Refused by the server too — a zero
                                    // interval is a busy loop and a negative
                                    // one fires continuously.
                                    if (seconds >= 1) {
                                        assignDisplay({
                                            displayId: display.displayId,
                                            view: display.view,
                                            cycleSeconds: seconds,
                                        });
                                    }
                                }}
                                style={{ width: '4rem', padding: '0.25rem', borderRadius: '4px', border: '1px solid #ccc' }}
                            />{' '}
                            s
                        </label>
                    )}

                    {/* The ceremony waits for a person, and until now that
                        person had to be standing at the screen — which is the
                        one place the operator is not, having just assigned it
                        from across the room. The keys and a presenter remote
                        at the screen go on working: these send a *step*, so
                        both drivers move the same ceremony. */}
                    {display.pacedByAPerson && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <button
                                type="button"
                                aria-label={`Previous award on ${display.name}`}
                                disabled={!display.connected}
                                onClick={() => advanceDisplay({ displayId: display.displayId, delta: -1 })}
                                className="secondary-btn"
                                style={{ padding: '0.25rem 0.6rem' }}
                            >
                                ‹
                            </button>
                            <span style={{ fontSize: '0.8rem', color: '#7a5b00', background: '#fff3cd', border: '1px solid #ffe08a', borderRadius: '20px', padding: '2px 8px' }}>
                                You advance this one
                            </span>
                            <button
                                type="button"
                                aria-label={`Next award on ${display.name}`}
                                disabled={!display.connected}
                                onClick={() => advanceDisplay({ displayId: display.displayId, delta: 1 })}
                                className="secondary-btn"
                                style={{ padding: '0.25rem 0.6rem' }}
                            >
                                ›
                            </button>
                        </span>
                    )}

                    {!display.connected && (
                        <button
                            type="button"
                            aria-label={`Forget ${display.name}`}
                            onClick={() => forgetDisplay({ displayId: display.displayId })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
                        >
                            <Icon path={mdiClose} size={0.7} color="var(--error)" />
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
