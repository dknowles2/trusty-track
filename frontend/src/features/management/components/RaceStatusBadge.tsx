import { Icon } from '@mdi/react';
import { mdiCheckCircle, mdiFlagCheckered, mdiTimerSandEmpty } from '@mdi/js';

/**
 * "Finished / in progress / not started" (#847) — the one piece of #847
 * item 3 the deferring PR (#917) left undone, because the answer needs a
 * race's heats and lanes, and `Home.tsx`'s `GetRaces` query is the one list
 * `#749` pinned to a *constant* SQL cost regardless of how many races the
 * install has ever run (`.claude/rules/roster.md`'s "The Home page race
 * list"). `Race.status` is computed server-side, batched the same way
 * `registeredCount`/`checkedInCount` already are, so this component only
 * ever renders what it is told.
 *
 * A pill beside the race name, the same slot `LockedBadge` already uses —
 * not a table column, so a race list with no rows (the first-run docs
 * screenshot) shows no header for it either.
 */
export type RaceStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED';

const CONFIG: Record<
    RaceStatus,
    { label: string; icon: string; bg: string; color: string; border: string }
> = {
    NOT_STARTED: {
        label: 'Not started',
        icon: mdiTimerSandEmpty,
        bg: 'var(--divider-color)',
        color: 'var(--text-muted-color)',
        border: 'var(--border-color)',
    },
    IN_PROGRESS: {
        label: 'In progress',
        icon: mdiFlagCheckered,
        bg: 'var(--info-panel-bg-color)',
        color: 'var(--info-accent-color)',
        border: 'var(--info-panel-border-color)',
    },
    FINISHED: {
        label: 'Finished',
        icon: mdiCheckCircle,
        bg: 'var(--success-bg-color)',
        color: 'var(--success-color)',
        border: 'var(--success-accent-color)',
    },
};

export default function RaceStatusBadge({ status }: { status: RaceStatus }) {
    const config = CONFIG[status];
    // An unrecognised value (a build lagging the schema, say) renders
    // nothing rather than a guess — the same "print blank rather than
    // crash" rule the award artwork and vehicle glyphs follow.
    if (!config) return null;
    return (
        <span
            title={`This race's schedule is ${config.label.toLowerCase()}`}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '10px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                backgroundColor: config.bg,
                color: config.color,
                border: `1px solid ${config.border}`,
                whiteSpace: 'nowrap',
            }}
        >
            <Icon path={config.icon} size={0.6} />
            {config.label}
        </span>
    );
}
