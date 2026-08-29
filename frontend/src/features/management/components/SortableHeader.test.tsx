import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SortableHeader from './SortableHeader';
import { DEFAULT_SORT } from '../rosterSort';

const header = (props: Partial<React.ComponentProps<typeof SortableHeader>> = {}) =>
    render(
        <table>
            <thead>
                <tr>
                    <SortableHeader
                        label="RacingGroup"
                        sortKey="racingGroup"
                        sort={DEFAULT_SORT}
                        onSort={vi.fn()}
                        {...props}
                    />
                </tr>
            </thead>
        </table>,
    );

describe('SortableHeader', () => {
    it('is a button, so it can be reached from a keyboard', () => {
        // A `th` with an onClick is unreachable without a mouse and announces
        // nothing.
        header();

        expect(screen.getByRole('button', { name: /RacingGroup/ })).toBeInTheDocument();
    });

    it('announces nothing when it is not the sorted column', () => {
        header();

        expect(screen.getByTestId('sort-racingGroup')).toHaveAttribute('aria-sort', 'none');
    });

    it('announces the direction when it is', () => {
        header({ sort: { key: 'racingGroup', direction: 'desc' } });

        expect(screen.getByTestId('sort-racingGroup')).toHaveAttribute('aria-sort', 'descending');
    });

    it('asks for its own column when clicked', async () => {
        const onSort = vi.fn();
        header({ onSort });

        await userEvent.click(screen.getByRole('button', { name: /RacingGroup/ }));

        expect(onSort).toHaveBeenCalledWith('racingGroup');
    });
});
