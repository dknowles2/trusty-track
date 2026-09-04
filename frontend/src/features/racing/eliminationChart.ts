/**
 * Reading an elimination round's chart (#710) — pure, no React.
 *
 * The chart itself comes from the server (`Round.eliminationChart`, drawn by
 * `domain/elimination.chart` from the same loss rule that grows the next
 * wave), so nothing here decides who won or who is out. What is left is how
 * the schedule screen *says* it: the order lanes are listed in, the pips
 * beside a name, the one-line summary above the columns, and which wave is
 * the pending one.
 *
 * Why this is not a bracket, stated once: a bracket draws matchups that have
 * not happened yet, and ladderless elimination refuses to — the next set is
 * drawn from the loss counts once the current one has run. So the chart
 * shows the sets raced, the pending set (real rows, not a guess), and who is
 * still standing, and stops there.
 */
import type { EliminationChart, EliminationChartHeat, EliminationChartLane, EliminationWave } from './types';

/** A wave none of whose heats has run — the pending set. */
export const isUpcoming = (wave: EliminationWave): boolean =>
  wave.heats.length > 0 && wave.heats.every((heat) => !heat.finished);

const OUTCOME_ORDER: Record<string, number> = { WON: 0, LOST: 1, SKIPPED: 2 };

/**
 * Lanes as the chart lists them: the winner first once a heat has run, then
 * the losers, then anything skipped; a heat yet to run stays in lane order,
 * since that is the order the wrangler stages it in.
 */
export const displayOrder = (heat: EliminationChartHeat): EliminationChartLane[] => {
  const lanes = [...heat.lanes].sort((a, b) => a.lane - b.lane);
  if (!heat.finished) return lanes;
  return lanes.sort(
    (a, b) => (OUTCOME_ORDER[a.outcome ?? ''] ?? 3) - (OUTCOME_ORDER[b.outcome ?? ''] ?? 3),
  );
};

/** "●●○" — losses used against the limit. */
export const lossPips = (losses: number, maxLosses: number): string => {
  const used = Math.min(Math.max(losses, 0), maxLosses);
  return '●'.repeat(used) + '○'.repeat(maxLosses - used);
};

/**
 * What to print beside a lane: nothing for a heat yet to run, and for one
 * that has, the outcome in words a volunteer already uses. `Out` wins over
 * `Loss` because reaching the limit is the news.
 */
export const laneMark = (lane: EliminationChartLane, maxLosses: number): string => {
  if (lane.outcome === null) return '';
  if (lane.outcome === 'WON') return 'Won';
  if (lane.outcome === 'SKIPPED') return 'Skipped';
  if (lane.out) return 'Out';
  return `Loss ${lane.lossesAfter} of ${maxLosses}`;
};

/** "Set 2" — or "Set 2 · up next" for the pending one. */
export const waveTitle = (wave: EliminationWave): string =>
  isUpcoming(wave) ? `Set ${wave.number} · up next` : `Set ${wave.number}`;

/**
 * The line above the columns. Counts come from the standings the server
 * already filtered to who is still checked in, so a withdrawn racer is not
 * counted as still racing.
 */
export const describeChart = (chart: EliminationChart): string => {
  const alive = chart.standings.filter((entry) => entry.alive).length;
  const out = chart.standings.length - alive;
  const raced = chart.waves.filter((wave) => !isUpcoming(wave)).length;
  const sets = `${raced} ${raced === 1 ? 'set' : 'sets'} raced`;
  if (chart.decided) {
    return `Decided after ${sets} — ${out} out`;
  }
  return `${alive} still racing · ${out} out · ${sets}`;
};
