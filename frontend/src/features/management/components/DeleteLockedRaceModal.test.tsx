// @vitest-environment jsdom
/**
 * Deleting a locked race requires typing its exact name (#585) — the
 * server-side rule stays the operator PIN (`backend/api/race_lock.py`
 * deliberately does not gate `deleteRace` by name); this is the client-side
 * safeguard against the one click that undoes everything.
 */
import '../../../setupTests';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteLockedRaceModal from './DeleteLockedRaceModal';

describe('DeleteLockedRaceModal', () => {
    it('starts with the delete button disabled', () => {
        render(
            <DeleteLockedRaceModal
                isOpen
                raceName="2026 Pinewood Derby"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: 'Delete race' })).toBeDisabled();
    });

    it('stays disabled for a partial or mistyped name', async () => {
        const user = userEvent.setup();
        render(
            <DeleteLockedRaceModal
                isOpen
                raceName="2026 Pinewood Derby"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        await user.type(
            screen.getByLabelText('Type the race name to confirm deletion'),
            '2026 Pinewood',
        );

        expect(screen.getByRole('button', { name: 'Delete race' })).toBeDisabled();
    });

    it('enables the delete button once the exact name is typed', async () => {
        const user = userEvent.setup();
        render(
            <DeleteLockedRaceModal
                isOpen
                raceName="2026 Pinewood Derby"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        await user.type(
            screen.getByLabelText('Type the race name to confirm deletion'),
            '2026 Pinewood Derby',
        );

        expect(screen.getByRole('button', { name: 'Delete race' })).toBeEnabled();
    });

    it('calls onConfirm only once the name matches', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(
            <DeleteLockedRaceModal
                isOpen
                raceName="2026 Pinewood Derby"
                onCancel={vi.fn()}
                onConfirm={onConfirm}
            />,
        );

        await user.type(
            screen.getByLabelText('Type the race name to confirm deletion'),
            '2026 Pinewood Derby',
        );
        await user.click(screen.getByRole('button', { name: 'Delete race' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel from the Cancel button', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(
            <DeleteLockedRaceModal
                isOpen
                raceName="2026 Pinewood Derby"
                onCancel={onCancel}
                onConfirm={vi.fn()}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
