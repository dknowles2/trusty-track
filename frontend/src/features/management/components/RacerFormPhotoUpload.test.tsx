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
        { data: { race: { dens: [] } }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
});

describe('a failed photo upload', () => {
    it('tells the operator, rather than only logging to the console', async () => {
        // A racer sitting with no photo and no explanation is #346's report:
        // the mutation errored and only console.error heard about it.
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
            expect(screen.getByText(/Failed to upload photo/)).toBeInTheDocument();
        });
    });
});
