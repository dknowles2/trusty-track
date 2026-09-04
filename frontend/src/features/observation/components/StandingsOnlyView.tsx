/**
 * The `STANDINGS_ONLY` view (#663): the leaderboard, and nothing else.
 *
 * A pack big enough to want a screen dedicated entirely to the standings is a
 * pack whose leaderboard does not fit one screenful, so this either flips
 * through it in pages or scrolls it continuously — the operator's choice, on
 * the display's own row (`ScrollBehavior` in `displayView.ts`). The
 * arithmetic for both lives in `standingsScroll.ts`, as a pure function of
 * elapsed time; this component's only job is to keep calling it on a tick and
 * render what it returns.
 */

import { useEffect, useRef, useState } from 'react';
import RacerAvatar from '../../management/components/RacerAvatar';
import { formatDisplayName, shouldShowRacerPhoto, type NameDisplay } from '../../core/displayName';
import { pageCount, pageForElapsed, pageSlice, scrollOffset } from '../standingsScroll';
import type { ScrollBehavior } from '../displayView';

export interface StandingsOnlyRacer {
    firstName: string;
    lastName: string;
    carNumber?: number | null;
    racerImageUrl?: string | null;
}

export interface StandingsOnlyStanding {
    racerId: number;
    racingGroupDivision?: string | null;
    score: number;
    heatsCompleted: number;
    rank: number;
}

interface Props {
    standings: readonly StandingsOnlyStanding[];
    racersMap: Readonly<Record<number, StandingsOnlyRacer | undefined>>;
    nameDisplay: NameDisplay | string;
    scoreLabel: string;
    formatScore: (score: number) => string;
    vehicle: string;
    scrollBehavior: ScrollBehavior;
    /** The time a page stays up, or a full top-to-bottom pass takes. */
    cycleMs: number;
}

/**
 * How tall one standings row renders, in pixels — the portrait, its padding,
 * and the cell's own padding. Used only to guess how many rows fit before
 * anything has actually been measured; a fixed guess here is better than
 * showing every racer at once for a frame while `ResizeObserver` catches up.
 */
const APPROX_ROW_HEIGHT_PX = 88;

