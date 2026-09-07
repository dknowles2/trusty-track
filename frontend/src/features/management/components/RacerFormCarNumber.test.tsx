// @vitest-environment jsdom
/**
 * A warning, never a refusal, for a duplicate car number typed into
 * Add/Edit Racer (#811 part 1, follow-up to #741/#810). `MANUAL` numbering
 * deliberately allows racers to share a number — the check-in scanner's
 * manual-entry box only resolves when exactly one racer holds the number,
 * precisely because duplicates are legitimate there — so this must never
 * block the save, under any numbering strategy.
 */
import '../../../setupTests';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn(), useMutation: vi.fn() };
});

import { useQuery, useMutation } from 'urql';
import RacerForm from './RacerForm';
import { AlertProvider } from '../../../context/AlertContext';

beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue([
        { data: { race: { racingGroups: [] } }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
    vi.mocked(useMutation).mockReturnValue([{ fetching: false, stale: false }, vi.fn()] as never);
});

const existingRacers = [
    { id: 1, first_name: 'Jordan', last_name: 'Mitchell', car_number: 12 },
    { id: 2, first_name: 'Ada', last_name: 'Ant', car_number: 7 },
];

const form = (props: Partial<React.ComponentProps<typeof RacerForm>> = {}) =>
    render(
        <AlertProvider>
            <RacerForm
                raceId={1}
                existingRacers={existingRacers}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                {...props}
            />
        </AlertProvider>,
    );

describe('the duplicate car number warning', () => {
    it('warns when the typed number already belongs to another racer', async () => {
        form();

        await userEvent.type(screen.getByLabelText('Car Number'), '12');

        expect(screen.getByTestId('car-number-warning')).toHaveTextContent('Jordan Mitchell');
    });

    it('says nothing about a number nobody else holds', async () => {
        form();

        await userEvent.type(screen.getByLabelText('Car Number'), '99');

        expect(screen.queryByTestId('car-number-warning')).not.toBeInTheDocument();
    });

    it('does not warn about a racer\'s own current number while editing them', async () => {
        form({
            initialData: {
                first_name: 'Jordan',
                last_name: 'Mitchell',
                car_number: 12,
                car_passed_inspection: false,
                excluded_from_standings: false,
            },
            excludeRacerId: 1,
        });

        expect(screen.getByLabelText('Car Number')).toHaveValue(12);
        expect(screen.queryByTestId('car-number-warning')).not.toBeInTheDocument();
    });

    it('does not block the save', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        form({ onSubmit });

        await userEvent.type(screen.getByLabelText('First Name'), 'Sam');
        await userEvent.type(screen.getByLabelText('Last Name'), 'Speedy');
        await userEvent.type(screen.getByLabelText('Car Number'), '12');
        await userEvent.click(screen.getByRole('button', { name: /Save Racer/ }));

        expect(onSubmit).toHaveBeenCalled();
        expect(onSubmit.mock.calls[0][0].car_number).toBe(12);
    });
});
