/**
 * A roster column header you can sort by (#203).
 *
 * The button is inside the `th` rather than the `th` carrying the click
 * itself: a header cell with an `onClick` is not reachable from a keyboard and
 * announces nothing, and the sort state has to be announced somewhere — which
 * is `aria-sort`, on the cell.
 */

import { Icon } from '@mdi/react';
import { mdiMenuDown, mdiMenuUp, mdiUnfoldMoreHorizontal } from '@mdi/js';

import { ariaSortFor, type SortKey, type SortState } from '../rosterSort';

interface Props {
    label: string;
    sortKey: SortKey;
    sort: SortState;
    onSort: (key: SortKey) => void;
    align?: 'left' | 'center';
}

export default function SortableHeader({ label, sortKey, sort, onSort, align = 'left' }: Props) {
    const active = sort.key === sortKey;
    const ariaSort = ariaSortFor(sort, sortKey);

    return (
        <th
            style={{ padding: 0, textAlign: align }}
            aria-sort={ariaSort}
            data-testid={`sort-${sortKey}`}
        >
            <button
                type="button"
                onClick={() => onSort(sortKey)}
                style={{
                    width: '100%',
                    padding: '12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    font: 'inherit',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: align === 'center' ? 'center' : 'flex-start',
                    gap: '4px',
                }}
            >
                {label}
                {/* The inactive columns keep a faint marker rather than nothing
                    at all: an arrow that appears only on hover is invisible on
                    the tablet at the check-in desk. */}
                <Icon
                    path={active ? (sort.direction === 'asc' ? mdiMenuUp : mdiMenuDown) : mdiUnfoldMoreHorizontal}
                    size={0.7}
                    style={{ opacity: active ? 1 : 0.4 }}
                />
            </button>
        </th>
    );
}
