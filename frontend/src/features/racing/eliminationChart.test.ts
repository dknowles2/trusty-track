import { describe, it, expect } from 'vitest';
import { describeChart, displayOrder, isUpcoming, laneMark, lossPips, waveTitle } from './eliminationChart';
import type { EliminationChart, EliminationChartHeat, EliminationChartLane, EliminationWave } from './types';

const lane = (
  laneNumber: number,
  racerId: number,
  outcome: EliminationChartLane['outcome'],
  lossesAfter = 0,
  out = false,
): EliminationChartLane => ({ lane: laneNumber, racerId, outcome, lossesAfter, out });

const heat = (heatId: number, finished: boolean, lanes: EliminationChartLane[]): EliminationChartHeat => ({
  heatId,
  heatNumber: heatId,
  finished,
  lanes,
});

const wave = (number: number, heats: EliminationChartHeat[]): EliminationWave => ({ number, heats });

describe('isUpcoming', () => {
  it('is the wave none of whose heats has run', () => {
    expect(isUpcoming(wave(2, [heat(3, false, [])]))).toBe(true);
    expect(isUpcoming(wave(1, [heat(1, true, []), heat(2, false, [])]))).toBe(false);
  });

  it('an empty wave is not upcoming', () => {
    expect(isUpcoming(wave(1, []))).toBe(false);
  });
});

describe('displayOrder', () => {
  it('lists the winner first once the heat has run', () => {
    const run = heat(1, true, [lane(1, 7, 'LOST', 1), lane(2, 8, 'SKIPPED'), lane(3, 9, 'WON')]);
    expect(displayOrder(run).map((l) => l.racerId)).toEqual([9, 7, 8]);
  });

  it('keeps lane order for a heat yet to run', () => {
    const pending = heat(1, false, [lane(3, 9, null), lane(1, 7, null), lane(2, 8, null)]);
    expect(displayOrder(pending).map((l) => l.lane)).toEqual([1, 2, 3]);
  });
});

describe('lossPips', () => {
  it('fills used losses and leaves the rest hollow', () => {
    expect(lossPips(0, 3)).toBe('○○○');
    expect(lossPips(2, 3)).toBe('●●○');
    expect(lossPips(3, 3)).toBe('●●●');
  });

  it('never draws past the limit', () => {
    expect(lossPips(5, 3)).toBe('●●●');
  });
});

describe('laneMark', () => {
  it('says nothing for a heat yet to run', () => {
    expect(laneMark(lane(1, 7, null), 3)).toBe('');
  });

  it('names the outcome', () => {
    expect(laneMark(lane(1, 7, 'WON'), 3)).toBe('Won');
    expect(laneMark(lane(1, 7, 'LOST', 1), 3)).toBe('Loss 1 of 3');
    expect(laneMark(lane(1, 7, 'SKIPPED'), 3)).toBe('Skipped');
  });

  it('reaching the limit is the news', () => {
    expect(laneMark(lane(1, 7, 'LOST', 3, true), 3)).toBe('Out');
  });
});

describe('waveTitle', () => {
  it('marks the pending set', () => {
    expect(waveTitle(wave(1, [heat(1, true, [])]))).toBe('Set 1');
    expect(waveTitle(wave(2, [heat(2, false, [])]))).toBe('Set 2 · up next');
  });
});

describe('describeChart', () => {
  const chart = (decided: boolean, waves: EliminationWave[], alive: number, out: number): EliminationChart => ({
    maxLosses: 2,
    decided,
    waves,
    standings: [
      ...Array.from({ length: alive }, (_, i) => ({ racerId: i + 1, losses: 0, alive: true })),
      ...Array.from({ length: out }, (_, i) => ({ racerId: 100 + i, losses: 2, alive: false })),
    ],
  });

  it('counts who is still racing while the round is open', () => {
    const open = chart(false, [wave(1, [heat(1, true, [])]), wave(2, [heat(2, false, [])])], 4, 2);
    expect(describeChart(open)).toBe('4 still racing · 2 out · 1 set raced');
  });

  it('says so once the round is decided', () => {
    const done = chart(true, [wave(1, [heat(1, true, [])]), wave(2, [heat(2, true, [])])], 1, 5);
    expect(describeChart(done)).toBe('Decided after 2 sets raced — 5 out');
  });
});
