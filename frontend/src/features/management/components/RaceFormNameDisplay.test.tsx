// @vitest-environment jsdom
/**
 * The per-race name-display override (#552). Storage and resolution are
 * backend-tested (`test_name_display.py`); this is only the form's own
 * behaviour — visible while editing, hidden while creating, and the
 * checkbox controlling whether the race overrides the organization's
 * setting at all.
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

// The override lives in the "Words and names" section, which is a click away
// while editing (#587) — the form opens on Event.
const openWords = () => userEvent.click(screen.getByTestId('race-settings-nav-words'));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuery).mockReturnValue([
        { data: { tracks: [{ id: 7, name: 'Main Track' }] }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
});

describe('creating a race', () => {
    it('offers no name-display override at all', () => {
        render(<RaceForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create Race" />);

        expect(screen.queryByText('Override names on public screens for this race')).toBeNull();
    });
});

describe('editing a race with no override', () => {
    it('shows the checkbox unchecked and no options', async () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby' }}
            />,
        );
        await openWords();

        const checkbox = screen.getByLabelText('Override names on public screens for this race');
        expect(checkbox).not.toBeChecked();
        expect(screen.queryByLabelText(/^Full name/)).toBeNull();
    });

    it('checking the box seeds Full name and submits it', async () => {
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
        await openWords();

        await userEvent.click(screen.getByLabelText('Override names on public screens for this race'));
        expect(screen.getByLabelText(/^Full name/)).toBeChecked();

        await userEvent.click(screen.getByLabelText(/^First name and last initial/));
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.name_display).toBe('LAST_INITIAL');
    });

    it('unchecking the box clears the override back to null', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', name_display: 'FIRST_ONLY' }}
            />,
        );
        await openWords();

        expect(screen.getByLabelText('Override names on public screens for this race')).toBeChecked();
        expect(screen.getByLabelText(/^First name only/)).toBeChecked();
        await userEvent.click(screen.getByLabelText('Override names on public screens for this race'));
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.name_display).toBeNull();
    });
});
