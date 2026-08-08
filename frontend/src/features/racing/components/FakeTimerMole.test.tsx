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

describe('collapsing the panel out of the way', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('starts expanded, because the buttons are the only way to run a heat', () => {
        // The hardware panel starts collapsed, but what it hides is a readout.
        // Hiding these would break the configuration the panel exists for.
        renderWithProviders(<FakeTimerMole isOpen heatId={1} trackId={1} />);

        expect(screen.getByText('Start Timer')).toBeInTheDocument();
        expect(screen.getByText('Finish Heat')).toBeInTheDocument();
    });

    it('collapses to just its header when the title is clicked', async () => {
        // It is `position: fixed` over the bottom-right corner, which is where
        // the On Deck list lives — so on a fake timer it sat permanently on top
        // of the next heat's racers.
        const user = (await import('@testing-library/user-event')).default.setup();
        renderWithProviders(<FakeTimerMole isOpen heatId={1} trackId={1} />);

        await user.click(screen.getByText('Fake Timer Controls'));

        expect(screen.queryByText('Start Timer')).not.toBeInTheDocument();
        expect(screen.queryByText('Finish Heat')).not.toBeInTheDocument();
        // Still identifiable, and still says what the timer is doing.
        expect(screen.getByText('Fake Timer Controls')).toBeInTheDocument();
        expect(screen.getByText('IDLE')).toBeInTheDocument();
    });

    it('remembers being collapsed across a remount', async () => {
        // The panel remounts on every navigation. Without this the operator
        // re-collapses it all evening, which is no better than not being able
        // to collapse it.
        const user = (await import('@testing-library/user-event')).default.setup();
        const first = renderWithProviders(<FakeTimerMole isOpen heatId={1} trackId={1} />);
        await user.click(screen.getByText('Fake Timer Controls'));
        first.unmount();

        renderWithProviders(<FakeTimerMole isOpen heatId={2} trackId={1} />);

        expect(screen.queryByText('Start Timer')).not.toBeInTheDocument();
    });

    it('expands again, and remembers that too', async () => {
        const user = (await import('@testing-library/user-event')).default.setup();
        window.localStorage.setItem('trustytrack.fakeTimerMole.collapsed', 'true');

        const first = renderWithProviders(<FakeTimerMole isOpen heatId={1} trackId={1} />);
        expect(screen.queryByText('Start Timer')).not.toBeInTheDocument();

        await user.click(screen.getByText('Fake Timer Controls'));
        expect(screen.getByText('Start Timer')).toBeInTheDocument();
        first.unmount();

        renderWithProviders(<FakeTimerMole isOpen heatId={1} trackId={1} />);
        expect(screen.getByText('Start Timer')).toBeInTheDocument();
    });

    it('renders even where storage refuses', () => {
        // Throws rather than returning null in some browser configurations, and
        // a debug panel must never be why a race screen fails to render.
        const getItem = vi
            .spyOn(window.localStorage, 'getItem')
            .mockImplementation(() => {
                throw new Error('denied');
            });
        try {
            renderWithProviders(<FakeTimerMole isOpen heatId={1} trackId={1} />);
            expect(screen.getByText('Start Timer')).toBeInTheDocument();
        } finally {
            getItem.mockRestore();
        }
    });
});
