/**
 * The frontend mirror of `crud.resolve_championship_source_for_race` (#1054)
 * — the part the "Add Round" dialog needs to know *before* submitting, so it
 * can offer a working option rather than the literal "Overall"/"Each
 * <group>" a race whose only qualifying round is Elimination can never fill.
 *
 * The backend rewrites `"ALL"`/`"EACH_GROUP"` on the way in regardless of
 * what the client sends (belt and braces), so this module's job is not
 * correctness — it is telling `RoundConfigModal` what to *offer*, and
 * letting it send the explicit `ROUND:<id>` up front so a stale client still
 * gets the right round without waiting on a server rewrite it cannot see.
 */

import type { Round } from './types';

type RoundShape = Pick<Round, 'id' | 'advancementSource' | 'schedulingStrategy'>;

/**
 * The id of this race's sole qualifying (general) round, when that round is
 * an Elimination round and no other general round exists to feed the
 * aggregate standings instead.
 *
 * `null` covers every other shape: no general round yet, a General or Balanced
 * general round (both feed the aggregate standings — Balanced deliberately,
 * see `.claude/rules/scheduling.md`'s "Balanced racing"), or a mixed race (a
 * General round alongside an Elimination one, say) — in every one of those,
 * "Overall"/"Each <group>" already has real candidates and the picker
 * offers them unchanged. This mirrors the backend's own "leave ALL alone
 * for a mixed race" decision exactly, so the two never disagree about when
 * the rewrite applies.
 */
export function soleEliminationRoundId(rounds: readonly RoundShape[]): number | null {
  const generalRounds = rounds.filter((round) => round.advancementSource == null);
  if (generalRounds.length !== 1) return null;
  const [only] = generalRounds;
  return only.schedulingStrategy === 'ELIMINATION' ? only.id : null;
}
