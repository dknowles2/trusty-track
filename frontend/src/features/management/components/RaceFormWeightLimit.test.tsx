// @vitest-environment jsdom
/**
 * #767: `handleChange('weight_limit_oz', parseFloat(e.target.value) ||
 * DEFAULT_LIMIT_OZ)` treats a keystroke that parses to `0` — a leading `0`,
 * or an emptied field — as though nothing had been typed, and falls back to
 * the default (5). Because the input's own `value` is derived from that
 * stored number, the field snaps back to "5" mid-keystroke, so a sub-ounce
 * limit (a Space Derby rocket, a Raingutter Regatta boat) can never be typed:
 * clearing the field and typing "0.5" ends up holding "50.5".
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

describe('typing a sub-ounce weight limit', () => {
    it('holds 0.5, not 50.5', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create Race" />,
        );

        await userEvent.type(screen.getByLabelText('Event Name'), 'Rocket Derby');
        const field = screen.getByLabelText('Weight Limit (oz)');
        await userEvent.clear(field);
        await userEvent.type(field, '0.5');

        expect(field).toHaveValue(0.5);

        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const payload = onSubmit.mock.calls[0][0];
        expect(payload.weight_limit_oz).toBe(0.5);
    });
});
