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
    vehicleArtworkKey: 'car',
} as const;

/**
 * The whole vehicle-artwork picker vocabulary (#551, stage 4), mirroring
 * `backend/domain/terminology.py`'s `VEHICLE_ARTWORK_KEYS` exactly — a car
 * (the built-in default), a rocket for a Space Derby, a boat for a
 * Raingutter Regatta. The System Settings terminology section and the
 * per-race override in `RaceForm` both build their `<select>` from this
 * list, so a fourth vehicle only ever needs adding here and to
 * `PrintDecor.tsx`'s `VehicleGlyph`.
 */
export const VEHICLE_ARTWORK_OPTIONS: readonly { value: string; label: string }[] = [
    { value: 'car', label: 'Car' },
    { value: 'rocket', label: 'Rocket' },
    { value: 'boat', label: 'Boat' },
];
