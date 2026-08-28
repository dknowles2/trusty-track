// @vitest-environment jsdom
/**
 * #346: clearing "Global Start Number" left `parseInt('')` — `NaN` — as the
 * field's value, which serialises to `null` over the wire. Every other
 * numeric field on this form falls back to a default when the input parses to
 * nothing; this one didn't.
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

describe('clearing the global start number', () => {
    it('falls back to 1 rather than submitting NaN', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create Race" />,
        );

        await userEvent.type(screen.getByLabelText('Event Name'), 'Pack 42 Derby');
        const field = screen.getByLabelText('Global Start Number');
        await userEvent.clear(field);
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const payload = onSubmit.mock.calls[0][0];
        expect(payload.global_start_number).toBe(1);
        expect(Number.isNaN(payload.global_start_number)).toBe(false);
    });
});
