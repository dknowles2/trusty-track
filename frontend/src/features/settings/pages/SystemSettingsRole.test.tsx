// @vitest-environment jsdom
/**
 * #892: `createInitialConfig`/`updateInitialConfig`,
 * `createTrackRecord`/`updateTrackRecord`/`deleteTrackRecord` and
 * `setLaneOutages` are all operator-only (backend/api/auth.py's
 * OPERATOR_ONLY_MUTATIONS) — the whole page used to offer Save Settings, the
 * lane checkboxes and the track-records form fully enabled to a check-in
 * tablet or an unauthenticated display, both of which can reach this page
 * (there is no route-level role gate). This is the screen's own half: which
 * controls are disabled for which role. Backend enforcement is
 * `backend/tests/test_auth_policy.py`'s job.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SystemSettings from './SystemSettings';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import { useQuery, useMutation } from 'urql';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn(), useMutation: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const openSection = async (id: 'general' | 'tracks' | 'backup') => {
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(await screen.findByTestId(`settings-nav-${id}`));
};

function mockConfigured(isOperator: boolean) {
    (useQuery as any).mockReturnValue([
        {
            data: {
                initialConfig: {
                    initialized: true,
                    organizationName: 'Pack 42',
                    debugMode: false,
                    isOperator,
                    tracks: [
                        {
                            id: 1,
                            name: 'Main Track',
                            laneCount: 4,
                            lengthFeet: 40,
                            timerType: 'FAKE',
                            serialPort: null,
                            timerProfile: null,
                            remoteStartInstalled: false,
                            laneOutages: [],
                            historicalRecords: [
                                { id: 9, timeSeconds: 3.5, racerName: 'Ada', carNumber: 1, raceName: null, raceDate: null },
                            ],
                        },
                    ],
                },
            },
            fetching: false,
            error: null,
        },
        vi.fn(),
    ]);
    (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);
}

function renderPage() {
    return render(
        <MemoryRouter>
            <AlertProvider>
                <SystemSettings />
            </AlertProvider>
        </MemoryRouter>,
    );
}

describe('the settings page reflects the caller role', () => {
    it('disables Save Settings for a non-operator', async () => {
        mockConfigured(false);
        renderPage();

        await openSection('general');
        expect(await screen.findByText('Save Settings')).toBeDisabled();
    });

    it('names the operator PIN on the disabled Save Settings button', async () => {
        mockConfigured(false);
        renderPage();

        await openSection('general');
        expect(await screen.findByText('Save Settings')).toHaveAttribute(
            'title',
            'That needs the operator PIN. Enter it with the lock icon in the top bar.',
        );
    });

    it('disables lane checkboxes and track-record controls for a non-operator', async () => {
        mockConfigured(false);
        renderPage();

        await openSection('tracks');
        expect(await screen.findByLabelText('Lane 1 works')).toBeDisabled();
        expect(screen.getByText('Add record')).toBeDisabled();
        expect(screen.getByLabelText('Edit the record held by Ada')).toBeDisabled();
    });

    it('disables backup and restore for a non-operator', async () => {
        mockConfigured(false);
        renderPage();

        await openSection('backup');
        expect(await screen.findByText('Download a backup')).toBeDisabled();
        expect(screen.getByText('Restore from a backup…')).toBeDisabled();
    });

    it('leaves every control enabled for the operator', async () => {
        mockConfigured(true);
        renderPage();

        await openSection('general');
        expect(await screen.findByText('Save Settings')).toBeEnabled();

        await openSection('tracks');
        expect(await screen.findByLabelText('Lane 1 works')).toBeEnabled();

        await openSection('backup');
        expect(await screen.findByText('Download a backup')).toBeEnabled();
    });
});
