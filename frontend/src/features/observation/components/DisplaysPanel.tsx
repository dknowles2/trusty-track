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
 *
 * `ConnectDisplayAddress` (#723) is the panel's own answer to the thing
 * every row here presupposes — that the screen in question already found
 * its way to this address. This is the *first* place an operator needs a
 * shareable address, before the Awards page's ballot share step ever did.
 */

import { useEffect, useRef, useState } from 'react';
import { useClient, useMutation, useQuery, useSubscription } from 'urql';
import { Icon } from '@mdi/react';
import {
    mdiCheckCircle,
    mdiCircleOutline,
    mdiClose,
    mdiDice5,
    mdiPencil,
    mdiFlashOutline,
    mdiOpenInNew,
} from '@mdi/js';

import {
    ADVANCE_DISPLAY,
    ASSIGN_DISPLAY,
    DISPLAYS_QUERY,
    DisplaysSubscription,
    FORGET_DISPLAY,
    IDENTIFY_DISPLAY,
    RACE_AWARD_COUNT_QUERY,
    RENAME_DISPLAY,
    SUGGEST_DISPLAY_NAME,
} from '../graphql/queries';
import {
    groupedViewOptions,
    VIEW_OPTIONS,
    viewCycles,
    viewHasCheckedInToggle,
    viewHasQrTargetToggle,
    viewHasStandingsTickerToggle,
    viewOptionsFor,
    viewScrolls,
    type DisplayView,
    type QRTarget,
    type ScrollBehavior,
} from '../displayView';
import { newDisplayWindowUrl } from '../displayIdentity';
import ConnectDisplayAddress from './ConnectDisplayAddress';
import { useRole } from '../../core/hooks/useRole';
import { NEEDS_OPERATOR_PIN_MESSAGE } from '../../core/roleMessage';
import { useTerminology } from '../../../context/TerminologyContext';

interface DisplayRow {
    displayId: string;
    name: string;
    view: DisplayView;
    cycleSeconds: number;
    scrollBehavior: ScrollBehavior;
    showCheckedIn: boolean;
    qrTarget: QRTarget;
    showStandingsTicker: boolean;
    description: string;
    pacedByAPerson: boolean;
    connected: boolean;
    identifySeq: number;
}

interface DisplaysPanelProps {
    raceId: number;
    /**
     * Told whenever the answer to "is any display known for this race"
     * changes (#850) — the Displays tab uses it to decide whether Scenes
     * has anything to apply to, rather than that panel running a second
     * query answering the same question this one already does.
     */
    onDisplaysChange?: (hasDisplays: boolean) => void;
}

export default function DisplaysPanel({ raceId, onDisplaysChange }: DisplaysPanelProps) {
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

    // #892: every mutation this panel runs (assignDisplay, advanceDisplay,
    // renameDisplay, forgetDisplay, identifyDisplay) is operator-only
    // (backend/api/auth.py's OPERATOR_ONLY_MUTATIONS) — a display holds no
    // PIN by design and registers by *subscribing*, never by calling one of
    // these itself (see ".claude/rules/displays.md"), so a check-in tablet
    // opening Race Control's Displays tab used to see every control here
    // fully enabled. "Open a new display window" is untouched: it is a
    // plain `window.open`, not a mutation.
    const { isOperator } = useRole();
    const operatorTitle = !isOperator ? NEEDS_OPERATOR_PIN_MESSAGE : undefined;

    // The one line under the select naming what the chosen view actually
    // shows (#948) — two of the ten descriptions mention the racing-group
    // or vehicle word ("Racer photos", "Check-in progress"), so this is
    // resolved once here rather than in `displayView.ts` itself, the same
    // split `setupChecklist.ts` draws between the rule and the hook that
    // supplies it.
    const words = useTerminology();

    const [, assignDisplay] = useMutation(ASSIGN_DISPLAY);
    const [, advanceDisplay] = useMutation(ADVANCE_DISPLAY);
    const [, renameDisplay] = useMutation(RENAME_DISPLAY);
    const [, forgetDisplay] = useMutation(FORGET_DISPLAY);
    const [, identifyDisplay] = useMutation(IDENTIFY_DISPLAY);
    // Imperative rather than `useQuery`: the reroll fires once per click
    // rather than tracking a variable the render loop would re-fetch on
    // (#521). `renameDisplay` still commits it — this only fills the draft.
    const client = useClient();

    const [renaming, setRenaming] = useState<string | null>(null);
    const [draftName, setDraftName] = useState('');

    const rerollName = async (displayId: string, currentDraft: string) => {
        // network-only: this is a suggestion, not data to cache, and a
        // cached answer would defeat the die — pressing it twice with the
        // same draft must still be able to return a *different* word.
        const result = await client
            .query(
                SUGGEST_DISPLAY_NAME,
                { displayId, avoid: currentDraft },
                { requestPolicy: 'network-only' },
            )
            .toPromise();
        if (result.data?.suggestDisplayName) {
            setDraftName(result.data.suggestDisplayName);
        }
    };

    const displays: DisplayRow[] = liveResult.data?.displays ?? queryResult.data?.displays ?? [];
    const hasDisplays = displays.length > 0;

    // Held in a ref, the same shape `useRaceFlow.ts` uses for its own
    // handlers: a fresh callback identity on the caller's every render must
    // not fire this effect on every render, only when the answer itself
    // changes. Assigned after the commit rather than during render, for the
    // same reason that file gives.
    const onDisplaysChangeRef = useRef(onDisplaysChange);
    useEffect(() => {
        onDisplaysChangeRef.current = onDisplaysChange;
    });
    useEffect(() => {
        onDisplaysChangeRef.current?.(hasDisplays);
    }, [hasDisplays]);

    // Two monitors on this same computer used to report as one screen,
    // because every tab shares this computer's `localStorage` — assigning a
    // view moved both at once (#590). Opening the window this way, rather
    // than pointing at Live and letting a second tab find its own id, hands
    // the new tab a fresh one up front, so there is nothing for it to
    // contend with the tab that opened it.
    const openNewDisplay = () => window.open(newDisplayWindowUrl(raceId), '_blank', 'noopener');

    if (displays.length === 0) {
        return (
            <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted-color)' }}>
                    <p style={{ margin: 0 }}>No audience displays are open yet.</p>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                        Open <strong>Live</strong> on a screen anywhere on this network and it
                        will appear here — there is nothing to set up first.
                    </p>
                    <button
                        type="button"
                        onClick={openNewDisplay}
                        className="secondary-btn"
                        style={{ marginTop: '1rem', padding: '0.4rem 0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                        <Icon path={mdiOpenInNew} size={0.7} />
                        Open a new display window
                    </button>
                </div>
                {/* On a screen this laptop cannot open a browser window on —
                    the wall-mounted display or the check-in tablet a new
                    display window would open on *this* machine instead — an
                    address to type or scan is the only way in (#723). */}
                <ConnectDisplayAddress raceId={raceId} />
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
            <button
                type="button"
                onClick={openNewDisplay}
                className="secondary-btn"
                style={{ justifySelf: 'start', padding: '0.4rem 0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
                <Icon path={mdiOpenInNew} size={0.7} />
                Open a new display window
            </button>
            <ConnectDisplayAddress raceId={raceId} />
            {displays.map((display) => {
                const currentOption = VIEW_OPTIONS.find((option) => option.view === display.view);
                return (
                    <div
                        key={display.displayId}
                        data-testid={`display-${display.displayId}`}
                        style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem',
                            background: display.connected ? 'var(--surface-color)' : 'var(--surface-faint-color)',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.75rem',
                            alignItems: 'center',
                        }}
                    >
                        <Icon
                            path={display.connected ? mdiCheckCircle : mdiCircleOutline}
                            size={0.8}
                            color={display.connected ? 'var(--success-color)' : 'var(--text-placeholder-color)'}
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
                                        style={{ flex: 1, padding: '0.3rem', borderRadius: '4px', border: '1px solid var(--input-border-color)' }}
                                    />
                                    {/* Asks the server for a name that isn't
                                        already on another row (#521) — it only
                                        fills the draft; Save is still what
                                        commits it. */}
                                    <button
                                        type="button"
                                        aria-label="Suggest a new name"
                                        title={operatorTitle ?? 'Suggest a new name'}
                                        disabled={!isOperator}
                                        onClick={() => void rerollName(display.displayId, draftName)}
                                        className="secondary-btn"
                                        style={{ padding: '0.3rem 0.5rem' }}
                                    >
                                        <Icon path={mdiDice5} size={0.7} />
                                    </button>
                                    <button
                                        type="submit"
                                        className="secondary-btn"
                                        disabled={!isOperator}
                                        title={operatorTitle}
                                        style={{ padding: '0.3rem 0.7rem' }}
                                    >
                                        Save
                                    </button>
                                </form>
                            ) : (
                                <>
                                    <strong>{display.name}</strong>{' '}
                                    <button
                                        type="button"
                                        aria-label={`Rename ${display.name}`}
                                        disabled={!isOperator}
                                        title={operatorTitle}
                                        onClick={() => {
                                            setRenaming(display.displayId);
                                            setDraftName(display.name);
                                        }}
                                        style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer' }}
                                    >
                                        <Icon path={mdiPencil} size={0.6} color="var(--text-subtle-color)" />
                                    </button>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                                        {display.connected ? display.description : 'Not connected'}
                                    </div>
                                </>
                            )}
                        </div>

                        <select
                            aria-label={`What ${display.name} shows`}
                            value={display.view}
                            disabled={!isOperator}
                            title={operatorTitle}
                            onChange={(e) =>
                                assignDisplay({
                                    displayId: display.displayId,
                                    view: e.target.value as DisplayView,
                                })
                            }
                            style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid var(--input-border-color)' }}
                        >
                            {/* Grouped by when in the evening a view is useful —
                                During racing, Between heats, Before racing,
                                After — so ten bare names are not one undivided
                                list. The ceremony is missing from a race with no
                                awards — it would send the screen to a page with
                                nothing on it — but stays for a screen already
                                showing one, or the row would say nothing about
                                what it is doing. */}
                            {groupedViewOptions(viewOptionsFor(hasAwards, display.view)).map(
                                ({ group, options }) => (
                                    <optgroup key={group} label={group}>
                                        {options.map((option) => (
                                            <option key={option.view} value={option.view}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </optgroup>
                                ),
                            )}
                        </select>

                        {/* One line naming what the chosen view actually shows
                            (#948) — "Standings" vs "Standings only" vs
                            "Projector" could otherwise only be told apart by
                            walking to the screen, which is the thing this panel
                            exists to avoid. `width: 100%` forces it onto its own
                            line under the select within this flex-wrap row,
                            ahead of the view's own riders (the interval,
                            pending-only, QR target and ticker controls below). */}
                        {currentOption && (
                            <div style={{ width: '100%', fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>
                                {currentOption.description(words)}
                            </div>
                        )}

                        {/* Every view that advances on a timer gets the same
                            seconds control — the tab cycle and the photo
                            slideshow alike. Naming views here was the bug: the
                            slideshow cycled at an interval nothing offered to
                            change. */}
                        {viewCycles(display.view) && (
                            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                                every{' '}
                                <input
                                    type="number"
                                    min={1}
                                    aria-label={`Cycle interval for ${display.name}`}
                                    value={display.cycleSeconds}
                                    disabled={!isOperator}
                                    title={operatorTitle}
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
                                    style={{ width: '4rem', padding: '0.25rem', borderRadius: '4px', border: '1px solid var(--input-border-color)' }}
                                />{' '}
                                s
                            </label>
                        )}

                        {/* Standings only (#663): how it gets through a list too
                            long for one screen — flip through fixed pages, or
                            scroll continuously. The seconds control above sets
                            the page duration or the length of one scroll pass,
                            whichever this is set to. */}
                        {viewScrolls(display.view) && (
                            <select
                                aria-label={`How ${display.name} moves through the standings`}
                                value={display.scrollBehavior}
                                disabled={!isOperator}
                                title={operatorTitle}
                                onChange={(e) =>
                                    assignDisplay({
                                        displayId: display.displayId,
                                        view: display.view,
                                        scrollBehavior: e.target.value as ScrollBehavior,
                                    })
                                }
                                style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid var(--input-border-color)' }}
                            >
                                <option value="PAGING">Page cycling</option>
                                <option value="SMOOTH">Auto-scroll</option>
                            </select>
                        )}

                        {/* Check-in progress (#612): whether an already-checked-in
                            racer's row is still listed, or only the ones still
                            pending — a large pack's screen can drop the former to
                            make more room. */}
                        {viewHasCheckedInToggle(display.view) && (
                            <select
                                aria-label={`Who ${display.name} lists`}
                                value={display.showCheckedIn ? 'ALL' : 'PENDING'}
                                disabled={!isOperator}
                                title={operatorTitle}
                                onChange={(e) =>
                                    assignDisplay({
                                        displayId: display.displayId,
                                        view: display.view,
                                        showCheckedIn: e.target.value === 'ALL',
                                    })
                                }
                                style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid var(--input-border-color)' }}
                            >
                                <option value="ALL">List everybody</option>
                                <option value="PENDING">Pending only</option>
                            </select>
                        )}

                        {/* QR code (#614): which page the code opens — this
                            race's own audience display, or the voting ballot. */}
                        {viewHasQrTargetToggle(display.view) && (
                            <select
                                aria-label={`What ${display.name}'s QR code opens`}
                                value={display.qrTarget}
                                disabled={!isOperator}
                                title={operatorTitle}
                                onChange={(e) =>
                                    assignDisplay({
                                        displayId: display.displayId,
                                        view: display.view,
                                        qrTarget: e.target.value as QRTarget,
                                    })
                                }
                                style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid var(--input-border-color)' }}
                            >
                                <option value="STANDINGS">Live standings</option>
                                <option value="VOTE">Voting ballot</option>
                            </select>
                        )}

                        {/* Broadcast overlay (#616): whether the compact top-5
                            ticker shows alongside the lower-third bar — off for
                            a streamer who wants the bar alone and nothing else
                            filling the screen between heats. */}
                        {viewHasStandingsTickerToggle(display.view) && (
                            <select
                                aria-label={`Whether ${display.name} shows the standings ticker`}
                                value={display.showStandingsTicker ? 'ON' : 'OFF'}
                                disabled={!isOperator}
                                title={operatorTitle}
                                onChange={(e) =>
                                    assignDisplay({
                                        displayId: display.displayId,
                                        view: display.view,
                                        showStandingsTicker: e.target.value === 'ON',
                                    })
                                }
                                style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid var(--input-border-color)' }}
                            >
                                <option value="ON">With standings ticker</option>
                                <option value="OFF">Heat only</option>
                            </select>
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
                                    disabled={!display.connected || !isOperator}
                                    title={operatorTitle}
                                    onClick={() => advanceDisplay({ displayId: display.displayId, delta: -1 })}
                                    className="secondary-btn"
                                    style={{ padding: '0.25rem 0.6rem' }}
                                >
                                    ‹
                                </button>
                                <span style={{ fontSize: '0.8rem', color: 'var(--warning-strong-color)', background: 'var(--warning-strong-bg-color)', border: '1px solid var(--warning-strong-border-color)', borderRadius: '20px', padding: '2px 8px' }}>
                                    You advance this one
                                </span>
                                <button
                                    type="button"
                                    aria-label={`Next award on ${display.name}`}
                                    disabled={!display.connected || !isOperator}
                                    title={operatorTitle}
                                    onClick={() => advanceDisplay({ displayId: display.displayId, delta: 1 })}
                                    className="secondary-btn"
                                    style={{ padding: '0.25rem 0.6rem' }}
                                >
                                    ›
                                </button>
                            </span>
                        )}

                        {/* A memorable name is only half of it — this is how the
                            operator learns which row is the projector at the
                            back. Disabled while not connected: there is no
                            screen to flash it on. */}
                        <button
                            type="button"
                            aria-label={`Identify ${display.name}`}
                            title={operatorTitle ?? "Flash this screen's name"}
                            disabled={!display.connected || !isOperator}
                            onClick={() => identifyDisplay({ displayId: display.displayId })}
                            className="secondary-btn"
                            style={{ padding: '0.25rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                            <Icon path={mdiFlashOutline} size={0.7} />
                            Identify
                        </button>

                        {!display.connected && (
                            <button
                                type="button"
                                aria-label={`Forget ${display.name}`}
                                disabled={!isOperator}
                                title={operatorTitle}
                                onClick={() => forgetDisplay({ displayId: display.displayId })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
                            >
                                <Icon path={mdiClose} size={0.7} color="var(--error)" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
