/**
 * The photos, between heats (#175).
 *
 * Check-in collects a headshot and a picture of the car for every racer, and
 * they appeared on screen only while that racer was in the heat — a few
 * seconds each, once per round. Most of an event is the gaps.
 *
 * The audience is mostly families looking for their own child, and that single
 * fact decides almost everything here.
 */

export interface SlideshowRacer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
    carName?: string | null;
    racingGroupId?: number | null;
    racerImageUrl?: string | null;
    carImageUrl?: string | null;
}

export interface Slide {
    racerId: number;
    name: string;
    carNumber: number | null;
    carName: string | null;
    racingGroupName: string | null;
    racingGroupColor: string | null;
    racerImageUrl: string | null;
    carImageUrl: string | null;
}

export interface SlideshowRacingGroup {
    id: number;
    name: string;
    color?: string | null;
}

/** A racer with no photograph at all has nothing to show. */
export function hasAPhoto(racer: SlideshowRacer): boolean {
    return Boolean(racer.racerImageUrl || racer.carImageUrl);
}

/**
 * Who is in the slideshow, and in what order.
 *
 * **By car number, not shuffled.** A random order looks livelier and is worse:
 * a family watching for their own child has no idea whether they have missed
 * them or are about to see them, and with sixty racers a shuffle can leave one
 * child out for a very long time. A fixed rotation means everybody appears
 * once per cycle and the wait is bounded and obvious.
 *
 * Racers with no photograph are left out entirely rather than shown as a blank
 * card. An empty slide on a projector reads as the app being broken, and the
 * child it belongs to gets nothing out of it either way.
 */
export function slidesFor(
    racers: readonly SlideshowRacer[],
    racingGroups: readonly SlideshowRacingGroup[],
): Slide[] {
    const racingGroupById = new Map(racingGroups.map((racingGroup) => [racingGroup.id, racingGroup]));
    return racers
        .filter(hasAPhoto)
        .slice()
        .sort((a, b) => {
            // Unnumbered cars last, then by name, so the order is total and
            // does not depend on however the API happened to return them.
            const an = a.carNumber ?? Number.MAX_SAFE_INTEGER;
            const bn = b.carNumber ?? Number.MAX_SAFE_INTEGER;
            if (an !== bn) return an - bn;
            return `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`);
        })
        .map((racer) => {
            const racingGroup = racer.racingGroupId == null ? undefined : racingGroupById.get(racer.racingGroupId);
            return {
                racerId: racer.id,
                name: `${racer.firstName} ${racer.lastName}`.trim(),
                carNumber: racer.carNumber ?? null,
                carName: racer.carName ?? null,
                racingGroupName: racingGroup?.name ?? null,
                racingGroupColor: racingGroup?.color ?? null,
                racerImageUrl: racer.racerImageUrl ?? null,
                carImageUrl: racer.carImageUrl ?? null,
            };
        });
}

/**
 * The next index, wrapping.
 *
 * Wraps rather than stopping, which is the opposite of the awards ceremony —
 * and for the opposite reason. The ceremony ends on the trophy people
 * photograph; this runs unattended for an afternoon and stopping would leave a
 * screen frozen on whoever happens to be last.
 */
export function nextIndex(current: number, count: number): number {
    if (count <= 0) return 0;
    return (current + 1) % count;
}

/**
 * Keep an index inside a list that has changed underneath it.
 *
 * The roster moves during an event: a photo is uploaded at the desk mid-round
 * and that racer joins the rotation. Clamping rather than resetting to zero
 * matters — a slideshow that jumped back to the first child every time
 * somebody was checked in would never reach the end of a sixty-strong pack.
 */
export function clampIndex(index: number, count: number): number {
    if (count <= 0) return 0;
    return Math.min(Math.max(index, 0), count - 1);
}

/** What a screen with nothing to show should say. */
export const NOTHING_TO_SHOW =
    'No photos yet — add racer or car photos at check-in and they will appear here.';
