/**
 * Which picture a lane shows: the racer's own portrait, or the car photo
 * (#1075).
 *
 * #608 settled that Race Execution's current-heat card and its On Deck panel
 * show "the same kind of picture" — they used to disagree, one showing faces
 * and the other cars — and picked faces, reasoning that a face is what the
 * person calling racers to the start line needs. That reasoning describes an
 * announcer. The operator running this screen between heats is pulling cars
 * out of parc fermé and putting each one in the right lane, a job done by
 * comparing what is in their hand against a picture of a car, not a child.
 *
 * So: a toggle, not a fixed answer — the same per-device shape the finish
 * chime and the sound effects settings already use, because the announcer's
 * tablet and the operator's laptop legitimately want different answers on
 * the same race. #608's own rule survives unchanged: both panels still show
 * the same kind of picture, this only moves what that kind is.
 */

export type LanePhotoPreference = 'car' | 'portrait';

/** What `pickLanePhoto` resolved to for one lane. */
export type LanePhotoKind = 'car' | 'portrait' | 'initials';

const STORAGE_KEY = 'trustytrack.lanePhoto';

/** Car by default: the operator staging heats is this screen's main reader. */
const DEFAULT_PREFERENCE: LanePhotoPreference = 'car';

export function readLanePhotoPreference(
    storage: Pick<Storage, 'getItem'> = window.localStorage,
): LanePhotoPreference {
    try {
        return storage.getItem(STORAGE_KEY) === 'portrait' ? 'portrait' : DEFAULT_PREFERENCE;
    } catch {
        return DEFAULT_PREFERENCE;
    }
}

export function writeLanePhotoPreference(
    storage: Pick<Storage, 'setItem'> = window.localStorage,
    preference: LanePhotoPreference,
): void {
    try {
        storage.setItem(STORAGE_KEY, preference);
    } catch {
        // Per-device convenience only; losing a write costs a default, not a race.
    }
}

/**
 * Which picture actually shows for one lane, given what is on file.
 *
 * The operator should never see an empty circle where a picture would help,
 * so each preference falls back to the *other* picture before falling back
 * to initials. There is no third state beyond these three — the old
 * gold car-number roundel #608 removed does not come back here either.
 */
export function pickLanePhoto(
    preference: LanePhotoPreference,
    photos: { racerImageUrl?: string | null; carImageUrl?: string | null },
): LanePhotoKind {
    const hasCar = !!photos.carImageUrl;
    const hasPortrait = !!photos.racerImageUrl;
    if (preference === 'car') {
        if (hasCar) return 'car';
        if (hasPortrait) return 'portrait';
        return 'initials';
    }
    if (hasPortrait) return 'portrait';
    if (hasCar) return 'car';
    return 'initials';
}

/**
 * Whether a resolved kind is the car photo — kept here, in the pure module,
 * rather than as a `kind === 'car'` literal in `LaneAvatar.tsx`. That literal
 * would sit inside `terminologyGuard.test.ts`'s `>...<` scan the same way
 * `PrintDecor.tsx`'s artwork-key map does (see that file's allowlist entry):
 * a `.tsx` component's own TypeScript, not JSX text an operator ever reads,
 * bridged into scope by the scanner's generic-closing-`>` heuristic. Calling
 * this instead keeps the string literal out of the `.tsx` file entirely.
 */
export function isCarPhoto(kind: LanePhotoKind): boolean {
    return kind === 'car';
}
