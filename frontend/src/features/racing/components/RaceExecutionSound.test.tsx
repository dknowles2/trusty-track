import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useMutation: vi.fn(), useSubscription: vi.fn() };
});

import { useMutation, useSubscription } from 'urql';
import { RaceExecution, type Heat } from './RaceExecution';
import { AlertProvider } from '../../../context/AlertContext';
import { lane } from '../testFixtures';
import * as soundModule from '../../audio/soundEffects';

describe('RaceExecution sound effect transitions (#554)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn().mockResolvedValue({ data: {} })]);
    });

    const activeHeat: Heat = {
        id: 1,
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        roundName: 'Round 1',
        recordedAt: null,
        lanes: [
            lane({ lane: 1, racerId: 101 }),
            lane({ lane: 2, racerId: 102 }),
        ],
    };

    const racers = {
        101: { id: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racerImageUrl: null, carImageUrl: null, carPassedInspection: true },
        102: { id: 102, firstName: 'Jane', lastName: 'Smith', carNumber: 2, racerImageUrl: null, carImageUrl: null, carPassedInspection: true },
    };

    const props = {
        raceId: 1,
        activeExecutionHeat: activeHeat,
        nextExecutionHeat: null,
        upcomingHeats: [],
        activeHeatId: null,
        onRunHeat: vi.fn(),
        onNextHeat: vi.fn(),
        getRacerName: (id: number) => racers[id as keyof typeof racers]?.firstName ?? '',
        slowestRoundIds: new Set<number>(),
        onUpdateResult: vi.fn(),
        scoringStrategy: 'TIMED' as const,
        timerType: 'FAKE',
        trackId: 1,
        laneColors: [],
        racers,
        roundSummary: null,
        autoAdvanceHeat: false,
    };

    it('plays gate release sound when phase changes to RUNNING with gate release enabled', () => {
        const startSpy = vi.spyOn(soundModule, 'playGateReleaseSound').mockImplementation(() => {});
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: true,
            gateRelease: true,
        });

        // Start at WAITING
        let currentPhase = 'WAITING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);
        expect(startSpy).not.toHaveBeenCalled();

        // Transition to RUNNING
        currentPhase = 'RUNNING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);
        expect(startSpy).toHaveBeenCalled();
    });

    it('plays staging sound when phase changes to WAITING from NOT_READY with staging enabled', () => {
        const stagingSpy = vi.spyOn(soundModule, 'playStagingReadySound').mockImplementation(() => {});
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: true,
            stagingReady: true,
        });

        // Start at NOT_READY
        let currentPhase = 'NOT_READY';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);
        expect(stagingSpy).not.toHaveBeenCalled();

        // Transition to WAITING
        currentPhase = 'WAITING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);
        expect(stagingSpy).toHaveBeenCalled();
    });

    it('plays staging sound when the next heat is staged from a recorded one (#872)', () => {
        // This is the transition that actually happens at the gate on race
        // day — advancing to the next heat by button, Space, or
        // auto-advance — which an earlier version of `shouldStagingReadySound`
        // excluded, so the sound the settings page advertises as "armed at
        // the gate" fired at most once per round.
        const stagingSpy = vi.spyOn(soundModule, 'playStagingReadySound').mockImplementation(() => {});
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: true,
            stagingReady: true,
        });

        let currentPhase = 'RECORDED';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);
        expect(stagingSpy).not.toHaveBeenCalled();

        currentPhase = 'WAITING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);
        expect(stagingSpy).toHaveBeenCalled();
    });

    it('does not play sounds when sound master toggle is off', () => {
        const startSpy = vi.spyOn(soundModule, 'playGateReleaseSound').mockImplementation(() => {});
        const stagingSpy = vi.spyOn(soundModule, 'playStagingReadySound').mockImplementation(() => {});
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: false,
        });

        let currentPhase = 'WAITING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        currentPhase = 'RUNNING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        expect(startSpy).not.toHaveBeenCalled();
        expect(stagingSpy).not.toHaveBeenCalled();
    });

    it('ticking finish sound only toggles finish and does not switch master sound on (#871)', () => {
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: false,
            finish: false,
            gateRelease: true,
        });

        render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        const toggle = screen.getByTestId('finish-chime-toggle');
        expect(toggle).not.toBeChecked();

        fireEvent.click(toggle);
        expect(toggle).toBeChecked();

        const stored = soundModule.readSoundSettings(window.localStorage);
        expect(stored.finish).toBe(true);
        expect(stored.master).toBe(false);
        expect(window.localStorage.getItem(soundModule.FINISH_CHIME_STORAGE_KEY)).toBe('on');
    });

    it('unticking finish sound does not leave master on (#871)', () => {
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: false,
            finish: true,
        });

        render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        const toggle = screen.getByTestId('finish-chime-toggle');
        expect(toggle).toBeChecked();

        fireEvent.click(toggle);
        expect(toggle).not.toBeChecked();

        const stored = soundModule.readSoundSettings(window.localStorage);
        expect(stored.finish).toBe(false);
        expect(stored.master).toBe(false);
        expect(window.localStorage.getItem(soundModule.FINISH_CHIME_STORAGE_KEY)).toBe('off');
    });

    it('ticking finish sound does not silently enable gate release horn (#871)', () => {
        const startSpy = vi.spyOn(soundModule, 'playGateReleaseSound').mockImplementation(() => {});
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: false,
            finish: false,
            gateRelease: true,
        });

        let currentPhase = 'WAITING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        // Operator ticks finish sound
        fireEvent.click(screen.getByTestId('finish-chime-toggle'));

        // Gate drops: WAITING -> RUNNING
        currentPhase = 'RUNNING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        // Gate release horn must NOT have sounded
        expect(startSpy).not.toHaveBeenCalled();
    });
});
