/**
 * How far check-in has got, on the page where it happens (#204).
 *
 * The Home page has shown these two numbers per race for a long time. The
 * roster — the screen the check-in operator is actually looking at all morning
 * — showed neither, so the question the room keeps asking, "can we start yet",
 * had to be answered by scrolling a list of sixty and counting green buttons.
 */

interface Props {
    checkedIn: number;
    registered: number;
}

export default function CheckInProgress({ checkedIn, registered }: Props) {
    // Nothing to report before there is anybody. "0 of 0 checked in" reads as
    // a problem on a race that has simply not been filled in yet, and the setup
    // checklist is already saying what to do about that.
    if (registered === 0) return null;

    const done = checkedIn >= registered;
    const fraction = Math.min(1, checkedIn / registered);

    return (
        <div
            data-testid="check-in-progress"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
        >
            <div
                aria-hidden
                style={{
                    width: '90px',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'var(--progress-track-color)',
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        width: `${fraction * 100}%`,
                        height: '100%',
                        background: done ? 'var(--success-color)' : 'var(--cub-scouting-gold)',
                    }}
                />
            </div>
            <span style={{ color: done ? 'var(--success-color)' : 'var(--text-muted-color)', whiteSpace: 'nowrap' }}>
                {checkedIn} of {registered} checked in
            </span>
        </div>
    );
}
