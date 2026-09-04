/**
 * The `CHECKIN` view (#612): who has checked in, grouped by racing group, for
 * a screen at the entrance or on the gym wall while check-in is under way.
 *
 * The operator's own roster already shows this (#204's `CheckInProgress`),
 * but it sits behind the check-in desk's PIN on one laptop — nobody in the
 * room can see it, which is the whole reason a coordinator ends up shouting
 * "are there any more Wolves who haven't checked in?" across a gym. This is
 * the same question, answered on a screen everybody can already see.
 *
 * The grouping and per-group counts come from `summarizeCheckIn`, pure and
 * unit-tested; this component's only job is to render what it returns and
 * react to `showCheckedIn` and `racingHasBegun`.
 *
 * No photographs here, deliberately — DerbyNet's own kiosk is text-only too.
 * A grid of car numbers and names scales to a sixty-car pack on one screen; a
 * grid of portraits does not, and the one thing this view has to say ("is my
 * car on this list yet") needs a name and a number, not a face. `nameDisplay`
 * still applies to every name printed here, the same as every other public
 * surface (see `CLAUDE.md`'s "Name display" — this view abbreviates, since it
 * is on the same public wall the standings and the slideshow are).
 */

import { formatDisplayName, type NameDisplay } from '../../core/displayName';
import { summarizeCheckIn, type CheckInRacer } from '../checkIn';
import type { GroupableRacingGroup } from '../../management/groupRacersByRacingGroup';

interface Props {
    racers: readonly CheckInRacer[];
    racingGroups: readonly GroupableRacingGroup[];
    nameDisplay: NameDisplay | string;
    /** The word for a racing group ("Den", "Class", …), from
     * `useTerminology()` — never hardcoded here (`terminologyGuard.test.ts`). */
    groupWord: string;
    /** Whether a group's already-checked-in racers are listed, or only the
     * ones still pending — the display's own setting (#612), to save room
     * on a large pack's screen. */
    showCheckedIn: boolean;
    /**
     * Whether racing has started — the first heat has been recorded. The
     * screen still functions once it has (a latecomer can still check in,
     * see #172), but the room's attention has moved on, so this de-emphasizes
     * the display rather than hiding it: nothing here can call `assignDisplay`
     * to switch the screen away on its own (#15 — a display is a `VIEWER` and
     * may make no mutation), and an operator who *did* pick this view for a
     * screen still wants latecomers found.
     */
    racingHasBegun: boolean;
    /** Whether the roster is still on its way — see `PhotoSlideshow`'s same
     * prop for why this matters: without it, "not open yet" flashes on
     * screen for a moment before the real roster arrives. */
    loading?: boolean;
}

