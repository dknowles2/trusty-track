// @vitest-environment jsdom
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
        { data: { race: { dens: [] } }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
    vi.mocked(useMutation).mockReturnValue([{ fetching: false, stale: false }, vi.fn()] as never);
});

const form = (weightLimitOz?: number | null) =>
    render(
        <AlertProvider>
            <RacerForm
                raceId={1}
                weightLimitOz={weightLimitOz}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />
        </AlertProvider>,
    );

describe('the weight limit warning', () => {
    it('warns when the car is over the race limit', async () => {
        form(5);

        await userEvent.type(screen.getByLabelText('Car Weight (oz)'), '5.4');

        expect(screen.getByTestId('weight-warning')).toHaveTextContent(
            'Over the 5 oz limit for this race.',
        );
    });

    it('says nothing about a car under the limit', async () => {
        form(5);

        await userEvent.type(screen.getByLabelText('Car Weight (oz)'), '4.9');

        expect(screen.queryByTestId('weight-warning')).not.toBeInTheDocument();
    });

    it('says nothing on a race that does not check weights', async () => {
        // Which is every race created before the limit existed.
        form(null);

        await userEvent.type(screen.getByLabelText('Car Weight (oz)'), '9.9');

        expect(screen.queryByTestId('weight-warning')).not.toBeInTheDocument();
    });

    it('does not block the save', async () => {
        // The inspector at the table decides; a laptop refusing the entry
        // would only mean the weight goes unrecorded.
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(
            <AlertProvider>
                <RacerForm raceId={1} weightLimitOz={5} onSubmit={onSubmit} onCancel={vi.fn()} />
            </AlertProvider>,
        );

        await userEvent.type(screen.getByLabelText('First Name'), 'Ada');
        await userEvent.type(screen.getByLabelText('Last Name'), 'Ant');
        await userEvent.type(screen.getByLabelText('Car Weight (oz)'), '5.4');
        await userEvent.click(screen.getByRole('button', { name: /Save Racer/ }));

        expect(onSubmit).toHaveBeenCalled();
        expect(onSubmit.mock.calls[0][0].car_weight).toBe(5.4);
    });

    it('describes the field, so the warning is announced with it', async () => {
        form(5);
        const field = screen.getByLabelText('Car Weight (oz)');

        await userEvent.type(field, '5.4');

        expect(field).toHaveAttribute('aria-describedby', 'racer-car-weight-notice');
    });
});
