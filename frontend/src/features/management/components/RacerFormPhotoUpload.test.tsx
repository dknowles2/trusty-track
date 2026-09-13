// @vitest-environment jsdom
import '../../../setupTests';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});

describe('a failed photo upload', () => {
    it('tells the operator, rather than only logging to the console', async () => {
        // A racer sitting with no photo and no explanation is #346's report:
        // the mutation errored and only console.error heard about it. A bare
        // `Error` (no `graphQLErrors`, no `networkError`) is what a urql
        // `CombinedError` never actually looks like, but `errorText` still
        // owes it a sentence — its own `.message` is the fallback of last
        // resort.
        const uploadImageMutation = vi.fn().mockResolvedValue({
            error: new Error('network down'),
        });
        vi.mocked(useMutation).mockReturnValue([
            { fetching: false, stale: false },
            uploadImageMutation,
        ] as never);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <AlertProvider>
                <RacerForm raceId={1} onSubmit={vi.fn()} onCancel={vi.fn()} />
            </AlertProvider>,
        );

        const file = new File(['x'], 'racer.png', { type: 'image/png' });
        const input = document.getElementById('racer-file') as HTMLInputElement;
        await userEvent.upload(input, file);

        await waitFor(() => {
            expect(screen.getByText('network down')).toBeInTheDocument();
        });
    });

    it('shows the server\'s own message, not a generic one (#1095)', async () => {
        // The shape a urql `CombinedError` actually takes when the demo
        // refuses `uploadImage` — this is the case #1095 was filed over:
        // the operator saw "Failed to upload photo. Please try again." and
        // trying again could never have helped.
        const uploadImageMutation = vi.fn().mockResolvedValue({
            error: {
                graphQLErrors: [{ message: 'uploadImage is not available on the demo' }],
            },
        });
        vi.mocked(useMutation).mockReturnValue([
            { fetching: false, stale: false },
            uploadImageMutation,
        ] as never);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <AlertProvider>
                <RacerForm raceId={1} onSubmit={vi.fn()} onCancel={vi.fn()} />
            </AlertProvider>,
        );

        const file = new File(['x'], 'racer.png', { type: 'image/png' });
        const input = document.getElementById('racer-file') as HTMLInputElement;
        await userEvent.upload(input, file);

        await waitFor(() => {
            expect(
                screen.getByText('uploadImage is not available on the demo'),
            ).toBeInTheDocument();
        });
        expect(screen.queryByText(/Please try again/)).not.toBeInTheDocument();
    });
});
