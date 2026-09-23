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

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useClient, useMutation, useQuery, useSubscription } from 'urql';
import { Icon } from '@mdi/react';
import {
    mdiArrowDown,
    mdiArrowUp,
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
    RACE_TRACK_QUERY,
    RENAME_DISPLAY,
    SET_CAMERA_ORDER,
    SET_CAMERA_TRACK,
    SUGGEST_DISPLAY_NAME,
} from '../graphql/queries';
import { GET_TRACKS } from '../../core/graphql/queries';
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
import { cameraWindowUrl, newDisplayWindowUrl } from '../displayIdentity';
import ConnectDisplayAddress from './ConnectDisplayAddress';
import DocsLink from '../../../components/ui/DocsLink';
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
    /** Whether this screen plays a heat's replay clip after its results
     * overlay (#177 stage 1b) — meaningless for a CAMERA row. */
    replays: boolean;
    /** DISPLAY (an ordinary screen) or CAMERA (#177 stage 1a/1b). */
    role: 'DISPLAY' | 'CAMERA';
    /** Which track a CAMERA listens to — null until `setCameraTrack` picks
     * one, meaningless for an ordinary display. */
    trackId: number | null;
    /** ISO 8601 UTC, the last time this camera's clip landed — null until
     * the first one does. */
    lastClipAt: string | null;
    /** This camera's own place among several (#177 stage 4) — lower plays
     * first; meaningless for an ordinary display. */
    cameraOrder: number;
    description: string;
    pacedByAPerson: boolean;
    connected: boolean;
    identifySeq: number;
}

/** "2s ago" / "3m ago", the same rounded-elapsed-time shape
 * `Camera.tsx`'s own status line uses — kept as a small local helper
 * rather than importing across the feature boundary for one function. */
function agoText(iso: string | null): string | null {
    if (!iso) return null;
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return null;
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 1) return 'just now';
    if (seconds === 1) return '1s ago';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return minutes === 1 ? '1m ago' : `${minutes}m ago`;
}

interface DisplaysPanelProps {
    raceId: number;
    /**
     * Told whenever the answer to "is any display known for this race"
     * changes (#850) — the Displays page uses it to decide whether Scenes
     * has anything to apply to, rather than that panel running a second
     * query answering the same question this one already does.
     */
    onDisplaysChange?: (hasDisplays: boolean) => void;
}

