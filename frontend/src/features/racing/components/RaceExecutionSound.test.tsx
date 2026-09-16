import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useMutation: vi.fn(), useSubscription: vi.fn() };
});

// IntermissionControl now mounts inside RaceExecution (#940) and calls
// `useQuery`, which this file's urql mock above does not stub — its own
// suite is IntermissionControl.test.tsx, so it is a plain marker here.
vi.mock('./IntermissionControl', () => ({
    default: () => <div data-testid="intermission-control-stub" />,
}));

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

    // #1074: the standalone "Finish sound" checkbox is gone, and Sound
    // options — via `master` — is the one gate left for everything it used
    // to bypass. The three tests this replaced (#871) each protected the
    // checkbox's own independence from `master`; that guarantee now lives
    // entirely in `SoundSettingsSection`'s own suite, since the panel is the
    // only place left that can touch either flag.
    it('plays the finish sound on the RECORDED edge once master and finish are both on', () => {
        const finishSpy = vi.spyOn(soundModule, 'playFinishSound').mockImplementation(() => {});
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: true,
            finish: true,
        });

        let currentPhase = 'RUNNING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);
        expect(finishSpy).not.toHaveBeenCalled();

        currentPhase = 'RECORDED';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);
        expect(finishSpy).toHaveBeenCalled();
    });

    it('there is no standalone finish-sound checkbox left in the header (#1074)', () => {
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: true,
            finish: true,
        });

        render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        expect(screen.queryByTestId('finish-chime-toggle')).not.toBeInTheDocument();
    });

    it('opening Sound options reaches the same Heat Finish row the removed checkbox duplicated', () => {
        render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        // Sound options sits behind the ⚙ preferences popover now (#1157).
        fireEvent.click(screen.getByTestId('race-execution-preferences-trigger'));
        fireEvent.click(screen.getByTestId('sound-effects-modal-trigger'));
        fireEvent.click(screen.getByTestId('sound-master-toggle'));

        expect(screen.getByTestId('sound-effect-finish')).toBeChecked();
    });

    // The migration decision (#1074): rather than a one-time promotion of
    // stored settings — which cannot be told apart from an operator who
    // deliberately turned `master` off after trying it, since both leave
    // identical values behind — `RaceExecution` keeps reading the legacy
    // `trustytrack.finishChime` flag as a fallback exactly as it did before
    // this change (`.claude/rules/race-day-ui.md`'s "the two systems are
    // deliberately independent"). Nothing in this component writes that flag
    // any more; it is preserved read-only so a device that had the removed
    // checkbox on keeps chiming without the operator visiting Sound options.
    it('keeps chiming through the legacy flag on a device that had the removed checkbox on, with master off', () => {
        window.localStorage.setItem(soundModule.FINISH_CHIME_STORAGE_KEY, 'on');
        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: false,
        });

        const finishSpy = vi.spyOn(soundModule, 'playFinishSound').mockImplementation(() => {});
        let currentPhase = 'RUNNING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        currentPhase = 'RECORDED';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);
        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        expect(finishSpy).toHaveBeenCalled();
        // Read-only: this component must not have touched `master`.
        expect(soundModule.readSoundSettings(window.localStorage).master).toBe(false);
    });

    it('a device that never had the legacy flag on stays silent with master off', () => {
        // A fresh device: nothing written to either the legacy flag or the
        // effects settings at all, which is the state `beforeEach`'s
        // `localStorage.clear()` already leaves — spelled out here rather
        // than relying on that alone, since the point of this test is what
        // is *absent*, not what was set.
        expect(window.localStorage.getItem(soundModule.FINISH_CHIME_STORAGE_KEY)).toBeNull();

        const finishSpy = vi.spyOn(soundModule, 'playFinishSound').mockImplementation(() => {});
        let currentPhase = 'RUNNING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        currentPhase = 'RECORDED';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);
        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        expect(finishSpy).not.toHaveBeenCalled();
    });

    // The PR review's exact reproduction: turning `master` on and back off
    // through the real panel, never touching "Heat Finish", used to leave
    // the legacy flag `'on'` (writeSoundSettings re-synced it to `finish`,
    // which defaults `true`, on every write — a `master`-only one included)
    // and this component's own master-off fallback kept chiming despite the
    // operator's explicit "turn it off". `writeSoundSettings` no longer
    // touches the legacy flag at all, so the fallback has nothing left to
    // misread.
    it('stays silent after turning master on and back off through the panel, without touching Heat Finish (#871 reproduction)', () => {
        const finishSpy = vi.spyOn(soundModule, 'playFinishSound').mockImplementation(() => {});

        let currentPhase = 'WAITING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);

        const { rerender } = render(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        // Sound options sits behind the ⚙ preferences popover now (#1157).
        fireEvent.click(screen.getByTestId('race-execution-preferences-trigger'));
        fireEvent.click(screen.getByTestId('sound-effects-modal-trigger'));
        const masterToggle = screen.getByTestId('sound-master-toggle');
        fireEvent.click(masterToggle); // on
        fireEvent.click(masterToggle); // back off — "Heat Finish" never touched
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        // The bug's own precondition: the legacy flag must not have been
        // dragged along by a `master`-only write.
        expect(window.localStorage.getItem(soundModule.FINISH_CHIME_STORAGE_KEY)).toBeNull();
        expect(soundModule.readSoundSettings(window.localStorage).master).toBe(false);

        currentPhase = 'RUNNING';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);
        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        currentPhase = 'RECORDED';
        (useSubscription as any).mockImplementation(() => [{
            data: { heatSession: { trackId: 1, heatId: 1, phase: currentPhase, lanes: [] } },
        }]);
        rerender(<AlertProvider><RaceExecution {...props} /></AlertProvider>);

        expect(finishSpy).not.toHaveBeenCalled();
    });
});
