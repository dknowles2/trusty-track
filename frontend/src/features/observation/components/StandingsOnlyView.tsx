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
import { scoreCell } from '../../stats/scoringStrategyText';

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
    /**
     * The phone tier (#1144, `displayDensity.ts`'s `phoneTier`): a parent's
     * phone rather than a wall display. The header cells below read at
     * 7.8px on a 390px screen (2% of viewport *height*, the desktop
     * legibility floor — nothing about it scales with *width*, which is
     * this tier's own axis). This switches every size in this table to a
     * `rem` reading that clears the issue's own ≥12px header requirement.
     * The badge that used to sit over the "Runs" column on this tier is
     * `Observation.tsx`'s own fix, not this component's — it moves
     * `IdentifyPresence` into the flow above this view entirely, so nothing
     * here has to make room for it.
     */
    phoneTier?: boolean;
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
    phoneTier = false,
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
                padding: phoneTier ? '1rem' : '2vmin 3vmin',
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
                                {/* `2vmin` reads as 7.8px on a 390px-wide phone
                                    (#1144) — `vmin` follows the *smaller*
                                    dimension, and width is this tier's own
                                    narrow axis where the desktop tiers this
                                    view otherwise shares are always at least
                                    as wide as they are tall. `rem` clears the
                                    issue's own ≥12px header requirement with
                                    margin regardless of viewport shape. */}
                                <th style={{ padding: phoneTier ? '0.5rem' : '15px', fontSize: phoneTier ? '0.85rem' : '2vmin' }}>Rank</th>
                                <th style={{ padding: phoneTier ? '0.5rem' : '15px', fontSize: phoneTier ? '0.85rem' : '2vmin' }}>Racer</th>
                                <th style={{ padding: phoneTier ? '0.5rem' : '15px', textAlign: 'right', fontSize: phoneTier ? '0.85rem' : '2vmin' }}>
                                    {scoreLabel}
                                </th>
                                <th style={{ padding: phoneTier ? '0.5rem' : '15px', textAlign: 'right', fontSize: phoneTier ? '0.85rem' : '2vmin' }}>Runs</th>
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
                                                padding: phoneTier ? '0.5rem' : '15px',
                                                fontSize: phoneTier ? '1rem' : '2.5vmin',
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
                                        <td style={{ padding: phoneTier ? '0.5rem' : '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: phoneTier ? '0.5rem' : '15px' }}>
                                                <RacerAvatar
                                                    racer={{
                                                        id: s.racerId,
                                                        first_name: racer?.firstName || '',
                                                        last_name: racer?.lastName || '',
                                                        racer_image_url: shouldShowRacerPhoto(nameDisplay)
                                                            ? racer?.racerImageUrl
                                                            : null,
                                                    }}
                                                    size={phoneTier ? '2.4rem' : '7vmin'}
                                                    style={{ border: '3px solid var(--display-border-color)' }}
                                                />
                                                <div>
                                                    <div style={{ fontWeight: 'bold', fontSize: phoneTier ? '1rem' : '2.2vmin' }}>
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
                                                                // one of the things that floor exists to
                                                                // protect. The phone tier (#1144) switches to
                                                                // `rem` outright, for the same reason the header
                                                                // cells above do.
                                                                fontSize: phoneTier ? '0.85rem' : '2vmin',
                                                            }}
                                                        >
                                                            {vehicle} #{racer.carNumber}
                                                        </div>
                                                    )}
                                                    {s.racingGroupDivision && (
                                                        <div
                                                            style={{
                                                                color: 'var(--display-text-subtle-color)',
                                                                fontSize: phoneTier ? '0.75rem' : '1.6vmin',
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
                                                padding: phoneTier ? '0.5rem' : '15px',
                                                textAlign: 'right',
                                                // Not a system `monospace` (#821) —
                                                // see `.overlay-time` in `index.css`.
                                                fontFamily: 'var(--font-body)',
                                                fontVariantNumeric: 'tabular-nums',
                                                fontSize: phoneTier ? '1rem' : '2.4vmin',
                                                fontWeight: 'bold',
                                            }}
                                        >
                                            {scoreCell(s, formatScore)}
                                            {dnfAnnotation(s.dnfCount ?? 0) && (
                                                <div
                                                    style={{
                                                        fontSize: phoneTier ? '0.7rem' : '1.2vmin',
                                                        fontWeight: 'normal',
                                                        fontFamily: 'var(--font-body)',
                                                        color: 'var(--display-text-muted-color)',
                                                    }}
                                                >
                                                    {dnfAnnotation(s.dnfCount ?? 0)}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: phoneTier ? '0.5rem' : '15px', textAlign: 'right', fontSize: phoneTier ? '0.85rem' : '2vmin' }}>
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
                        marginTop: phoneTier ? '0.75rem' : '1.5vmin',
                        color: 'var(--display-text-faint-color)',
                        fontSize: phoneTier ? '0.8rem' : '1.8vmin',
                    }}
                >
                    Page {page + 1} of {rowCount}
                </div>
            )}
        </div>
    );
}
