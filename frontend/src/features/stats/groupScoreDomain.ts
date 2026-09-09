/**
 * Helper to compute an X-axis domain padded tightly around the racing group
 * average scores so small differences between groups are visually discernible (#893).
 */

export interface GroupScoreInput {
  avgScore: number | null;
}

export function groupScoreDomain<T extends GroupScoreInput>(stats: T[]): [number, number] | [number, 'auto'] {
  const scores = stats
    .map(s => s.avgScore)
    .filter((s): s is number => s != null && !isNaN(s) && s > 0);
  if (scores.length === 0) return [0, 'auto'];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const pad = Math.max(0.1, (max - min) * 0.15);
  const dMin = Math.max(0, Math.floor((min - pad) * 10) / 10);
  const dMax = Math.ceil((max + pad) * 10) / 10;
  return [dMin, dMax];
}
