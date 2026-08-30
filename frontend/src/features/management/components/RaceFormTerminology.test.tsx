// @vitest-environment jsdom
/**
 * The per-race terminology override (#496 stage 3; #551 adds the vehicle
 * pair and stage 4 of that issue adds its artwork). Storage and resolution
 * are backend-tested (`test_terminology.py`); this is only the form's own
 * behaviour — visible while editing, hidden while creating, and the
 * checkbox controlling all seven fields together.
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
        expect(screen.getByLabelText('One vehicle')).toHaveValue('Car');
        expect(screen.getByLabelText('Vehicle picture')).toHaveValue('car');

        await userEvent.clear(screen.getByLabelText('One racing group'));
        await userEvent.type(screen.getByLabelText('One racing group'), 'Class');
        await userEvent.clear(screen.getByLabelText('One vehicle'));
        await userEvent.type(screen.getByLabelText('One vehicle'), 'Rocket');
        await userEvent.selectOptions(screen.getByLabelText('Vehicle picture'), 'rocket');
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.racing_group_singular).toBe('Class');
        // Untouched fields still travel — all seven are one override, not
        // seven independent ones, once the box is checked.
        expect(payload.organization_singular).toBe('Pack');
        expect(payload.vehicle_singular).toBe('Rocket');
        // The word and the picture are independent (#551, stage 4) — an
        // operator can pick the rocket picture without the word being
        // literally "Rocket", and vice versa. Here both happen to change.
        expect(payload.vehicle_artwork_key).toBe('rocket');
    });

    it('unchecking the box clears all seven fields back to null', async () => {
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
                    vehicle_singular: 'Rocket',
                    vehicle_plural: 'Rockets',
                    vehicle_artwork_key: 'rocket',
                }}
            />,
        );

        expect(screen.getByLabelText('Use different words for this race')).toBeChecked();
        expect(screen.getByLabelText('Vehicle picture')).toHaveValue('rocket');
        await userEvent.click(screen.getByLabelText('Use different words for this race'));
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.racing_group_singular).toBeNull();
        expect(payload.racing_group_plural).toBeNull();
        expect(payload.organization_singular).toBeNull();
        expect(payload.organization_plural).toBeNull();
        expect(payload.vehicle_singular).toBeNull();
        expect(payload.vehicle_plural).toBeNull();
        expect(payload.vehicle_artwork_key).toBeNull();
    });
});
