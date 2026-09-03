// @vitest-environment jsdom
/**
 * The lock/unlock control (#585) — an operator's way to guard a concluded
 * race against an accidental edit, and their way back out. Backend
 * enforcement is covered in `backend/tests/test_race_lock.py`; this is only
 * the form's own behaviour. Gated on `isEditing`, the same reason the
 * master running order and terminology override are: `updateRace` is the
 * only mutation that accepts `isLocked`, so there is nothing to submit
 * while creating.
 */
import '../../../setupTests';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

import { useQuery } from 'urql';
import RaceForm, { RaceFormData } from './RaceForm';

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuery).mockReturnValue([
        { data: { tracks: [{ id: 7, name: 'Main Track' }] }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
});

describe('creating a race', () => {
    it('offers no lock control at all', () => {
        render(<RaceForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create Race" />);

        expect(screen.queryByLabelText(/Lock race|Unlock race/)).toBeNull();
    });
});

describe('editing a race', () => {
    it('defaults to unchecked, labelled "Lock race" — off for every existing race', () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby' }}
            />,
        );

        const checkbox = screen.getByLabelText('Lock race');
        expect(checkbox).not.toBeChecked();
    });

    it('starts checked and labelled "Unlock race" when the race is already locked', () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', is_locked: true }}
            />,
        );

        expect(screen.getByLabelText('Unlock race')).toBeChecked();
    });

    it('submits is_locked: true once checked', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>().mockResolvedValue(undefined);

        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', track_id: 7 }}
            />,
        );

        await user.click(screen.getByLabelText('Lock race'));
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ is_locked: true }),
        );
    });

    it('unchecking a locked race submits is_locked: false', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>().mockResolvedValue(undefined);

        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', track_id: 7, is_locked: true }}
            />,
        );

        await user.click(screen.getByLabelText('Unlock race'));
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ is_locked: false }),
        );
    });
});