// A stable empty array — `useMemo`'s own dependency check below would
// otherwise see a fresh `[]` literal on every render neither subscription
// nor query has answered yet and recompute `cameras` for no reason
// (`react-hooks/exhaustive-deps`' own warning for exactly this shape).
const EMPTY_DISPLAYS: DisplayRow[] = [];

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
    // #1329: same query, same round trip — see that field's own docstring
    // on `RACE_AWARD_COUNT_QUERY`.
    const hasRecordedTimes = awardsResult.data?.race?.hasRecordedTimes ?? false;

    // #892: every mutation this panel runs (assignDisplay, advanceDisplay,
    // renameDisplay, forgetDisplay, identifyDisplay) is operator-only
    // (backend/api/auth.py's OPERATOR_ONLY_MUTATIONS) — a display holds no
    // PIN by design and registers by *subscribing*, never by calling one of
    // these itself (see ".claude/rules/displays.md"), so a check-in tablet
    // opening the Displays page used to see every control here
    // fully enabled. "Add a second screen on this computer" is untouched: it
    // is a plain `window.open`, not a mutation.
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
    const [, setCameraTrack] = useMutation(SET_CAMERA_TRACK);
    const [, setCameraOrder] = useMutation(SET_CAMERA_ORDER);

    // For looking up a track's own name by id — the race's own track for
    // the camera row's read-only line (#1293), and the same query the race
    // form already reads tracks from.
    const [tracksResult] = useQuery({ query: GET_TRACKS });
    const tracks: { id: number; name: string }[] = tracksResult.data?.tracks ?? [];
    // Imperative rather than `useQuery`: the reroll fires once per click
    // rather than tracking a variable the render loop would re-fetch on
    // (#521). `renameDisplay` still commits it — this only fills the draft.
    const client = useClient();

    // The "Connect a camera" block's own track preset (#1293). A race runs
    // on exactly one track (`Race.trackId`), so the code simply carries
    // it — there is no picker over the install's other tracks to offer,
    // the way there was before this issue (an install-wide `GET_TRACKS`
    // list is no longer an input to the preset at all).
    const [raceTrackResult] = useQuery({ query: RACE_TRACK_QUERY, variables: { raceId }, pause: !raceId });
    const raceTrackId: number | null = raceTrackResult.data?.race?.trackId ?? null;
    // `cameraPresetSettled` is "has this race's own track query answered" —
    // a default shown before it has is a *wrong* preset shown with the
    // same confidence as a right one, the #1284 reasoning this still
    // follows for the one query that remains.
    const cameraPresetSettled = !raceId || raceTrackResult.data !== undefined;
    // The race's own track's name, for the camera row's read-only line
    // below — `RACE_TRACK_QUERY` only carries the id, so the name comes
    // from `GET_TRACKS`, already fetched above for the row's own lookup.
    const raceTrackName: string | null = raceTrackId
        ? (tracks.find((t) => t.id === raceTrackId)?.name ?? null)
        : null;

    // A fresh identity, minted once for the life of this mount — see
    // `cameraWindowUrl`'s own doc comment for why calling it again on every
    // render (this panel re-renders often: a subscription tick, another
    // row's rename) would mean the code on screen keeps naming a different
    // screen before anybody has even scanned it. `trackId` is layered on
    // top reactively, via `URLSearchParams.set` rather than a second mint,
    // so the URL and the QR always carry the race's current track without
    // ever handing the phone a new identity mid-connect.
    const cameraBaseUrl = useMemo(() => cameraWindowUrl(raceId), [raceId]);
    const cameraPath = useMemo(() => {
        if (!raceTrackId) return cameraBaseUrl;
        const [path, query] = cameraBaseUrl.split('?');
        const params = new URLSearchParams(query);
        params.set('trackId', String(raceTrackId));
        return `${path}?${params.toString()}`;
    }, [cameraBaseUrl, raceTrackId]);

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

    const displays: DisplayRow[] =
        liveResult.data?.displays ?? queryResult.data?.displays ?? EMPTY_DISPLAYS;
    const hasDisplays = displays.length > 0;

    // Every camera, in the order its clip actually plays (#177 stage 4) —
    // `cameraOrder` first, `displayId` as the tiebreak, the identical sort
    // `_order_replay_clips` applies server-side, so a row's position here
    // always matches where its clip lands in the results-flow player and
    // the ▶ modal's own camera picker.
    const cameras = useMemo(
        () =>
            [...displays]
                .filter((d) => d.role === 'CAMERA')
                .sort((a, b) => a.cameraOrder - b.cameraOrder || a.displayId.localeCompare(b.displayId)),
        [displays],
    );

    /**
     * Move one camera up or down (#177 stage 4). Rather than swapping the
     * two rows' raw `cameraOrder` values — a no-op whenever they are tied,
     * which every untouched camera is, at `0` — this re-derives the whole
     * sorted list with the move applied and reassigns `0..N-1` across it.
     * That converges to a real, fully-ordered sequence on the very first
     * press, regardless of what the stored values were before it.
     */
    const moveCameraOrder = (displayId: string, direction: -1 | 1) => {
        const index = cameras.findIndex((c) => c.displayId === displayId);
        const swapIndex = index + direction;
        if (index < 0 || swapIndex < 0 || swapIndex >= cameras.length) return;
        const reordered = [...cameras];
        const [moved] = reordered.splice(index, 1);
        reordered.splice(swapIndex, 0, moved);
        reordered.forEach((camera, i) => {
            if (camera.cameraOrder !== i) {
                setCameraOrder({ displayId: camera.displayId, order: i });
            }
        });
    };

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

    // Live itself (#958) — opens a new tab, `noopener`, the same as
    // `openNewDisplay` above and "Launch Projector Mode" on the Live page
    // itself. Carries no fresh `displayId`: unlike a deliberate *second*
    // screen, clicking this from the operator's own machine is meant to put
    // *this* computer's own display on air, the same identity a
    // `?displayId=` would otherwise contend with. This is what "Live" used
    // to do by replacing the operator's own page — the race row now points
    // here instead, and this is where opening it lives. Projector Mode is
    // one click away from here too, through the view select below, and
    // straight from the Live page's own "Launch Projector Mode" button — a
    // third button offering the identical `window.open` with one of ten
    // views pre-picked was the subtle-difference cost #1249 removed.
    const openLive = () => window.open(`/race/${raceId}/observation`, '_blank', 'noopener');

    const launchButtonStyle: CSSProperties = {
        padding: '0.4rem 0.8rem',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
    };

    // The same one-line-under-the-control caption style (#948) `currentOption`
    // uses below, under each row's own view select.
    const captionStyle: CSSProperties = {
        margin: '0.25rem 0 0',
        fontSize: '0.8rem',
        color: 'var(--text-muted-color)',
    };

    // Two headings, not three flat buttons (#1249): "This computer" is
    // unequal weight — one primary action (put this screen on air) and one
    // quieter escape hatch for the one rarer setup (two monitors on one
    // machine) that a fresh identity actually matters for — and "Other
    // devices" is everything reached by an address instead of a click.
    const launchSection = (
        <div style={{ display: 'grid', gap: '1.25rem' }}>
            <div>
                <h2 style={{ margin: '0 0 0.6rem' }}>This computer</h2>
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                    <div>
                        <button type="button" onClick={openLive} className="primary-btn" style={launchButtonStyle}>
                            <Icon path={mdiOpenInNew} size={0.7} />
                            Open Live here
                        </button>
                        <p style={captionStyle}>
                            Turns this computer into a screen. Choose what it shows from the
                            list below.
                        </p>
                    </div>
                    <div>
                        <button type="button" onClick={openNewDisplay} className="secondary-btn" style={launchButtonStyle}>
                            Add a second screen on this computer
                        </button>
                        <p style={captionStyle}>
                            For a computer plugged into two monitors, so assigning one
                            doesn't move the other.
                        </p>
                    </div>
                </div>
            </div>
            <div>
                <h2 style={{ margin: '0 0 0.6rem' }}>Other devices</h2>
                {/* On a screen this laptop cannot open a browser window on —
                    the wall-mounted display or the check-in tablet a new
                    display window would open on *this* machine instead — an
                    address to type or scan is the only way in (#723). Two
                    cards side by side (#1254), the same height, the same
                    rows (#1292 — see `.connect-devices-row` in `index.css`
                    and `ConnectDisplayAddress`'s own header comment): a
                    screen, unchanged, and a camera — its own fresh identity,
                    presetting this race's own track with no picker over the
                    install's other tracks (#1293 — a race runs on exactly
                    one). The camera card carries a `?` in `headingExtra`
                    (#1300), to the Instant Replay guide — the screen card
                    deliberately does not get one of its own: this page's
                    own `<h1>` (`DisplaysPage.tsx`) already carries
                    `docsKey="displays"`, and a second link to the identical
                    guide on the same page is exactly the duplicate
                    `docsLinks.spec.ts` exists to catch — see that spec's
                    own header comment, and its `Displays` entry in
                    `SCREENS` for why that page alone expects two links,
                    not one. */}
                <div className="connect-devices-row" data-testid="connect-devices-row">
                    <ConnectDisplayAddress
                        raceId={raceId}
                        heading="Connect a screen"
                        caption="For a wall display, projector or tablet on this network."
                        testId="connect-screen-address"
                    />
                    {cameraPresetSettled ? (
                        raceTrackId ? (
                            <ConnectDisplayAddress
                                raceId={raceId}
                                path={cameraPath}
                                heading="Connect a camera"
                                caption="For the finish line — scan on the phone that will film it."
                                sentence="Open this address on the phone that will be the camera:"
                                qrAlt="QR code that opens this race's camera page"
                                testId="connect-camera-address"
                                headingExtra={<DocsLink docsKey="camera" />}
                                footer={
                                    cameras.length === 0 ? (
                                        <p style={captionStyle}>
                                            No cameras yet — scan the code above to connect one.
                                        </p>
                                    ) : undefined
                                }
                            />
                        ) : (
                            // `Race.trackId` is nullable — a race with no
                            // track yet is already a race the timer can't
                            // run, so the honest answer is a notice, not a
                            // code that would preset nothing (and never a
                            // fallback to the install's only track either,
                            // even when there is exactly one — this race's
                            // own track is the only one with a right
                            // answer here). Renders through the same
                            // component as the address case, via `notice`,
                            // so it shares the card's chrome rather than
                            // hand-building a copy of it (#1292).
                            <ConnectDisplayAddress
                                raceId={raceId}
                                heading="Connect a camera"
                                testId="connect-camera-no-track"
                                notice="Pick this race's track in Edit race first, so the camera knows which timer to listen to."
                                headingExtra={<DocsLink docsKey="camera" />}
                            />
                        )
                    ) : (
                        // Neither the notice nor the address is shown
                        // until the race's own track query has answered —
                        // see this block's own comment on
                        // `cameraPresetSettled` for why a URL built
                        // before then would be wrong, not just early.
                        <p style={captionStyle}>Preparing the camera address…</p>
                    )}
                </div>
            </div>
        </div>
    );

    if (displays.length === 0) {
        return (
            <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted-color)' }}>
                    <p style={{ margin: 0 }}>No audience displays are open yet.</p>
                    <p style={{ margin: '0.5rem 0 1rem', fontSize: '0.9rem' }}>
                        Open Live here to turn this computer into a screen, or scan the
                        code below to connect a phone, tablet or another computer.
                    </p>
                </div>
                {launchSection}
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
            {launchSection}
            {/* Its own testid (#1259) — separate from `launchSection` above,
                which the operator's list is not: a caption illustrating "the
                operator's list of audience displays" is a claim about these
                rows, not about the launch buttons or the two "Connect a…"
                address blocks sitting above them, and a docs screenshot
                scoped here can no longer see either. */}
            <div data-testid="displays-list" style={{ display: 'grid', gap: '0.75rem' }}>
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

                        {/* A camera row gets no view/riders — those describe
                            what a *screen* shows, and a camera's own
                            controls (which track, whether the replay is
                            landing) are a different set entirely, below. */}
                        {display.role !== 'CAMERA' && (
                        <>
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
                            {groupedViewOptions(
                                viewOptionsFor(hasAwards, display.view, hasRecordedTimes),
                            ).map(
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

                        {/* Instant replay (#177 stage 1b): whether this screen
                            plays a heat's clip after its own results overlay.
                            On by default — a display already showing results
                            has nothing else to lose by also playing the
                            replay once one exists. */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                            <input
                                type="checkbox"
                                aria-label={`Whether ${display.name} plays replays`}
                                checked={display.replays}
                                disabled={!isOperator}
                                title={operatorTitle}
                                onChange={(e) =>
                                    assignDisplay({
                                        displayId: display.displayId,
                                        view: display.view,
                                        replays: e.target.checked,
                                    })
                                }
                            />
                            Replays
                        </label>
                        </>
                        )}

                        {/* A camera's own controls (#177 stage 1a/1b): which
                            track it is listening to, and when its clip last
                            landed — Race Control's own badge (below) reads
                            the same `lastClipAt`. A race runs on exactly one
                            track (#1293), so this is a read-only line naming
                            it rather than a picker over the install's other
                            tracks — `Camera.tsx` registers against the
                            race's track itself on connect, and
                            `setCameraTrack` stays reachable here only as an
                            override, for the one case that can still
                            disagree: a camera a stale client registered to
                            another race's track before this fix. No button
                            when this race has no track of its own to offer
                            (`raceTrackId == null`) — there is nothing to
                            point the camera at yet. */}
                        {display.role === 'CAMERA' && (
                            <>
                                <span style={{ fontSize: '0.85rem' }}>
                                    {raceTrackName
                                        ? `Listening to ${raceTrackName}`
                                        : "This race has no track set"}
                                </span>
                                {raceTrackId != null && display.trackId !== raceTrackId && (
                                    <button
                                        type="button"
                                        disabled={!isOperator}
                                        title={operatorTitle ?? `Point ${display.name} at this race's track`}
                                        onClick={() =>
                                            setCameraTrack({ displayId: display.displayId, trackId: raceTrackId })
                                        }
                                        className="secondary-btn"
                                        style={{ padding: '0.25rem 0.6rem' }}
                                    >
                                        Use this race&apos;s track
                                    </button>
                                )}
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>
                                    {display.lastClipAt
                                        ? `Last clip ${agoText(display.lastClipAt)}`
                                        : 'No clip yet'}
                                </span>
                                {/* Which camera's clip plays first when more
                                    than one uploads for the same heat (#177
                                    stage 4) — a no-op control, and hidden,
                                    until there is a second camera to order
                                    against. */}
                                {cameras.length > 1 && (() => {
                                    const position = cameras.findIndex((c) => c.displayId === display.displayId);
                                    return (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                                            <button
                                                type="button"
                                                aria-label={`Play ${display.name}'s clip earlier`}
                                                disabled={!isOperator || position <= 0}
                                                title={operatorTitle}
                                                onClick={() => moveCameraOrder(display.displayId, -1)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex' }}
                                            >
                                                <Icon path={mdiArrowUp} size={0.7} />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Play ${display.name}'s clip later`}
                                                disabled={!isOperator || position >= cameras.length - 1}
                                                title={operatorTitle}
                                                onClick={() => moveCameraOrder(display.displayId, 1)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex' }}
                                            >
                                                <Icon path={mdiArrowDown} size={0.7} />
                                            </button>
                                        </span>
                                    );
                                })()}
                            </>
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
        </div>
    );
}
