/**
 * Cub Scout ranks, in the words a pack uses for them.
 *
 * The stored values are the API's (`LION`, `ARROW_OF_LIGHT`), and the racingGroup
 * list was showing them as they are stored — "(ARROW_OF_LIGHT)" beside a racingGroup
 * called Arrow of Light. Enum values stay technical; only their display text
 * changes, which is the rule the whole app's wording follows.
 *
 * One list, read by the pickers and by anything showing a saved rank, so the
 * two cannot disagree — the pickers already spelt these properly and the
 * display did not.
 */

export interface RankOption {
    /** What is stored and sent. */
    value: string;
    /** What a person reads. */
    label: string;
}

/** In the order a Cub Scout meets them, which is how a pack lists its racingGroups. */
export const RANKS: readonly RankOption[] = [
    { value: 'LION', label: 'Lion' },
    { value: 'TIGER', label: 'Tiger' },
    { value: 'WOLF', label: 'Wolf' },
    { value: 'BEAR', label: 'Bear' },
    { value: 'WEBELOS', label: 'Webelos' },
    { value: 'ARROW_OF_LIGHT', label: 'Arrow of Light' },
    { value: 'OTHER', label: 'Other' },
];

/**
 * What to call a stored rank.
 *
 * An unknown value is tidied rather than passed through: a rank added to the
 * backend before this list hears about it should read as words, not as an
 * enum. Nothing is a blank, since a racingGroup without a rank has nothing to say.
 */
export function rankLabel(rank?: string | null): string {
    if (!rank) return '';
    const known = RANKS.find((option) => option.value === rank);
    if (known) return known.label;
    return rank
        .toLowerCase()
        .split('_')
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
        .join(' ');
}
