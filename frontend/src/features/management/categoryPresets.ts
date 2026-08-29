/**
 * Traditional Cub Scout ranks, offered as picker *suggestions* for a racing
 * group's category (#496, stage 2) — not a constraint.
 *
 * `RacingGroup.division` is free text now, where it was a seven-value enum:
 * a school typing "3rd Grade" is exactly as valid as a pack picking "Wolf"
 * from this list. Choosing one just fills the ordinary text field in
 * `RacingGroupManager`, which stays editable (or clearable) afterward — the
 * same pattern `awardTemplates.ts` uses for ready-made superlative awards.
 *
 * There used to be a `rankLabel()` here too, translating a stored enum code
 * (`ARROW_OF_LIGHT`) into words a pack actually uses ("Arrow of Light"). It
 * is gone: the migration that dropped the enum carried every stored value to
 * the label it used to compute, so the stored text already *is* the label —
 * there is nothing left to translate.
 */

/** In the order a Cub Scout meets them, which is how a pack lists its racing groups. */
export const CATEGORY_PRESETS: readonly string[] = [
    'Lion',
    'Tiger',
    'Wolf',
    'Bear',
    'Webelos',
    'Arrow of Light',
    'Other',
];
