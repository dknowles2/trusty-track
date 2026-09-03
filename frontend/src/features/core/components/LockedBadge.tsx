import { Icon } from '@mdi/react';
import { mdiLock } from '@mdi/js';

/**
 * The one badge for "this race is locked against further edits" (#585).
 *
 * Shared rather than three copies with slightly different padding: Home's
 * race rows, the navigation's race pill, and Race Control's header all want
 * the same small pill, and a shared component is what keeps them saying it
 * the same way. Renders nothing when the race is not locked, so every call
 * site can render it unconditionally.
 */
export default function LockedBadge({ size = 'normal' }: { size?: 'small' | 'normal' }) {
    const compact = size === 'small';
    return (
        <span
            title="This race is locked against further edits"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: compact ? '1px 6px' : '2px 8px',
                borderRadius: '10px',
                fontSize: compact ? '0.7rem' : '0.75rem',
                fontWeight: 'bold',
                backgroundColor: 'var(--warning-bg-color)',
                color: 'var(--warning-strong-color)',
                border: '1px solid var(--warning-strong-border-color)',
                whiteSpace: 'nowrap',
            }}
        >
            <Icon path={mdiLock} size={compact ? 0.5 : 0.6} />
            Locked
        </span>
    );
}
