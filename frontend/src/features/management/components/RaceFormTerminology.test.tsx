// @vitest-environment jsdom
/**
 * The per-race terminology override (#496 stage 3). Storage and resolution
 * are backend-tested (`test_terminology.py`); this is only the form's own
 * behaviour — visible while editing, hidden while creating, and the
 * checkbox controlling all four fields together.
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
    it('offers no terminology override at all', () => {
        render(<RaceForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create Race" />);

        expect(screen.queryByText('Use different words for this race')).toBeNull();
    });
});

describe('editing a race with no override', () => {
    it('shows the checkbox unchecked and no fields', () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby' }}
            />,
        );

        const checkbox = screen.getByLabelText('Use different words for this race');
        expect(checkbox).not.toBeChecked();
        expect(screen.queryByLabelText('One racing group')).toBeNull();
    });

    it('checking the box seeds the built-in words and submits them', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby' }}
            />,
        );

        await userEvent.click(screen.getByLabelText('Use different words for this race'));
        expect(screen.getByLabelText('One racing group')).toHaveValue('Den');

        await userEvent.clear(screen.getByLabelText('One racing group'));
        await userEvent.type(screen.getByLabelText('One racing group'), 'Class');
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.racing_group_singular).toBe('Class');
        // Untouched fields still travel — all four are one override, not
        // four independent ones, once the box is checked.
        expect(payload.organization_singular).toBe('Pack');
    });

    it('unchecking the box clears all four fields back to null', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{
                    name: 'Pack 42 Derby',
                    racing_group_singular: 'Class',
                    racing_group_plural: 'Classes',
                    organization_singular: 'Club',
                    organization_plural: 'Clubs',
                }}
            />,
        );

        expect(screen.getByLabelText('Use different words for this race')).toBeChecked();
        await userEvent.click(screen.getByLabelText('Use different words for this race'));
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.racing_group_singular).toBeNull();
        expect(payload.racing_group_plural).toBeNull();
        expect(payload.organization_singular).toBeNull();
        expect(payload.organization_plural).toBeNull();
    });
});
