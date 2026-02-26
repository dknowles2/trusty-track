import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeTimerMole } from './FakeTimerMole';
import { Provider } from 'urql';
import { fromValue, never } from 'wonka';
import { AlertProvider } from '../../../context/AlertContext';

// Helper to create a minimal urql client mock
function makeClient(overrides: Record<string, unknown> = {}) {
    return {
        executeQuery: () => never,
        executeMutation: () => fromValue({ data: { fakeTimerStart: true, fakeTimerFinish: true }, stale: false, hasNext: false }),
        executeSubscription: () => fromValue({
            data: { timerStatus: { status: { state: 'IDLE', deviceName: null, activeHeatId: null, lastError: null } } },
            stale: false,
            hasNext: false,
        }),
        ...overrides,
    } as any;
}

function renderWithProviders(ui: React.ReactElement, { client = makeClient() } = {}) {
    return render(
        <Provider value={client}>
            <AlertProvider>
                {ui}
            </AlertProvider>
        </Provider>
    );
}

describe('FakeTimerMole', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders nothing when isOpen is false', () => {
        renderWithProviders(
            <FakeTimerMole isOpen={false} heatId={1} trackId={1} />
        );
        expect(screen.queryByText('Fake Timer Controls')).not.toBeInTheDocument();
    });

    it('renders when isOpen is true', () => {
        renderWithProviders(
            <FakeTimerMole isOpen={true} heatId={1} trackId={1} />
        );
        expect(screen.getByText('Fake Timer Controls')).toBeInTheDocument();
    });

    it('shows Start Timer and Finish Heat buttons', () => {
        renderWithProviders(
            <FakeTimerMole isOpen={true} heatId={1} trackId={1} />
        );
        expect(screen.getByText('Start Timer')).toBeInTheDocument();
        expect(screen.getByText('Finish Heat')).toBeInTheDocument();
    });

    it('disables Start Timer when timerState is not ARMED (IDLE)', () => {
        const client = makeClient({
            executeSubscription: () => fromValue({
                data: { timerStatus: { status: { state: 'IDLE', deviceName: null, activeHeatId: null, lastError: null } } },
                stale: false,
                hasNext: false,
            }),
        });
        renderWithProviders(
            <FakeTimerMole isOpen={true} heatId={1} trackId={1} />,
            { client }
        );
        expect(screen.getByText('Start Timer')).toBeDisabled();
    });

    it('enables Start Timer when timerState is ARMED', () => {
        const client = makeClient({
            executeSubscription: () => fromValue({
                data: { timerStatus: { status: { state: 'ARMED', deviceName: null, activeHeatId: null, lastError: null } } },
                stale: false,
                hasNext: false,
            }),
        });
        renderWithProviders(
            <FakeTimerMole isOpen={true} heatId={1} trackId={1} />,
            { client }
        );
        expect(screen.getByText('Start Timer')).not.toBeDisabled();
    });

    it('enables Finish Heat and shows Racing... when timerState is RUNNING', () => {
        const client = makeClient({
            executeSubscription: () => fromValue({
                data: { timerStatus: { status: { state: 'RUNNING', deviceName: null, activeHeatId: null, lastError: null } } },
                stale: false,
                hasNext: false,
            }),
        });
        renderWithProviders(
            <FakeTimerMole isOpen={true} heatId={1} trackId={1} />,
            { client }
        );
        expect(screen.getByText('Racing...')).toBeInTheDocument();
        expect(screen.getByText('Finish Heat')).not.toBeDisabled();
    });

    it('shows Heat Completed status when timerState is IDLE', () => {
        renderWithProviders(
            <FakeTimerMole isOpen={true} heatId={1} trackId={1} />
        );
        expect(screen.getByText('Heat Completed')).toBeInTheDocument();
    });
});