export default function StandingsOnlyView({
    standings,
    racersMap,
    nameDisplay,
    scoreLabel,
    formatScore,
    vehicle,
    scrollBehavior,
    cycleMs,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    // A lazy `useState` initializer, not `useRef(Date.now())` — a ref's
    // initial-value expression runs on every render even though React
    // discards the result after the first, so it is still an impure call
    // during render; `useState`'s function form is the one React actually
    // guarantees to call once. Kept as state (never written to again) rather
    // than read from `now` at mount, so `elapsedMs` below does not depend on
    // a ref access during render either.
    const [start] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());
    const [pageSize, setPageSize] = useState(() =>
        Math.max(1, Math.floor((typeof window !== 'undefined' ? window.innerHeight : 800) / APPROX_ROW_HEIGHT_PX)),
    );
    const [scrollableHeight, setScrollableHeight] = useState(0);

    // How much room this screen actually has, re-measured whenever the list
    // or the window changes. A `ResizeObserver` on the container (rather than
    // just a `resize` listener) is what catches the very first layout too, so
    // a screen never sits on the fallback guess longer than one paint.
    useEffect(() => {
        const measure = () => {
            const container = containerRef.current;
            const content = contentRef.current;
            // A height of zero means "not laid out yet" (the very first
            // paint, or a test environment with no real layout engine), not
            // "there is room for one row" — keep whatever page size is
            // already in play rather than collapsing to the degenerate
            // fallback of one, which would page through a two-line list one
            // racer at a time.
            if (container && container.clientHeight > 0) {
                setPageSize(Math.max(1, Math.floor(container.clientHeight / APPROX_ROW_HEIGHT_PX)));
            }
            if (container && content && container.clientHeight > 0) {
                setScrollableHeight(Math.max(0, content.scrollHeight - container.clientHeight));
            }
        };
        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const observer = new ResizeObserver(measure);
        if (containerRef.current) observer.observe(containerRef.current);
        return () => observer.disconnect();
        // Re-measure whenever the rendered content changes shape — a longer or
        // shorter list, or a switch between paging (a page's worth of rows)
        // and smooth scrolling (every row).
    }, [standings.length, scrollBehavior]);

    // One tick drives both behaviours, computed fresh each time from elapsed
    // wall-clock time rather than accumulated in a counter — see
    // `standingsScroll.ts` for why that is what keeps a screen left running
    // for an hour from drifting. Smooth scrolling wants a finer tick than
    // paging does; either way the interval is only ever a suggestion to
    // `pageForElapsed`/`scrollOffset`, never the source of truth.
    useEffect(() => {
        const tickMs = scrollBehavior === 'SMOOTH' ? 50 : 1000;
        const timer = setInterval(() => setNow(Date.now()), tickMs);
        return () => clearInterval(timer);
    }, [scrollBehavior]);

    const elapsedMs = now - start;
    const rowCount = pageCount(standings.length, pageSize);
    const page = pageForElapsed(elapsedMs, cycleMs, rowCount);
    const visible = scrollBehavior === 'PAGING' ? pageSlice(standings, page, pageSize) : standings;
    const offset = scrollBehavior === 'SMOOTH' ? scrollOffset(elapsedMs, scrollableHeight, cycleMs) : 0;

    return (
        <div
            ref={containerRef}
            data-testid="standings-only-view"
            style={{
                height: '100vh',
                width: '100%',
                overflow: 'hidden',
                boxSizing: 'border-box',
                padding: '2vmin 3vmin',
            }}
        >
            {standings.length === 0 ? (
                <div
                    style={{
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--display-text-muted-color)',
                        fontSize: '3vmin',
                    }}
                >
                    No results yet.
                </div>
            ) : (
                <div
                    ref={contentRef}
                    style={{
                        transform: scrollBehavior === 'SMOOTH' ? `translateY(-${offset}px)` : undefined,
                        // The transition length matches the tick — a short one
                        // here is what turns discrete jumps every 50ms into
                        // something that reads as continuous motion rather than
                        // a stutter.
                        transition: scrollBehavior === 'SMOOTH' ? 'transform 60ms linear' : undefined,
                    }}
                >
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead
                            style={{
                                backgroundColor: 'var(--display-accent-color)',
                                color: 'var(--display-on-accent-color)',
                            }}
                        >
                            <tr>
                                <th style={{ padding: '15px', fontSize: '2vmin' }}>Rank</th>
                                <th style={{ padding: '15px', fontSize: '2vmin' }}>Racer</th>
                                <th style={{ padding: '15px', textAlign: 'right', fontSize: '2vmin' }}>
                                    {scoreLabel}
                                </th>
                                <th style={{ padding: '15px', textAlign: 'right', fontSize: '2vmin' }}>Runs</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((s) => {
                                const racer = racersMap[s.racerId];
                                return (
                                    <tr
                                        key={s.racerId}
                                        className="standing-row"
                                        style={{ borderBottom: '1px solid var(--display-border-subtle-color)' }}
                                    >
                                        <td
                                            style={{
                                                padding: '15px',
                                                fontSize: '2.5vmin',
                                                fontWeight: 'bold',
                                                color:
                                                    s.rank === 1
                                                        ? '#d4af37'
                                                        : s.rank === 2
                                                          ? '#c0c0c0'
                                                          : s.rank === 3
                                                            ? '#cd7f32'
                                                            : 'var(--display-text-color)',
                                            }}
                                        >
                                            {s.rank}
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                <RacerAvatar
                                                    racer={{
                                                        id: s.racerId,
                                                        first_name: racer?.firstName || '',
                                                        last_name: racer?.lastName || '',
                                                        racer_image_url: shouldShowRacerPhoto(nameDisplay)
                                                            ? racer?.racerImageUrl
                                                            : null,
                                                    }}
                                                    size="7vmin"
                                                    style={{ border: '3px solid var(--display-border-color)' }}
                                                />
                                                <div>
                                                    <div style={{ fontWeight: 'bold', fontSize: '2.2vmin' }}>
                                                        {racer
                                                            ? formatDisplayName(nameDisplay, racer.firstName, racer.lastName)
                                                            : `Racer #${s.racerId}`}
                                                    </div>
                                                    {racer?.carNumber && (
                                                        <div
                                                            style={{
                                                                color: 'var(--display-text-muted-color)',
                                                                fontSize: '1.7vmin',
                                                            }}
                                                        >
                                                            {vehicle} #{racer.carNumber}
                                                        </div>
                                                    )}
                                                    {s.racingGroupDivision && (
                                                        <div
                                                            style={{
                                                                color: 'var(--display-text-subtle-color)',
                                                                fontSize: '1.6vmin',
                                                            }}
                                                        >
                                                            {s.racingGroupDivision}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td
                                            style={{
                                                padding: '15px',
                                                textAlign: 'right',
                                                fontFamily: 'monospace',
                                                fontSize: '2.4vmin',
                                                fontWeight: 'bold',
                                            }}
                                        >
                                            {formatScore(s.score)}
                                        </td>
                                        <td style={{ padding: '15px', textAlign: 'right', fontSize: '2vmin' }}>
                                            {s.heatsCompleted}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {scrollBehavior === 'PAGING' && rowCount > 1 && (
                <div
                    data-testid="standings-only-page-indicator"
                    style={{
                        textAlign: 'center',
                        marginTop: '1.5vmin',
                        color: 'var(--display-text-faint-color)',
                        fontSize: '1.8vmin',
                    }}
                >
                    Page {page + 1} of {rowCount}
                </div>
            )}
        </div>
    );
}