export default function CheckInDisplayView({
    racers,
    racingGroups,
    nameDisplay,
    groupWord,
    showCheckedIn,
    racingHasBegun,
    loading = false,
}: Props) {
    const summary = summarizeCheckIn(racers, racingGroups, groupWord);
    const compact = racingHasBegun;

    if (summary.total === 0) {
        return (
            <div
                data-testid={loading ? 'checkin-loading' : 'checkin-not-open'}
                style={{
                    height: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4vmin',
                    textAlign: 'center',
                    color: 'var(--display-text-subtle-color)',
                    fontSize: '3vmin',
                }}
            >
                {loading ? '' : 'Check-in has not opened yet.'}
            </div>
        );
    }

    return (
        <div
            data-testid="checkin-view"
            style={{
                height: '100vh',
                width: '100%',
                overflow: 'auto',
                boxSizing: 'border-box',
                padding: compact ? '2vmin 3vmin' : '3vmin 4vmin',
            }}
        >
            <div style={{ textAlign: 'center', marginBottom: compact ? '2vmin' : '3vmin' }}>
                <h1
                    style={{
                        margin: 0,
                        fontSize: compact ? '4vmin' : '6vmin',
                        color: 'var(--display-text-color)',
                    }}
                >
                    Please Check In
                </h1>
                {racingHasBegun && (
                    <div
                        data-testid="checkin-racing-underway"
                        style={{
                            marginTop: '0.5vmin',
                            fontSize: '2vmin',
                            color: 'var(--display-text-muted-color)',
                        }}
                    >
                        Racing is underway — latecomers can still check in at the registration desk.
                    </div>
                )}
                <div
                    style={{
                        marginTop: '1.5vmin',
                        fontSize: compact ? '2.2vmin' : '3vmin',
                        fontWeight: 'bold',
                        color: summary.allCheckedIn
                            ? 'var(--success-color, #2e7d32)'
                            : 'var(--display-accent-color)',
                    }}
                >
                    {summary.allCheckedIn
                        ? `All ${summary.total} checked in!`
                        : `${summary.checkedIn} of ${summary.total} checked in`}
                </div>
                <div
                    aria-hidden
                    style={{
                        margin: '1vmin auto 0',
                        maxWidth: '60vmin',
                        height: '1.4vmin',
                        borderRadius: '0.7vmin',
                        background: 'var(--display-border-subtle-color)',
                        overflow: 'hidden',
                    }}
                >
                    <div
                        style={{
                            width: `${Math.min(1, summary.checkedIn / summary.total) * 100}%`,
                            height: '100%',
                            background: summary.allCheckedIn
                                ? 'var(--success-color, #2e7d32)'
                                : 'var(--display-accent-color)',
                        }}
                    />
                </div>
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? '22vmin' : '28vmin'}, 1fr))`,
                    gap: compact ? '1.5vmin' : '2vmin',
                }}
            >
                {summary.groups.map((group) => (
                    <div
                        key={group.racingGroupId}
                        data-testid={`checkin-group-${group.racingGroupId}`}
                        style={{
                            background: 'var(--display-surface-color)',
                            borderRadius: '1.2vmin',
                            padding: compact ? '1.5vmin' : '2vmin',
                            borderTop: `0.6vmin solid ${group.racingGroupColor}`,
                            boxSizing: 'border-box',
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'baseline',
                                marginBottom: '0.8vmin',
                            }}
                        >
                            <span
                                style={{
                                    fontSize: compact ? '2.2vmin' : '2.8vmin',
                                    fontWeight: 'bold',
                                    color: 'var(--display-text-color)',
                                }}
                            >
                                {group.racingGroupName}
                            </span>
                            <span
                                style={{
                                    fontSize: compact ? '1.6vmin' : '2vmin',
                                    color: group.allCheckedIn
                                        ? 'var(--success-color, #2e7d32)'
                                        : 'var(--display-text-muted-color)',
                                }}
                            >
                                {group.checkedIn} of {group.total}
                            </span>
                        </div>

                        <div
                            aria-hidden
                            style={{
                                height: '0.9vmin',
                                borderRadius: '0.5vmin',
                                background: 'var(--display-border-subtle-color)',
                                overflow: 'hidden',
                                marginBottom: '1.2vmin',
                            }}
                        >
                            <div
                                style={{
                                    width: `${(group.total === 0 ? 0 : group.checkedIn / group.total) * 100}%`,
                                    height: '100%',
                                    background: group.allCheckedIn
                                        ? 'var(--success-color, #2e7d32)'
                                        : 'var(--display-accent-color)',
                                }}
                            />
                        </div>

                        {group.allCheckedIn ? (
                            <div
                                style={{
                                    fontSize: compact ? '1.6vmin' : '2vmin',
                                    color: 'var(--success-color, #2e7d32)',
                                }}
                            >
                                All checked in ✓
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6vmin' }}>
                                {group.missing.map((racer) => (
                                    <div
                                        key={racer.id}
                                        style={{
                                            fontSize: compact ? '1.6vmin' : '2vmin',
                                            color: 'var(--display-text-color)',
                                        }}
                                    >
                                        {racer.carNumber != null && (
                                            <span style={{ color: 'var(--display-text-muted-color)' }}>
                                                #{racer.carNumber}{' '}
                                            </span>
                                        )}
                                        {formatDisplayName(nameDisplay, racer.firstName, racer.lastName)}
                                    </div>
                                ))}
                                {/* When only the pending are listed, an
                                    already-checked-in racer's row is dropped
                                    entirely rather than shown faded — the
                                    point of the toggle is screen room, and a
                                    faded row still costs a line. */}
                                {showCheckedIn &&
                                    group.checkedInRacers.map((racer) => (
                                        <div
                                            key={racer.id}
                                            style={{
                                                fontSize: compact ? '1.6vmin' : '2vmin',
                                                color: 'var(--display-text-faint-color)',
                                            }}
                                        >
                                            <span aria-hidden style={{ color: 'var(--success-color, #2e7d32)' }}>
                                                ✓{' '}
                                            </span>
                                            {racer.carNumber != null && `#${racer.carNumber} `}
                                            {formatDisplayName(nameDisplay, racer.firstName, racer.lastName)}
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
