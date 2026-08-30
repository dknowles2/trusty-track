// @vitest-environment jsdom
/**
 * The master running order control (#549 stage 4) — one interleaved
 * sequence across racing groups, rather than a block per group. Backend
 * storage and the interleave itself are covered elsewhere
 * (`test_domain_running_order.py`, `test_master_running_order.py`); this is
 * only the form's own behaviour. Gated on `isEditing` the same way the
 * terminology override is: `updateRace` is the only mutation that accepts
 * this field, so there is nothing to submit while creating.
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
    it('offers no master running order control at all', () => {
        render(<RaceForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create Race" />);

        expect(screen.queryByLabelText(/Interleave heats/)).toBeNull();
    });
});

describe('editing a race', () => {
    it('defaults to unchecked — off for every existing race', () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby' }}
            />,
        );

        expect(screen.getByLabelText(/Interleave heats/)).not.toBeChecked();
        // #304: the description sits on screen whether or not the box is
        // checked, not revealed only once it is.
        expect(screen.getByText(/so the track need not sit/)).toBeInTheDocument();
    });

    it('starts checked when the race already has it on', () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', master_running_order: true }}
            />,
        );

        expect(screen.getByLabelText(/Interleave heats/)).toBeChecked();
    });

    it('submits the checked state as an ordinary boolean', async () => {
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

        await userEvent.click(screen.getByLabelText(/Interleave heats/));
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(onSubmit.mock.calls[0][0].master_running_order).toBe(true);
    });

    it('reads the word for a racing group from the resolved terminology, not a literal', () => {
        // No TerminologyProvider wraps this render, so useTerminology()
        // falls back to the built-in Scouting words — "Den" here is that
        // default doing its job, not a hardcode in RaceForm itself (see
        // terminologyGuard.test.ts, which scans this file's JSX for exactly
        // that mistake).
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby' }}
            />,
        );

        expect(screen.getByLabelText(/Interleave heats across every den/)).toBeInTheDocument();
    });
});
