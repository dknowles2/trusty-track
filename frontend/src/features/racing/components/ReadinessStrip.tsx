/**
 * Pre-flight, on the screen where the racing starts (#200).
 *
 * The rules are in `readiness.ts`. This loads the four answers — the timer's
 * own state, the roster's check-in counts, the heats that exist, and how many
 * audience screens are listening — and renders what they mean.
 *
 * The timer answer comes from its own lean subscription rather than the one
 * `TimerStatusBadge` uses: that document carries the whole serial log and every
 * pending lane time, which is a lot of traffic for a strip that wants a state
 * and a name.
 */

import { Link } from 'react-router-dom';
import { useQuery, useSubscription } from 'urql';
import { Icon } from '@mdi/react';
import { mdiAlertCircle, mdiAlertOutline, mdiCheckCircle, mdiInformationOutline } from '@mdi/js';

import { DISPLAYS_QUERY } from '../../observation/graphql/queries';
import { TIMER_READINESS_SUBSCRIPTION } from '../graphql/queries';
import {
    isCompact,
    overallLevel,
    readinessItems,
    summaryLine,
    type ReadinessItem,
    type ReadinessLevel,
} from '../readiness';

interface Props {
    raceId: number;
    trackId: number | null;
    timerType: string | null;
    registeredCount: number;
    checkedInCount: number;
    heatCount: number;
}

const APPEARANCE: Record<ReadinessLevel, { icon: string; colour: string }> = {
    BLOCKED: { icon: mdiAlertCircle, colour: 'var(--danger-strong-color)' },
    ATTENTION: { icon: mdiAlertOutline, colour: 'var(--attention-accent-color)' },
    OK: { icon: mdiCheckCircle, colour: 'var(--success-color)' },
    INFO: { icon: mdiInformationOutline, colour: 'var(--neutral-info-color)' },
};

function Row({ item }: { item: ReadinessItem }) {
    const { icon, colour } = APPEARANCE[item.level];
    return (
        <li
            data-testid={`readiness-${item.key}`}
            data-level={item.level}
            style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}
        >
            <Icon path={icon} size={0.7} color={colour} style={{ alignSelf: 'center' }} />
            <strong style={{ minWidth: '5.5rem' }}>{item.label}</strong>
            <span style={{ color: 'var(--text-heading-alt-color)' }}>{item.detail}</span>
            {item.href && (
                <Link to={item.href} style={{ fontSize: '0.85rem' }}>
                    Check it
                </Link>
            )}
            {item.note && (
                <span style={{ width: '100%', paddingLeft: '6.4rem', fontSize: '0.8rem', color: 'var(--text-quiet-color)' }}>
                    {item.note}
                </span>
            )}
        </li>
    );
}

export default function ReadinessStrip({
    raceId,
    trackId,
    timerType,
    registeredCount,
    checkedInCount,
    heatCount,
}: Props) {
    const [timerResult] = useSubscription({
        query: TIMER_READINESS_SUBSCRIPTION,
        variables: { trackId: trackId ?? 0 },
        pause: !trackId,
    });
    const [displaysResult] = useQuery({
        query: DISPLAYS_QUERY,
        variables: { raceId },
        pause: !raceId,
    });

    const status = timerResult.data?.timerStatus?.status;
    const displays: { connected: boolean }[] = displaysResult.data?.displays ?? [];

    const items = readinessItems({
        // A race with no track has no timer to ask about, and null is what the
        // rules read as "no answer yet" rather than as a fault.
        timerState: trackId ? (status?.state ?? null) : null,
        timerDeviceName: status?.deviceName ?? null,
        timerProvenance: status?.deviceProvenance ?? null,
        timerType,
        registeredCount,
        checkedInCount,
        heatCount,
        connectedDisplays: displays.filter((display) => display.connected).length,
    });

    const level = overallLevel(items);
    const compact = isCompact(items);
    const { icon, colour } = APPEARANCE[level];

    return (
        <div
            data-testid="readiness-strip"
            data-level={level}
            style={{
                margin: '0 auto 1.25rem',
                maxWidth: '900px',
                width: '100%',
                background: 'var(--surface-color)',
                border: '1px solid var(--border-faint-color)',
                borderLeft: `4px solid ${colour}`,
                borderRadius: '12px',
                padding: compact ? '0.6rem 1rem' : '0.9rem 1.15rem',
                fontSize: '0.95rem',
            }}
        >
            {compact ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Icon path={icon} size={0.75} color={colour} />
                    <strong>Ready to race</strong>
                    <span style={{ color: 'var(--text-muted-color)' }}>{summaryLine(items)}</span>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                        <Icon path={icon} size={0.8} color={colour} />
                        <strong>
                            {level === 'BLOCKED' ? 'Not ready to race yet' : 'Nearly ready'}
                        </strong>
                    </div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}>
                        {items.map((item) => (
                            <Row key={item.key} item={item} />
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}
