import '../../../setupTests';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import Observation from './Observation';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useSubscription } from 'urql';
import {
    LeaderboardSubscription,
    OnDeckSubscription,
    CurrentlyRacingSubscription,
    TimingStatsSubscription,
    ActiveFreeRaceHeatSubscription,
} from '../graphql/queries';
import { TIMER_STATUS_SUBSCRIPTION } from '../../racing/graphql/queries';
import * as soundModule from '../../audio/soundEffects';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(),
    };
});

describe('Observation sound effects (#554)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    const mockRacersData = {
        race: {
            id: 1,
            racers: [
                { id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: null },
            ],
        },
    };

    it('plays recordBreak sound when a new heat result sets a track record', () => {
        const recordBreakSpy = vi.spyOn(soundModule, 'playRecordBreakSound').mockImplementation(() => {});
        const finishSpy = vi.spyOn(soundModule, 'playFinishSound').mockImplementation(() => {});

        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: true,
            recordBreak: true,
            finish: true,
        });

        let timingStats: any = {
            heatId: 1,
            recordedAt: '2026-01-01T00:00:00Z',
            roundName: 'Round 1',
            heatNumber: 1,
            lanes: [{ laneNumber: 1, racerName: 'Speedy', carName: '95', time: 2.9, place: 1, racerImageUrl: null }],
            recordBreak: { newSeconds: 2.9, newHolder: 'Speedy', previousSeconds: 3.0, previousHolder: 'Doc' },
        };

        (useQuery as any).mockReturnValue([{ data: mockRacersData, fetching: false, error: null }]);
        (useSubscription as any).mockImplementation(({ query }: { query: any }) => {
            if (query === LeaderboardSubscription) return [{ data: { leaderboard: [] } }];
            if (query === OnDeckSubscription) return [{ data: { onDeck: [] } }];
            if (query === CurrentlyRacingSubscription) return [{ data: { currentlyRacing: null } }];
            if (query === TimingStatsSubscription) return [{ data: { timingStats } }];
            if (query === ActiveFreeRaceHeatSubscription) return [{ data: { activeFreeRaceHeat: null } }];
            if (query === TIMER_STATUS_SUBSCRIPTION) return [{ data: { timerStatus: { status: { activeHeatId: null } } } }];
            return [{ data: null }];
        });

        const renderTree = () => (
            <MemoryRouter initialEntries={['/race/1/observation?projector=true']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        const { rerender } = render(renderTree());

        // First load is history: no sound
        expect(recordBreakSpy).not.toHaveBeenCalled();

        // Fresh result with recordBreak arrives
        timingStats = {
            ...timingStats,
            heatId: 2,
            recordedAt: '2026-01-01T00:05:00Z',
        };
        rerender(renderTree());

        expect(recordBreakSpy).toHaveBeenCalled();
        expect(finishSpy).not.toHaveBeenCalled();
    });

    it('plays finish sound when a new heat result arrives without recordBreak', () => {
        const recordBreakSpy = vi.spyOn(soundModule, 'playRecordBreakSound').mockImplementation(() => {});
        const finishSpy = vi.spyOn(soundModule, 'playFinishSound').mockImplementation(() => {});

        soundModule.writeSoundSettings(window.localStorage, {
            ...soundModule.DEFAULT_SOUND_SETTINGS,
            master: true,
            recordBreak: true,
            finish: true,
        });

        let timingStats: any = {
            heatId: 1,
            recordedAt: '2026-01-01T00:00:00Z',
            roundName: 'Round 1',
            heatNumber: 1,
            lanes: [{ laneNumber: 1, racerName: 'Speedy', carName: '95', time: 3.5, place: 1, racerImageUrl: null }],
            recordBreak: null,
        };

        (useQuery as any).mockReturnValue([{ data: mockRacersData, fetching: false, error: null }]);
        (useSubscription as any).mockImplementation(({ query }: { query: any }) => {
            if (query === LeaderboardSubscription) return [{ data: { leaderboard: [] } }];
            if (query === OnDeckSubscription) return [{ data: { onDeck: [] } }];
            if (query === CurrentlyRacingSubscription) return [{ data: { currentlyRacing: null } }];
            if (query === TimingStatsSubscription) return [{ data: { timingStats } }];
            if (query === ActiveFreeRaceHeatSubscription) return [{ data: { activeFreeRaceHeat: null } }];
            if (query === TIMER_STATUS_SUBSCRIPTION) return [{ data: { timerStatus: { status: { activeHeatId: null } } } }];
            return [{ data: null }];
        });

        const renderTree = () => (
            <MemoryRouter initialEntries={['/race/1/observation?projector=true']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        const { rerender } = render(renderTree());

        // First load is history
        expect(finishSpy).not.toHaveBeenCalled();

        // Fresh normal result
        timingStats = {
            ...timingStats,
            heatId: 2,
            recordedAt: '2026-01-01T00:05:00Z',
        };
        rerender(renderTree());

        expect(finishSpy).toHaveBeenCalled();
        expect(recordBreakSpy).not.toHaveBeenCalled();
    });
});
