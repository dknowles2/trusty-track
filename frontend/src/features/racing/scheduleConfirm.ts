/**
 * Text and detection for the Schedule tab's two round-level confirmations
 * (#939) — `handleDeleteHeat` in `RaceControl.tsx` already went through
 * `showConfirm` before it acted; Delete Round and Regenerate did not, and
 * this is what brings them up to the same bar. Pure, in the
 * `roundCompletion.ts`/`raceCompletion.ts` tradition: the rule that decides
 * *whether* to ask and *what* to say lives here, and `RaceControl.tsx` only
 * calls `showConfirm` with what this returns.
 */

/** The two fields a round-level confirmation needs off each of a round's heats. */
export interface RoundHeatIdentity {
  readonly id: number;
  readonly heatNumber: number;
}

/**
 * Delete Round always asks. The backend already refuses a round holding a
 * result (`crud.delete_round`), so what is at stake is always the same
 * shape — an unraced round that may still hold a hand-picked championship
 * field, a drag-reordered running order, or a place in an applied master
 * running order — and `heatCount` is read off the heats actually loaded for
 * this round rather than assumed.
 */
export function deleteRoundConfirmMessage(roundName: string, heatCount: number): string {
  const heatsPhrase = heatCount === 1 ? 'Its 1 heat has' : `Its ${heatCount} heats have`;
  return `Delete ${roundName}? ${heatsPhrase} not been run. This cannot be undone.`;
}

/** Regenerate's own wording, used whenever {@link regenerateWouldDiscardChanges} says to ask. */
export function regenerateRoundConfirmMessage(roundName: string): string {
  return `Regenerate ${roundName}? The current running order, including any heats you dragged, will be replaced.`;
}

/**
 * Whether regenerating this round would discard something the operator did
 * on purpose, so the confirmation can be skipped when it would not.
 *
 * Two things are unconditionally "something to lose": a hand-picked
 * championship field (`fieldPinned` — regenerating hands the round back to
 * the standings silently, the same loss `handleUnpinRoundField` already
 * confirms before it acts) and a race running the master running order
 * (#549) — regenerate rebuilds the round with fresh 1..N numbering outside
 * `repairMasterRunningOrder`'s two hooks (`admit_late_racers` and
 * `apply_outages_to_scheduled_heats`), so an applied interleave is not
 * preserved.
 *
 * Otherwise, a round's heats are inserted in generation order, so their
 * `id`s ascend in that same order; `reorderHeats` renumbers `heatNumber`
 * 1..N for the round without touching `id`, so a drag shows up as
 * `heatNumber` no longer rising once the heats are read back in `id` order.
 * That is the one signal available to the client for "was this dragged" —
 * if it is ever wrong the safe direction is to ask, not to skip asking, so
 * this only ever returns `false` when it can show its work: a round with no
 * heats loaded yet is treated as "may have something to lose".
 */
export function regenerateWouldDiscardChanges(
  roundHeats: readonly RoundHeatIdentity[],
  fieldPinned: boolean,
  masterRunningOrder: boolean
): boolean {
  if (fieldPinned || masterRunningOrder) return true;
  if (roundHeats.length === 0) return true;
  const byId = [...roundHeats].sort((a, b) => a.id - b.id);
  return byId.some((heat, i) => i > 0 && heat.heatNumber <= byId[i - 1].heatNumber);
}
