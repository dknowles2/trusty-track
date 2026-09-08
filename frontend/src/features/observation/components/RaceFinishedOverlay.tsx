/**
 * The ending the audience display never had (#869) — full-bleed, the same
 * shape `IntermissionOverlay` already proved on this surface: a break takes
 * over the whole screen because it is a fact about the race, not about which
 * view a screen happened to be assigned, and a finished race is exactly the
 * same kind of fact.
 *
 * Shown once nothing is on the track and nothing is next (`raceIsFinished`
 * decides that, purely, in `../raceFinished.ts`) — replacing the two "No
 * heat scheduled" panels the standard and projector layouts used to fall
 * back to whether racing had not started yet or had already finished.
 */

import { Icon } from '@mdi/react';
import { mdiFlagCheckered, mdiTrophy } from '@mdi/js';
import RacerAvatar from '../../management/components/RacerAvatar';
import { formatDisplayName, shouldShowRacerPhoto, type NameDisplay } from '../../core/displayName';

export interface FinalStanding {
    racerId: number;
    rank: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
    racerImageUrl?: string | null;
    score: number;
}

interface RaceFinishedOverlayProps {
    /** The championship round's own name, when its placings are what is
     * shown — `null` for the overall standings fallback, which is every
     * race with no championship round. */
    roundLabel: string | null;
    standings: readonly FinalStanding[];
    formatScore: (score: number) => string;
    scoreLabel: string;
    nameDisplay: NameDisplay | string;
    vehicle: string;
}

export default function RaceFinishedOverlay({
    roundLabel,
    standings,
    formatScore,
    scoreLabel,
    nameDisplay,
    vehicle,
}: RaceFinishedOverlayProps) {
    // Enough to fill a screen without dwarfing a small pack's own field —
    // the same top-5 cut the projector layout's own standings panel uses.
    const top = standings.slice(0, 5);

    return (
        <div
            data-testid="race-finished-overlay"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 2000,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--display-bg-color)',
                color: 'var(--display-text-color)',
                padding: '4vmin',
                boxSizing: 'border-box',
            }}
        >
            <Icon path={mdiFlagCheckered} size={4} color="var(--display-accent-color)" />

            <div style={{ fontSize: '4vmin', fontWeight: 'bold', marginTop: '2vmin', textAlign: 'center' }}>
                Race complete!
            </div>

            <div
                style={{
                    fontSize: '2.5vmin',
                    color: 'var(--display-text-muted-color)',
                    marginTop: '1vmin',
                    marginBottom: '3vmin',
                    textAlign: 'center',
                }}
            >
                {roundLabel ? `${roundLabel} results` : 'Final standings'}
            </div>

            {top.length > 0 && (
                <div
                    style={{
                        width: '100%',
                        maxWidth: '900px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1.5vmin',
                    }}
                >
                    {top.map((standing) => (
                        <div
                            key={standing.racerId}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2vmin',
                                padding: '1.5vmin 2vmin',
                                borderRadius: '1.5vmin',
                                background: standing.rank === 1
                                    ? 'var(--display-highlight-gold-tint-color)'
                                    : 'var(--display-card-bg-color)',
                                borderLeft: `1vmin solid ${
                                    standing.rank === 1 ? '#d4af37' : standing.rank === 2 ? '#c0c0c0' : standing.rank === 3 ? '#cd7f32' : 'var(--display-border-color)'
                                }`,
                            }}
                        >
                            <div style={{ fontSize: '3vmin', fontWeight: 'bold', width: '4.5vmin', textAlign: 'center' }}>
                                {standing.rank === 1 ? <Icon path={mdiTrophy} size="3vmin" color="#d4af37" /> : standing.rank}
                            </div>
                            <RacerAvatar
                                racer={{
                                    id: standing.racerId,
                                    first_name: standing.firstName,
                                    last_name: standing.lastName,
                                    racer_image_url: shouldShowRacerPhoto(nameDisplay) ? standing.racerImageUrl : null,
                                }}
                                size="6vmin"
                                style={{ border: '0.3vmin solid var(--display-border-color)', flexShrink: 0 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '2.5vmin', fontWeight: 'bold' }}>
                                    {formatDisplayName(nameDisplay, standing.firstName, standing.lastName)}
                                </div>
                                {standing.carNumber != null && (
                                    <div style={{ fontSize: '1.8vmin', color: 'var(--display-text-muted-color)' }}>
                                        {vehicle} #{standing.carNumber}
                                    </div>
                                )}
                            </div>
                            <div style={{ fontSize: '2.2vmin', fontWeight: 'bold', textAlign: 'right' }}>
                                {formatScore(standing.score)}
                                <div style={{ fontSize: '1.4vmin', fontWeight: 'normal', color: 'var(--display-text-muted-color)' }}>
                                    {scoreLabel}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
