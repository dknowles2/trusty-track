/**
 * The `OVERLAY` view (#616): a transparent broadcast graphic for an OBS
 * Studio (or any other) Browser Source — a lower-third bar naming the
 * current heat and its line-up, a live status badge, an optional top-5
 * standings ticker, and a finish banner that reveals once a heat completes.
 *
 * This is the one display view whose consumer is streaming software rather
 * than a person standing in front of a screen. Every other full-screen view
 * on this page owns the whole frame and paints `var(--display-bg-color)`
 * across it; this one deliberately does not; see `Observation.tsx`'s
 * `OVERLAY` branch, which sets `background: 'transparent'` on the root
 * rather than the usual token. A camera feed composited underneath it in
 * OBS has to show through everywhere this view is not actively drawing a
 * panel of its own.
 *
 * **Transparency is why this component cannot use the Display theme's own
 * text/background pairing the way every other view here does.** A theme's
 * `--display-text-color` is chosen to read against *that theme's*
 * `--display-bg-color` — a calibration this view has no background to
 * offer. Whatever is behind it on the stream (grass, a gym floor, a bright
 * jersey) is unknown and can be anything, so a plain `var(--display-text-
 * color)` string floating over the video with no backing is not a safe bet
 * regardless of which of the seven themes is active.
 *
 * The fix is the same one broadcast graphics have always used: every piece
 * of text here sits on its own small, intentionally opaque panel (`SCRIM`)
 * in a fixed near-black rather than a theme token, with fixed near-white
 * text and a text-shadow for the rare case the scrim itself sits over
 * something equally dark. That pairing is chosen once, deliberately, rather
 * than resolved per theme — the whole point is that it has to read the same
 * whether the video behind it is a sunny gym or a dim church basement.
 * Filled *badges* (the Exhibition tag, the live status dot from
 * `TimerStatusBadge`) still use the Display theme's accent color, because a
 * filled badge's contrast is self-contained — the theme already guarantees
 * `--display-on-accent-color` reads against `--display-accent-color`
 * regardless of what is behind either of them.
 *
 * Deliberately no racer photographs anywhere in this view — a broadcast
 * lower third is text-first by convention, and every image loaded here is
 * one more thing that can stutter mid-broadcast for no gain a viewer would
 * notice from across a gym on a camera feed. Names still go through
 * `formatDisplayName` (#552): a stream reaches further than a gym wall, so
 * the same name-privacy setting that governs every other public screen
 * governs this one.
 */

import { formatDisplayName, type NameDisplay } from '../../core/displayName';
import LaneBadge from '../../../components/ui/LaneBadge';
import { colorForLane } from '../../settings/laneColors';
import { TimerStatusBadge } from '../../racing/components/TimerStatusBadge';
import { recordBreakDetail, type RecordBreak } from '../recordBreak';

export interface OverlayLaneRacer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
}

export interface OverlayLane {
    lane: number;
    racer: OverlayLaneRacer;
}

export interface OverlayStanding {
    racerId: number;
    score: number;
    rank: number;
}

export interface OverlayStandingRacer {
    firstName: string;
    lastName: string;
}

export interface OverlayFinishLane {
    laneNumber: number;
    place: number | null;
    racerName: string;
    carName?: string | null;
    time: number | null;
}

export interface OverlayFinishBanner {
    lanes: readonly OverlayFinishLane[];
    recordBreak?: RecordBreak | null;
}

interface Props {
    /** For the live status badge — omitted (no badge shown) when the race's
     * track has not loaded yet. */
    trackId?: number | null;
    /** "Round 1, Heat 4" / a run-off's own announcement — precomputed by
     * the caller, which already builds this exact string for the ordinary
     * heat cards (`Observation.tsx`'s `renderHeatCard`). `null` when
     * nothing is armed. */
    heatLabel: string | null;
    isExhibition: boolean;
    lanes: readonly OverlayLane[];
    laneColors: readonly string[];
    nameDisplay: NameDisplay | string;
    vehicle: string;
    standings: readonly OverlayStanding[];
    racersMap: Readonly<Record<number, OverlayStandingRacer | undefined>>;
    scoreLabel: string;
    formatScore: (score: number) => string;
    /** Whether the compact top-5 ticker renders at all — the display's own
     * rider (`Assignment.show_standings_ticker`). */
    showStandingsTicker: boolean;
    /** Set for the duration the caller wants the finish banner shown, `null`
     * otherwise — the caller owns the "reveal, then linger 10s" timing
     * (`Observation.tsx`, sharing the same `observeHeatResult` edge-detector
     * the Projector view's own results overlay uses). */
    finishBanner: OverlayFinishBanner | null;
}

/** A fixed near-black scrim, not a theme token — see this file's own
 * docstring for why a panel's contrast here cannot depend on the Display
 * theme's calibration against a background this view does not have. */
const SCRIM = 'rgba(8, 10, 14, 0.82)';
/** Fixed near-white, paired with `SCRIM` for the same reason. */
const SCRIM_TEXT = '#f5f5f5';
const SCRIM_TEXT_MUTED = 'rgba(245, 245, 245, 0.72)';
const TEXT_SHADOW = '0 1px 4px rgba(0,0,0,0.85)';

