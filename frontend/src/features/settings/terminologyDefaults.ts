/**
 * The built-in Scouting words, mirrored from `backend/domain/terminology.py`'s
 * `DEFAULT_TERMINOLOGY` (#496 stage 3).
 *
 * Used only to seed the settings form and the race edit form when an operator
 * turns on a custom term, so the four inputs never start out empty and
 * required. The resolved value shown anywhere else always comes from the
 * server's `terminology` field — nothing here is a second copy of the
 * layering rule, only of the words themselves.
 */
export const DEFAULT_TERMINOLOGY = {
    racingGroupSingular: 'Den',
    racingGroupPlural: 'Dens',
    organizationSingular: 'Pack',
    organizationPlural: 'Packs',
    vehicleSingular: 'Car',
    vehiclePlural: 'Cars',
} as const;
