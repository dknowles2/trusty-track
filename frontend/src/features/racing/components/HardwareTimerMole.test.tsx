/**
 * The operator's side of releasing the start gate (issue #111).
 *
 * The rule worth pinning is when the button is *not* there. It opens a gate,
 * and an operator who has learned it sometimes does nothing is the one who
 * presses it twice — so it only appears when the server says the track can do
 * it and a heat is actually armed.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { Provider } from 'urql';
import { fromValue, never } from 'wonka';
import { HardwareTimerMole } from './HardwareTimerMole';
import { AlertProvider } from '../../../context/AlertContext';

type Status = {
    state: string;
    canRemoteStart: boolean;
};

function renderMole(
    status: Status,
    { refusal = null as string | null } = {},
) {
    const executeMutation = vi.fn(() =>
        fromValue({ data: { releaseStartGate: refusal }, stale: false, hasNext: false }),
    );
    const client = {
        executeQuery: () => never,
        executeMutation,
        executeSubscription: () =>
            fromValue({
                data: {
                    timerStatus: {
                        status: {
                            deviceName: 'MicroWizard K1/K2/K3',
                            laneCount: 4,
                            activeHeatId: 1,
                            lastError: null,
                            serialLog: [],
                            ...status,
                        },
                    },
                },
                stale: false,
                hasNext: false,
            }),
    } as unknown as Parameters<typeof Provider>[0]['value'];

    render(
        <Provider value={client}>
            <AlertProvider>
                <HardwareTimerMole trackId={1} timerType="AUTO_DETECT_BACKEND" />
            </AlertProvider>
        </Provider>,
    );
    return { executeMutation };
}

const button = () => screen.queryByRole('button', { name: /release start gate/i });

describe('the release button', () => {
    it('is offered on an armed heat when the track can do it', () => {
        renderMole({ state: 'ARMED', canRemoteStart: true });
        expect(button()).toBeInTheDocument();
    });

    it('is offered on a staged heat', () => {
        renderMole({ state: 'READY', canRemoteStart: true });
        expect(button()).toBeInTheDocument();
    });

    it('is absent when the track has no gate release', () => {
        // The common case: the MicroWizard has the command, but the accessory
        // that command drives is sold separately and most tracks lack it.
        renderMole({ state: 'ARMED', canRemoteStart: false });
        expect(button()).not.toBeInTheDocument();
    });

    it('is absent with no heat armed', () => {
        // Releasing the gate here sends cars down a track nothing is timing.
        renderMole({ state: 'IDLE', canRemoteStart: true });
        expect(button()).not.toBeInTheDocument();
    });

    it('is absent once the race is running', () => {
        renderMole({ state: 'RUNNING', canRemoteStart: true });
        expect(button()).not.toBeInTheDocument();
    });
});

describe('pressing it', () => {
    it('sends the mutation', async () => {
        const { executeMutation } = renderMole({ state: 'ARMED', canRemoteStart: true });

        await userEvent.click(button()!);

        expect(executeMutation).toHaveBeenCalled();
    });

    it('shows the reason when the server refuses', async () => {
        // A refusal is data, not an error — the state can have moved on between
        // the payload the button was drawn from and the click.
        renderMole(
            { state: 'ARMED', canRemoteStart: true },
            { refusal: 'No heat is armed (timer is idle)' },
        );

        await userEvent.click(button()!);

        await waitFor(() =>
            expect(screen.getByText('No heat is armed (timer is idle)')).toBeInTheDocument(),
        );
    });

    it('says nothing when it worked', async () => {
        renderMole({ state: 'ARMED', canRemoteStart: true });

        await userEvent.click(button()!);

        await waitFor(() => expect(screen.queryByText(/no heat is armed/i)).not.toBeInTheDocument());
    });
});