export default function BroadcastOverlayView({
    trackId,
    heatLabel,
    isExhibition,
    lanes,
    laneColors,
    nameDisplay,
    vehicle,
    standings,
    racersMap,
    scoreLabel,
    formatScore,
    showStandingsTicker,
    finishBanner,
}: Props) {
    const top5 = standings.slice(0, 5);

    return (
        <div
            data-testid="overlay-view"
            style={{
                position: 'relative',
                height: '100vh',
                width: '100%',
                overflow: 'hidden',
                boxSizing: 'border-box',
            }}
        >
            {showStandingsTicker && top5.length > 0 && (
                <div
                    data-testid="overlay-standings-ticker"
                    style={{
                        position: 'absolute',
                        top: '2vmin',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1.6vmin',
                        padding: '1.1vmin 2.2vmin',
                        borderRadius: '1.4vmin',
                        background: SCRIM,
                        color: SCRIM_TEXT,
                        textShadow: TEXT_SHADOW,
                        fontSize: '1.7vmin',
                        maxWidth: '92vw',
                        overflow: 'hidden',
                    }}
                >
                    <span style={{ opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.15vmin' }}>
                        Standings ({scoreLabel})
                    </span>
                    {top5.map((s) => {
                        const racer = racersMap[s.racerId];
                        return (
                            <span
                                key={s.racerId}
                                style={{ display: 'flex', alignItems: 'baseline', gap: '0.6vmin', whiteSpace: 'nowrap' }}
                            >
                                <strong style={{ color: 'var(--display-accent-color)' }}>{s.rank}.</strong>
                                <span>
                                    {racer
                                        ? formatDisplayName(nameDisplay, racer.firstName, racer.lastName)
                                        : `Racer #${s.racerId}`}
                                </span>
                                <span style={{ color: SCRIM_TEXT_MUTED, fontFamily: 'monospace' }}>
                                    {formatScore(s.score)}
                                </span>
                            </span>
                        );
                    })}
                </div>
            )}

            {finishBanner && (
                <div
                    data-testid="overlay-finish-banner"
                    style={{
                        position: 'absolute',
                        top: showStandingsTicker && top5.length > 0 ? '8vmin' : '2vmin',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.6vmin',
                        padding: '1.6vmin 2.4vmin',
                        borderRadius: '1.4vmin',
                        background: SCRIM,
                        color: SCRIM_TEXT,
                        textShadow: TEXT_SHADOW,
                        minWidth: '30vmin',
                        maxWidth: '85vw',
                        // Shared with the Projector view's own results
                        // overlay (`index.css`) — one fade/slide-in
                        // definition rather than a near-identical second one.
                        animation: 'result-slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
                    }}
                >
                    {finishBanner.recordBreak && (
                        <div style={{ fontSize: '1.6vmin', fontWeight: 'bold', color: 'var(--display-accent-color)' }}>
                            New track record! {recordBreakDetail(finishBanner.recordBreak)}
                        </div>
                    )}
                    {[...finishBanner.lanes]
                        .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
                        .map((lane) => (
                            <div
                                key={lane.laneNumber}
                                style={{ display: 'flex', alignItems: 'baseline', gap: '1vmin', fontSize: '2vmin' }}
                            >
                                <span style={{ fontWeight: 'bold', width: '2.4em' }}>
                                    {lane.place === 1
                                        ? '1st'
                                        : lane.place === 2
                                          ? '2nd'
                                          : lane.place === 3
                                            ? '3rd'
                                            : (lane.place ?? '—')}
                                </span>
                                <span style={{ flex: 1 }}>{lane.racerName}</span>
                                <span style={{ fontFamily: 'monospace', color: SCRIM_TEXT_MUTED }}>
                                    {lane.time != null ? `${lane.time.toFixed(3)}s` : '—'}
                                </span>
                            </div>
                        ))}
                </div>
            )}

            <div
                data-testid="overlay-lower-third"
                style={{
                    position: 'absolute',
                    left: '2vmin',
                    right: '2vmin',
                    bottom: '2vmin',
                    borderRadius: '1.4vmin',
                    background: SCRIM,
                    color: SCRIM_TEXT,
                    textShadow: TEXT_SHADOW,
                    padding: '1.6vmin 2.2vmin',
                    boxSizing: 'border-box',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1.4vmin',
                        marginBottom: lanes.length > 0 ? '1.2vmin' : 0,
                    }}
                >
                    <span style={{ fontSize: '2.2vmin', fontWeight: 'bold' }}>
                        {heatLabel ?? 'Between heats'}
                    </span>
                    {isExhibition && (
                        <span
                            style={{
                                background: 'var(--display-accent-color)',
                                color: 'var(--display-on-accent-color)',
                                fontSize: '1.3vmin',
                                fontWeight: 'bold',
                                padding: '0.3vmin 1vmin',
                                borderRadius: '2vmin',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1vmin',
                            }}
                        >
                            Exhibition
                        </span>
                    )}
                    {trackId != null && (
                        <span style={{ marginLeft: 'auto' }}>
                            <TimerStatusBadge trackId={trackId} />
                        </span>
                    )}
                </div>

                {lanes.length > 0 && (
                    <div style={{ display: 'flex', gap: '2.2vmin', flexWrap: 'wrap' }}>
                        {lanes.map(({ lane, racer }) => (
                            <div key={lane} style={{ display: 'flex', alignItems: 'center', gap: '0.8vmin' }}>
                                <LaneBadge
                                    color={colorForLane(laneColors, lane)}
                                    style={{ fontSize: '1.5vmin', color: SCRIM_TEXT_MUTED }}
                                >
                                    {lane}
                                </LaneBadge>
                                <span style={{ fontSize: '1.9vmin', fontWeight: 'bold' }}>
                                    {formatDisplayName(nameDisplay, racer.firstName, racer.lastName)}
                                </span>
                                {racer.carNumber != null && (
                                    <span style={{ fontSize: '1.5vmin', color: SCRIM_TEXT_MUTED }}>
                                        {vehicle} #{racer.carNumber}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
