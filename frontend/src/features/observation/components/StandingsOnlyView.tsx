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

import { useRef } from 'react';
import RacerAvatar from '../../management/components/RacerAvatar';
import { formatDisplayName, shouldShowRacerPhoto, type NameDisplay } from '../../core/displayName';
import { useMeasuredPages } from '../useMeasuredPages';
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
    /** How many of `heatsCompleted` were an actual DNF rather than a
     * genuine slow finish (#898). See `dnfAnnotation`. */
    dnfCount?: number;
    rank: number;
}

interface Props {
    standings: readonly StandingsOnlyStanding[];
    racersMap: Readonly<Record<number, StandingsOnlyRacer | undefined>>;
    nameDisplay: NameDisplay | string;
    scoreLabel: string;
    formatScore: (score: number) => string;
    /** The DNF note beside a score — "(1 DNF)" — or `null` when there is
     * nothing to say (#898). See `scoringStrategyText.ts`'s own
     * `dnfAnnotation`, which this is the caller's resolved copy of. */
    dnfAnnotation: (dnfCount: number) => string | null;
    vehicle: string;
    scrollBehavior: ScrollBehavior;
    /** The time a page stays up, or a full top-to-bottom pass takes. */
    cycleMs: number;
}

export default function StandingsOnlyView({
    standings,
    racersMap,
    nameDisplay,
    scoreLabel,
    formatScore,
    dnfAnnotation,
    vehicle,
    scrollBehavior,
    cycleMs,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    // The measuring-and-paging arithmetic itself lives in `useMeasuredPages`
    // (#1073 part 2) — pulled out of this component so the standard mode's
    // own Standings tab can page the same way rather than growing the page
    // underneath it. See that module's own comment for the mechanism.
    const {
        visible,
        pageCount: rowCount,
        page,
        offset,
    } = useMeasuredPages(containerRef, contentRef, standings, { behavior: scrollBehavior, cycleMs });

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
                                                                // Never below 2vmin (#1073's legibility floor is
                                                                // exactly 2% of viewport height, which every
                                                                // supported viewport is landscape enough for
                                                                // `vmin` to equal — see `Observation.tsx`'s
                                                                // `renderHeatCard` comment) — a car number is
                                                                // one of the things that floor exists to protect.
                                                                fontSize: '2vmin',
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
                                                // Not a system `monospace` (#821) —
                                                // see `.overlay-time` in `index.css`.
                                                fontFamily: 'var(--font-body)',
                                                fontVariantNumeric: 'tabular-nums',
                                                fontSize: '2.4vmin',
                                                fontWeight: 'bold',
                                            }}
                                        >
                                            {formatScore(s.score)}
                                            {dnfAnnotation(s.dnfCount ?? 0) && (
                                                <div
                                                    style={{
                                                        fontSize: '1.2vmin',
                                                        fontWeight: 'normal',
                                                        fontFamily: 'var(--font-body)',
                                                        color: 'var(--display-text-muted-color)',
                                                    }}
                                                >
                                                    {dnfAnnotation(s.dnfCount ?? 0)}
                                                </div>
                                            )}
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
