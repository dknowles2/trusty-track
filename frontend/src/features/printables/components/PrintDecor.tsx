/**
 * Original decoration for the printables.
 *
 * Same rule as `features/awards/artwork.tsx`, and for the same reason: the
 * venue has no internet, so every mark a printed page makes has to ship in
 * the bundle. Everything here is an inline `<svg>` drawn for this app, in the
 * Printables surface's own tokens — `--print-primary-color` and
 * `--print-accent-color` (issue #498's groundwork: this used to read
 * `--scouting-blue` / `--cub-scouting-gold` directly, which is the App
 * surface's tokens, not this surface's own) — so there is no licence to track
 * beside a committed binary and nothing to fetch when the operator hits Print
 * on a laptop that is off the network.
 *
 * All of it is `aria-hidden`, and none of it carries `role="img"`. That is
 * load-bearing rather than tidy: `Certificate.test.tsx` asserts that a
 * certificate with no award artwork contains no `svg[role="img"]`, which is
 * how it tells "this award has no picture" from "this award has one". Border
 * furniture is not a picture, and must not answer to that selector.
 *
 * The flat repeating things — the chequered flag band, the licence's security
 * wash, the certificate's engine-turning — are CSS gradients in
 * `PrintSheet.css` rather than SVG. A pit pass sheet is sixty cards, and sixty
 * copies of a `<pattern>` is sixty copies of the same `id` for the browser to
 * disambiguate. A gradient has no id.
 *
 * **Nothing here is scaled past about an inch.** Every shape below is drawn to
 * be read at the size of a footer glyph or a corner ornament, and blowing one
 * up to fill a page turns it into clip art — which is exactly what the
 * certificate's first draft did with the car silhouette. The certificate's
 * background is a gradient texture instead; see `.certificate` in the
 * stylesheet — and deliberately carries no vehicle glyph of its own kind for
 * the same reason (#551, stage 4): the guilloche texture replaced a giant
 * outlined car once already, and a rocket or boat blown up the same way would
 * repeat a mistake this file already made and un-made.
 *
 * `VehicleGlyph` (#551, stage 4) is the whole vehicle-artwork vocabulary — a
 * car (the built-in default), a rocket for a Space Derby, a boat for a
 * Raingutter Regatta — mirroring `domain.terminology.VEHICLE_ARTWORK_KEYS`
 * exactly, the same relationship `features/awards/artwork.tsx`'s `ARTWORK`
 * has with `backend/domain/awards.py`. An `artworkKey` this module does not
 * recognise renders nothing, the same "print blank rather than crash" rule
 * `AwardArtwork` and the heat sheet's deleted-racer case both follow — an
 * unrecognised key reaches an install only from a future build's data, or an
 * old install that never set one, and neither should crash the print run.
 */

import type { ReactElement } from 'react';

interface DecorProps {
    /** Square, in CSS pixels. */
    size?: number;
    className?: string;
}

const BLUE = 'var(--print-primary-color, #003F87)';
const GOLD = 'var(--print-accent-color, #FCD116)';

interface VehicleProps extends DecorProps {
    color?: string;
}

/**
 * The car, side on, nose to the right: a block of pine cut to a wedge — high
 * over the rear axle, sweeping down to a thin nose.
 *
 * The wedge *is* the icon, and getting there took throwing away two drafts. A
 * silhouette with a flat deck and a squared-off rear block reads as a pickup
 * truck at every size, however carefully the nose is tapered; what says
 * "pinewood derby" is the single unbroken slope from tail to nose. The slope
 * is slightly concave rather than straight because a straight one reads as a
 * doorstop.
 *
 * Drawn to be legible at a quarter of an inch — a pit pass footer — and no
 * larger than a masthead. It is a silhouette, so what detail there is lives in
 * the outline; anything inside it is a smudge at the size this is used.
 */
function Car({ size = 24, className, color = BLUE }: VehicleProps) {
    return (
        <svg
            width={size}
            height={size * 0.42}
            viewBox="0 0 120 50"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <path d="M10 34 L10 13 Q64 17 112 29 L114 31 L114 34 Z" fill={color} />
            {/* Wheels sit proud of the body, the way they do on the axle slots
                — outboard, not tucked into an arch. */}
            <circle cx="28" cy="34" r="8.5" fill={color} />
            <circle cx="94" cy="34" r="8.5" fill={color} />
            <circle cx="28" cy="34" r="3" fill="var(--print-surface-color)" />
            <circle cx="94" cy="34" r="3" fill="var(--print-surface-color)" />
        </svg>
    );
}

/**
 * A Space Derby rocket, side on, nose to the right — the same bounding box
 * and the same rightward motion as the car, so it drops into the same footer
 * row without the row's height changing.
 *
 * A rocket drawn nose-up is the more familiar pose, and was the first draft;
 * it read fine alone and wrong beside the car and the boat, tall where they
 * are wide, so a row mixing vehicle types (there is only ever one on a given
 * page, but the three are drawn to the same rule) would wobble. Lying it on
 * its side keeps the family looking like one family: a capsule body tapering
 * to a nose cone, fins swept back at the tail rather than a wedge, and the
 * same hub-cutout trick the car's wheels use — here a porthole — so the
 * three glyphs read as variations on one drawing style rather than three
 * unrelated pictures.
 */
function Rocket({ size = 24, className, color = BLUE }: VehicleProps) {
    return (
        <svg
            width={size}
            height={size * 0.42}
            viewBox="0 0 120 50"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            {/* Capsule body, blunt at the tail (left) and drawn out to a
                point at the nose (right) — the same leftward-blunt,
                rightward-sharp silhouette rule the car's wedge follows. */}
            <path
                d="M22 25 C22 15 31 9 47 9 L86 9 Q110 9 118 25 Q110 41 86 41 L47 41 C31 41 22 35 22 25 Z"
                fill={color}
            />
            {/* Tail fins, swept back rather than outboard like the car's
                wheels — a rocket has nothing touching the ground. */}
            <path d="M30 15 L10 3 L36 19 Z" fill={color} />
            <path d="M30 35 L10 47 L36 31 Z" fill={color} />
            <circle cx="62" cy="25" r="7.5" fill="var(--print-surface-color)" />
        </svg>
    );
}

/**
 * A Raingutter Regatta boat, side on, sailing to the right — a shallow hull
 * riding low in the water with a single triangular sail, the same rightward
 * motion and the same bounding box as the car and the rocket.
 *
 * The hull is a crescent rather than a flat-bottomed shape: a raingutter boat
 * is displacement-hulled and rides with its belly under the waterline, and a
 * flat bottom reads as a barge rather than a sailboat. One sail, not two — a
 * second sail is detail that survives a certificate and disappears at a
 * footer glyph's quarter-inch, the same "smudge at this size" rule the car's
 * silhouette follows for its wheel arches.
 */
function Boat({ size = 24, className, color = BLUE }: VehicleProps) {
    return (
        <svg
            width={size}
            height={size * 0.42}
            viewBox="0 0 120 50"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            {/* Hull: a flattish deck line bowed down into a shallow belly. */}
            <path
                d="M14 30 L106 30 C118 30 118 36 106 40 L28 40 C12 40 4 36 14 30 Z"
                fill={color}
            />
            {/* Mast and sail — a single right triangle leaning into the wind
                the boat is sailing with, nose to the right like its two
                siblings above. */}
            <rect x="58" y="6" width="3" height="25" fill={color} />
            <path d="M61 8 L61 29 L92 27 Z" fill={color} />
        </svg>
    );
}

/** Every vehicle-artwork key this build can draw, mirroring
 *  `domain.terminology.VEHICLE_ARTWORK_KEYS` on the backend exactly. */
const VEHICLES: Record<string, (props: VehicleProps) => ReactElement> = {
    car: Car,
    rocket: Rocket,
    boat: Boat,
};

/** Every vehicle-artwork key this build can draw — for the settings picker
 *  and for tests, the same role `ARTWORK_KEYS` plays for award artwork. */
// eslint-disable-next-line react-refresh/only-export-components
export const VEHICLE_ARTWORK_KEYS: readonly string[] = Object.keys(VEHICLES);

/** Whether a key has a picture — the same question `hasArtwork` answers for
 *  award artwork, for a caller that needs to know before it lays out a
 *  spot for the glyph. */
// eslint-disable-next-line react-refresh/only-export-components
export function hasVehicleArtwork(key: string | null | undefined): key is string {
    return !!key && key in VEHICLES;
}

/**
 * The vehicle glyph for one artwork key — the pit pass footer, the heat
 * sheet's and results sheet's masthead mark. `artworkKey` is the resolved
 * `Terminology.vehicleArtworkKey`; a key this build does not recognise
 * (`hasVehicleArtwork` returning false) renders nothing rather than a
 * fallback car, the same "print blank rather than crash" rule
 * `AwardArtwork` follows — a blank glyph is a smaller surprise than a
 * printout confidently showing the wrong vehicle.
 */
export function VehicleGlyph({
    artworkKey,
    ...props
}: VehicleProps & { artworkKey: string | null | undefined }) {
    if (!hasVehicleArtwork(artworkKey)) return null;
    const Component = VEHICLES[artworkKey];
    return <Component {...props} />;
}

/**
 * A corner ornament for the certificate's frame.
 *
 * Two rules turning a corner — a blue one outside, a gold one inside — meeting
 * at a gold lozenge, with the arms stopping in small dots. It is deliberately
 * architectural rather than floral: it has to sit under an event name and a
 * child's name without competing with either, and a flourish that curls draws
 * the eye to the corner, which is the one place on a certificate nothing
 * important happens.
 *
 * Drawn once for the top-left and rotated by the stylesheet for the other
 * three, so the four corners cannot drift apart.
 */
export function CornerFlourish({ size = 64, className }: DecorProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 64 64"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            {/* Outer rule, inner rule, and a lozenge nested in the gap they
                leave at the elbow. Three marks and no more: at 0.6in on paper
                a fourth is a blur, and the corner of a certificate is the one
                place where nothing important happens. The two arms are the
                same length on purpose — unequal ones read as a mistake rather
                than as an ornament. */}
            <path
                d="M3 54 L3 8 Q3 3 8 3 L54 3"
                fill="none"
                stroke={BLUE}
                strokeWidth="2.2"
                strokeLinecap="round"
            />
            <path
                d="M11 48 L11 13 Q11 11 13 11 L48 11"
                fill="none"
                stroke={GOLD}
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <path d="M6.5 2 L11 6.5 L6.5 11 L2 6.5 Z" fill={GOLD} />
        </svg>
    );
}

/**
 * The seal at the foot of a certificate: a gold rosette with two ribbon
 * tails, a blue rim, and a star in the middle.
 *
 * It says nothing — there is no text in it — because a seal that named the
 * pack would need the pack's name threaded down here from three callers, and
 * a seal that named the wrong pack is worse than a seal that names none.
 */
export function Rosette({ size = 96, className }: DecorProps) {
    const points = Array.from({ length: 20 }, (_, i) => {
        const angle = (i / 20) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? 30 : 24;
        return `${50 + Math.cos(angle) * radius},${40 + Math.sin(angle) * radius}`;
    }).join(' ');

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            {/* Ribbon tails, behind the rosette so they read as one object. */}
            <path d="M38 60 L30 96 L46 88 L50 70 Z" fill={BLUE} />
            <path d="M62 60 L70 96 L54 88 L50 70 Z" fill={BLUE} />
            <polygon points={points} fill={GOLD} />
            <circle cx="50" cy="40" r="18.5" fill="var(--print-surface-color)" stroke={BLUE} strokeWidth="2" />
            <circle cx="50" cy="40" r="15" fill="none" stroke={GOLD} strokeWidth="1" />
            <path
                d="M50 29 L53.3 37.6 L62.5 37.6 L55.1 43.2 L57.9 51.8 L50 46.5 L42.1 51.8 L44.9 43.2 L37.5 37.6 L46.7 37.6 Z"
                fill={GOLD}
                stroke={BLUE}
                strokeWidth="1"
                strokeLinejoin="round"
            />
        </svg>
    );
}

const CAR_BODY = 'var(--print-primary-color, #003F87)';
const CAR_BODY_LIGHT = 'var(--accent-blue, #2A6FBF)';
const CAR_ACCENT_DARK = 'var(--print-rule-line-color, #c8d2de)';
const CAR_GOLD = 'var(--print-accent-color, #FCD116)';
const SEAL_NAVY = 'var(--print-primary-color, #003F87)';
const SEAL_NAVY_DARK = 'var(--print-header-gradient-start, #002a5c)';
const WHITE = '#ffffff';

interface DerbyCarProps {
    width?: number;
    height?: number;
    className?: string;
    number?: string | number;
}


/**
 * High-performance Pinewood Derby roadster vector illustration matching
 * the authentic retro speedster specification, featuring open cockpit,
 * aerodynamic rollover headrest fairing, dual racing stripes, 5-hole
 * wheels with axle caps, and dynamic speed streaks.
 */
export function DerbyCarIllustration({
    width = 320,
    height = 145,
    className,
    number = '73',
}: DerbyCarProps) {
    const isStandard73 = String(number) === '73';

    return (
        <svg
            width={width}
            height={height}
            viewBox="40 180 1260 550"
            className={className}
            aria-hidden="true"
            focusable="false"
        >

            <path fill={CAR_BODY} d="M555 216a84 84 0 0 1 23.5 31.7c2.3 4.5 3.8 8.2 4.5 13.3l3.2-1.4q33.1-14.4 66.8-27.6l2.9-1.1c25.3-9.8 49.7-15.9 75.6-4.5C776 247 776 247 790 261c13.7.7 27.5-1.7 41-3.8a557 557 0 0 1 25.4-3.1 473 473 0 0 0 20.2-2.6q7.7-1 15.4-1.7a503 503 0 0 0 22.3-2.8 231 231 0 0 1 17.6-1.7q4.4-.4 8.8-1.2 13.3-2 26.7-3.1l5-.5 21-2q18.8-2 37.9-1.8h9.3a277 277 0 0 1 42.4 3.3l3.8.6 11 1.8c51 9.4 98 33.9 142.6 59.4q5.6 3.2 11.3 6.3l2.8 1.4 5.1 2.7c6.5 3.5 11 7.5 13.8 14.6 2.7 9.4 4.4 19.3 0 28.3-4.1 5.7-11 8.5-17 11.8l-3.2 1.7a2190 2190 0 0 1-40.1 21c-.5.1-.5.1-2.8 1.3l-2.4 1.2c-1.9.9-1.9.9-3.9.9l-.5 2.5a85 85 0 0 1-34.7 55.9q-6.3 3.5-12.8 6.6-79.7 11.4l-9.6 1.4c-39.8 5.8-39.8 5.8-57.4 8.7q-10.9 1.7-21.7 3l-59.2 8-7.3 1-11.7 1.7-4.3.6q-9.7 1.3-19.5 3-9.7 1.5-19.6 2.7-27 3.5-54.2 7.3l-2 .2-45.4 6.3-54.7 7.5-2 .3-9.5 1.3-31.4 4.3-36.5 5c-30.5 4-30.5 4-43.5 6q-21.6 3.3-43.2 5.8-14.7 1.8-29.2 4.1-10.9 1.7-21.7 2.9c-19.5 2.1-19.5 2.1-28.1 3.7q-14.1 2.4-28.2 3.8-12.2 1.2-24.3 3.2a485 485 0 0 1-25.7 3.4l-32.7 4-5.7.7q-8 1-16 2.4-13.7 2.1-27.7 3.5-23.4 2.6-46.6 6-18 2.6-35.9 4.5-9.3 1-18.5 2.5c-12.2 2.1-24.5 3.1-36.8 4.4q-15 1.5-29.9 3.5l-21 2.7-7.5 1A443 443 0 0 1 162 596v-1q35-6.3 70.3-11.2l4.5-.6q22.5-3.4 45-6.2 9.1-1.2 18.3-3 8.6-1.4 17.2-2.6c2.7-.4 2.7-.4 4.7-1.4l-6.4-2.5-3.7-1.4c-7-2.3-14.7-1-22-.4l-2.7.3q-12 1.3-24.1 3-16.3 2.1-32.6 3.8l-3.8.3q-8.3 1-16.7.9v-1q34-6.3 68.3-11.8l2.6-.4 5-.8q5.5-.9 11.1-2c-5.4-5-9-5.3-16.3-5.2q-9.7.5-19.5 1.7c-16.2 1.7-16.2 1.7-23.2 1.5 3.6-2.1 7.3-2.7 11.4-3.4l2.1-.4 6.8-1.2 6.8-1.2 4.2-.7q6.4-1.2 12.7-3.1l-2-2.7-2.8-3.5-1.4-1.7c-6.8-8.9-6.8-8.9-6.8-12.1l-3.7-.2c-4-.4-7.2-1.4-10.9-2.9l-17.1-6.5-8-3-5.3-1.9-8-3-2.3-.8c-8.2-3-16-7-20.7-14.7-2-4.6-4-9-4-14l6-1 2 8 2.6-.6c11.4-2.5 22.7-4.8 34.4-4.4v2c.6 9.3 2.7 18 5 27h3l-.7-3.7A130 130 0 0 1 239 479l15-2 .2-4 .2-5.4.3-5.2V460c.3-2 .3-2 1.3-4l-1.7.4A50 50 0 0 1 240 458l2-12 16-2 2.3-6.5q2.7-8 6.7-15.5l-2 .4-22.6 3.7-3.8.6-8 1.2-10.2 1.6-9.8 1.5-3.6.6q-10.5 1.6-21 2.4l.9 3.6 1.1 4.7 1.6 6.8c.4 1.9.4 1.9.4 4.9l2.7-.5c14.7-2.8 29.5-4.6 44.3-6.5l-3 13-14.6 2.1-5 .8-7.2 1-2.2.3q-6 1-12 .8v7h-6l-3.3-14.5-1.1-4.9-1.7-7-.5-2.2-1-4.3-1-4.5c-.9-4-1.7-7.5-1.4-11.6l-13.8 1.6-4.6.5q-13.4 1.5-26.7 3.5-4 .6-7.9.4c3.5-2.3 6.6-2.9 10.6-3.7l2.3-.4 7.2-1.4 7.2-1.4 4.6-.9 11.5-2.4c3.6-.8 3.6-.8 7.6-.8l-1-7-3.5.5a2123 2123 0 0 1-64.7 8.4l-5.9.7-3.7.5-3.6.4-7.6 1-2 .3-5.6.8q-5.2.6-10.4.4v-1l64.8-10.6 4.5-.8 13.4-2.1 4.1-.7 5.8-1q1.5-.1 3.2-.4 5.1-.6 10.2-.4l-.7-2.6c-2.5-10.6-5-22.3.4-32.4 7.7-11.7 17.2-14.5 30.4-17.8l6-1.6 13.2-3.4a86 86 0 0 0 36.4-18.4q5.8-4.4 11.7-8.4l2.4-1.6 7.2-4.8 2.4-1.6a796 796 0 0 1 63.5-38.1l5-2.8 4.4-2.5 2-1.1c1.7-.9 1.7-.9 4.7-1.9q-9 1-17.8 2.3l-2.5.3-8.2 1.3-5.7.8-12 1.8-15.2 2.3-11.9 1.8-5.6.8-7.9 1.2a302 302 0 0 0-18.7 3q-4.2.5-8.5.4v-1l2-.4 20.6-4 7.6-1.5 59.7-11.9 11.6-2.3 5.7-1.2 8.7-1.7 2.7-.6 14.1-2.4c5.5-.9 10-2.8 15-5.2l5-2.4 2.7-1.2A239 239 0 0 1 424 240q-13 1.3-26.1 3.3l-4.8.7-10 1.4-9.9 1.5-14.6 2.1-2.5.4q-13.6 2-27.3 4.3l-2.5.4-11.8 2-4.2.8-3.7.6q-5.8.7-11.6.5c3-2 4.3-2.4 7.7-2.9l3-.5 3.6-.5q22-3.8 44-8.3 30.3-6.2 60.9-11.7l37.5-7.2q7.7-1.6 15.6-2.8c7.1-1 14-3 21-4.9 50.7-14 50.7-14 66.7-3.2"/>
            <path fill={CAR_BODY} d="m1094.6 248.5 7 1.4a308 308 0 0 1 74 25l3 1.4c3 2.1 3.9 4.3 5.4 7.7a14 14 0 0 0 8 4l-2-5a70 70 0 0 1 14.6 6.3l3.2 1.7 3.4 1.7q13.5 7.3 26.8 15.3l-1 2 3.8 1.1q9 3 17.2 7.9l1 2-1.6.3c-46 7.4-46 7.4-64.7 10.7l-4.2.7-5.8 1q-1.5.4-3.2.6c-2.5.7-2.5.7-4.5 2.7-.2 2.2-.2 2.2-.2 4.9v2.6c.2 2.5.2 2.5.7 4.4.8 3.4.6 6.9.6 10.3v2.3l-.1 5.5c-36.2 20-91.4 50-134 50l.5-3c.8-6.6.7-13.2.7-19.8v-3.9a109 109 0 0 0-29-75.4 86 86 0 0 0-35.4-22.2c-17.3-5.6-37.3-3.7-54.9 0q-4.5.8-9.2 1.2A78 78 0 0 0 872 314h-2l-.8 1.8c-1.3 2.4-2.8 4-4.8 6a81 81 0 0 0-17.3 31.1c-1 3-1.6 4.8-4.4 6.5q-6.8 1.3-13.7 1.6l-1 12 14-2-1 22-14 1c1.7 20.5 5.6 38.6 15 57l3.3-.7c11.4-1.8 11.4-1.8 15.6 1 3.7 3.4 6.4 7.4 9.1 11.7-3.6 2.3-7 2.4-11.2 2.6l-3.9.3-2.9.1a29 29 0 0 0 3 5q6.3.5 12.5-.4c10.7-1.2 10.7-1.2 14.9 1.7 2.6 2.7 2.6 2.7 2.6 4.7a732 732 0 0 1-33.9 5.7q-20.4 3.1-40.8 6.5l-3.3.6-19 3.2c40-3.8 40-3.8 54.1-6q13.6-1.7 27.3-3l3.5-.4 3.2-.3q4-.5 7.9-1.3c9.5-1 16.4 1.3 25 5l6 2v1q-20.5 3-41.1 5.5-10.7 1.3-21.3 3-1.7.1-3.5.4l-3.2.5a822 822 0 0 1-25.7 3.4q-28.4 3.4-56.7 7.4l-14.4 2-24 3.2-27.8 3.8-29.8 4.1-8.5 1.2-13.4 1.8-4.9.7q-12.5 1.6-25 3.6-4.8.7-9.7.4 5-4 10.3-7.6a70 70 0 0 0 26.7-40.1c1-2.3 1-2.3 3-3.4q6-1.7 12.1-2.3l2.8-.4 9-1.3 6.4-.9 16.9-2.3 16.8-2.4 19.6-2.7 62-8.8 7.1-1 16.5-2.4 7.6-1 6.5-1q3.4-.5 6.7-1.4l-2-5-2.6.5A475 475 0 0 1 802 452q-14.3 1.8-28.7 4-16.2 2.6-32.5 4.6a849 849 0 0 0-31.3 4.5q-13.3 2.2-26.6 3.8-30 3.8-60 8.3l-64 9.1-2.8.4-28 3.9-13 1.8-2.4.3q-19 2.7-38 5.7c-24 3.9-24 3.9-32.8 3.7l.4-2.9c2.4-16.6 1.8-31.7-1.4-48.1a366 366 0 0 1 29.5-4.9l9.5-1.4 25.3-3.7q1.3 0 2.6-.3l37.5-5.6 4.6-.8 19.6-3 6-1 7.3-1q8.5-1.6 17.1-1.3l-1.3-3.1-1.6-4-.9-2.1-.8-2-.7-1.9q-1-3.3-1.7-6.9l-122.4 18.1-8.7 1.3-12 1.8-3.5.5-3.2.5-2.8.4-6.4 1.4-6-12q46-7.2 92-14l2.5-.4 19.3-2.8 19.3-2.9 9.5-1.4 4.5-.7 6.3-.9 3.6-.5c3-.4 3-.4 7-.4v-10.6l-.1-2.3v-2q.3-3.1 1.1-6.1l-2 .3c-54.9 8.8-54.9 8.8-74.1 11.2a1079 1079 0 0 0-38 5.7 1247 1247 0 0 0-47.2 7.9c-16.4 3-16.4 3-22.1.2a53 53 0 0 1-6.6-7.3 71 71 0 0 0-46.2-13.7c-8 .2-15.8 1.7-23.7 3a479 479 0 0 1-20.3 3.3l-2.8.4-5.8.8q-30 4.1-59.8 8.8l-3.6.6-14.1 2.3-37 5.7-3 .5q-3.8.4-7.7.3c-4.8-23.2-4.8-23.2.2-31.7 4.5-6.2 10.2-8.4 17.3-10.6l2.9-.8q27.8-8.4 55.9-15.4l18.2-4.9q15.2-4.1 30.4-8l2.9-.8q18.3-4.6 36.7-8.7l24-5.7q19-4.5 38.2-8c2.3-.4 2.3-.4 5.3-1.4q3.8-.3 7.6-.3l2-.1c6 0 10.2 1.7 15.4 4.4l3.1 1.6 8.9 4.6 11.6 6 11 5.8c15 8 26.3 5.8 42.5 2.7q19.5-3.7 39-7l2.4-.5 41.6-7.2a6592 6592 0 0 0 101.3-18.4l32.7-6.2 2.5-.4a952 952 0 0 1 29-5q14.5-2.3 28.8-5.3 27.1-5.4 54.5-9.6 8.2-1.2 16.6-2.8c15.4-2.8 31-4.6 46.5-6.3l3.2-.4c22.2-2.3 44.5-2.2 66.8-2.6-3.6-1-6.7-1.1-10.4-1.1h-10.1q-13.4 0-26.7.5l-2.6.2c-3.3.1-6.1.4-9.2 1.4l-8.2.5q-6 .2-12 1-6.4.8-12.6.7-16.8.4-33.4 2.7l-3.5.5c-4.8.7-9.3 1.4-13.7 3.2a19 19 0 0 1-9.3 1.5q-8.3-.2-16.5.8A445 445 0 0 1 774 276c11.4-7.6 27-8.4 40.3-10l6-.7q24.3-3 48.6-5.7l2.6-.3 4.9-.6c5.4-.6 5.4-.6 7.6-1.7l4.1-.6 2.7-.3 2.9-.3 3-.4 10-1.2q1.5 0 3.4-.4c136.1-15.8 136.1-15.8 184.5-5.3"/>
            <path fill="#ffffff" d="m853 337-3.7 10.4-1 3-1 2.8-1 2.7c-1.7 2.8-3.2 3.2-6.3 4.1q-5.5.6-11 1l-1 12 14-2-1 22-14 1c1.7 20.5 5.6 38.6 15 57l3.3-.7c11.4-1.8 11.4-1.8 15.6 1q5.2 5.2 9.1 11.7c-3.6 2.3-7 2.4-11.2 2.6l-3.9.3-2.9.1a29 29 0 0 0 3 5c4.3.4 8.1.1 12.5-.4 10.7-1.2 10.7-1.2 14.9 1.7 2.6 2.7 2.6 2.7 2.6 4.7a746 746 0 0 1-33.9 5.8q-20.4 3-40.8 6.4l-3.3.6-19 3.2c40-3.9 40-3.9 54.1-6q13.6-1.7 27.3-3l3.5-.4 3.2-.3q4-.4 7.9-1.3c9.5-1 16.4 1.3 25 5l6 2v1q-20.6 3-41.1 5.5-10.6 1.3-21.3 2.9l-3.5.5a588 588 0 0 1-28.9 3.9q-28.4 3.4-56.7 7.4l-14.4 2-24 3.3-27.8 3.7-29.8 4.1-8.5 1.2-13.4 1.8-4.9.7-25 3.6a52 52 0 0 1-9.7.4 152 152 0 0 1 10.3-7.6 70 70 0 0 0 26.7-40.1c1-2.3 1-2.3 3-3.4q6-1.7 12.1-2.3l2.8-.4 15.4-2.2 16.9-2.3 16.8-2.4 19.6-2.7 62-8.8 7.1-1 12.6-1.8 4-.6 7.5-1 3.4-.5 3.1-.5q3.4-.5 6.7-1.4l-1.1-1.7a96 96 0 0 1-13.4-37.4c-1-5.8-1.5-11-1.5-16.9a877 877 0 0 0-29.4 4l-6.2 1-17.7 2.7c-15.6 2.4-31 4.8-46.7 6.3l2-21q11.4-2.6 23-3.9 12-1.2 23.8-3.4 26.5-4.4 53.2-7.7l3-12-3.2.5c-35.2 5.6-35.2 5.6-47.5 7.3l-32.5 4.8-8 1.2-2.4.4q-6.2 1-12.4.8l-.8-2.7-1-3.6-1.1-3.5c-1.1-3.2-1.1-3.2-2.2-5.4-.9-1.8-.9-1.8-.9-4.8l30.2-4.5 14-2.1 16.3-2.5 2.6-.4 46.7-6.9 2-.3 8.2-1.3 6-1 3.6-.6q5.2-.6 10.4-.4"/>
            <path fill={CAR_BODY_LIGHT} d="m1094.6 248.5 7 1.4a308 308 0 0 1 74 25l3 1.4c3 2.1 3.9 4.3 5.4 7.7a14 14 0 0 0 8 4l-2-5a70 70 0 0 1 14.6 6.3l3.2 1.7 3.4 1.7q13.5 7.3 26.8 15.3l-1 2 3.8 1.1q9 3 17.2 7.9l1 2-1.6.3c-46 7.4-46 7.4-64.7 10.7l-4.2.7-5.8 1q-1.5.4-3.2.6c-2.5.7-2.5.7-4.5 2.7-.2 2.2-.2 2.2-.2 4.9v2.6c.2 2.5.2 2.5.7 4.4.8 3.4.6 6.9.6 10.3v2.3l-.1 5.5-3 1-.3-3-1.8-15.5c-1.3-13.1-1.3-13.1-5.3-16.7a35 35 0 0 0-7.6-2.8l.3-3.1c-.4-4.7-2-6.8-5.3-9.9a70 70 0 0 0-6.7-4.1l-2.1-1.1c-46.4-25-46.4-25-66.7-24.5a31 31 0 0 1-13.9-3.2q-6.6-2.7-13.7-4l-3.2-.8c-67.7-15.5-135.6-9.4-203.4 2.3l-7 1.2a7093 7093 0 0 0-110.2 19.8l-39.5 7.1q-31.8 6-63.7 11.6l-7 1.2-3.6.7-25.8 4.6-27.5 5-13 2.3-21.7 3.9-10.7 1.9-15.5 2.8c-7.8 1.3-13.6 1.8-20.9-1.7l-2.7-1.3-2.8-1.5-3-1.4-16.6-8.3-3.5-1.8q-3.3-1.5-6.6-3.4c-16.2-8.2-27.8-7.9-45.2-4.2l-4.7 1q-18.6 3.8-37.1 8.1l-23.7 5.2a3020 3020 0 0 0-76.4 17.3l-6.6 1.5-19.5 4.4a580 580 0 0 0-34.1 8.7c-.5 0-.5 0-2.6.7l-2.3.7c-1.8.3-1.8.3-3.8-.7 5-2.8 10.2-4.4 15.7-5.9l2.9-.8 9-2.6 6.4-1.7q19.5-5.5 39-10.4l14.4-4q15.3-4.1 30.5-8l2.9-.8q18.3-4.6 36.7-8.7l24-5.7q19-4.5 38.2-8c2.3-.4 2.3-.4 5.3-1.4q3.8-.3 7.6-.3l2-.1c6 0 10.2 1.7 15.4 4.4l3.1 1.6 8.9 4.6 11.6 6 11 5.8c15 8 26.3 5.8 42.5 2.7q19.5-3.7 39-7l2.4-.5 41.6-7.2a6592 6592 0 0 0 101.3-18.4l32.7-6.2 2.5-.4a952 952 0 0 1 29-5q14.5-2.3 28.8-5.3 27.1-5.4 54.5-9.6 8.2-1.2 16.6-2.8c15.4-2.8 31-4.6 46.5-6.3l3.2-.4c22.2-2.3 44.5-2.2 66.8-2.6-3.6-1-6.7-1.1-10.4-1.1h-10.1q-13.4 0-26.7.5l-2.6.2c-3.3.1-6.1.4-9.2 1.4l-8.2.5q-6 .2-12 1-6.4.8-12.6.7-16.8.4-33.4 2.7l-3.5.5c-4.8.7-9.3 1.4-13.7 3.2a19 19 0 0 1-9.3 1.5q-8.3-.2-16.5.8A445 445 0 0 1 774 276c11.4-7.6 27-8.4 40.3-10l6-.7q24.3-3 48.6-5.7l2.6-.3 4.9-.6c5.4-.6 5.4-.6 7.6-1.7l4.1-.6 2.7-.3 2.9-.3 3-.4 10-1.2q1.5 0 3.4-.4c136.1-15.8 136.1-15.8 184.5-5.3"/>
            <path fill="#ffffff" d="m678 336 2.8 1.3a62 62 0 0 1 31.3 37.5 69 69 0 0 1-6.2 51.3c-9 14-22.1 23.4-38.4 27.5-15 2.3-29.5-.7-42-9.4a66 66 0 0 1-26-38.7A71 71 0 0 1 603 368l1.1-2.7A61 61 0 0 1 638 334a55 55 0 0 1 40 2"/>
            <path fill={CAR_BODY} d="m515 221-2.2 3c-11.7 19-10.2 43.6-10.4 65l-.1 7.6-.3 18.4-3.8-.4-2.1-.3q-4.4-.7-8.6-2.3l-1.9-.6q-11.2-4-22.3-8.4l-3-1.1-2.7-1c-12.8-4.2-26-1.4-39 1.2l-4.8 1a1518 1518 0 0 0-39.4 8.3l-20.5 4.3q-10.6 2-21 5.2-8.3 2.3-16.8 4.1-15.7 3.6-31.2 7.9l-10.7 3q-1.7.4-3.5.9l-3.3 1c-.5 0-.5 0-3 .7-2.4.5-2.4.5-4.4-.5 32.7-24.8 68.7-46 105.3-64.6l6.9-3.6A575 575 0 0 1 491 225l2.9-.7 8.7-2.2 2.7-.7 2.6-.6 2.2-.6c1.9-.2 1.9-.2 4.9.8"/>
            <path fill={CAR_BODY} d="M785 265c-3.4 2-6.8 2.8-10.6 3.7l-2 .5-4.2 1-6.1 1.5c-27 6.6-54.5 11.5-81.8 16.4l-10.9 2a3454 3454 0 0 1-86.1 14.5l-7.4 1.2-17 2.6-12.4 2-6 1-8.5 1.3-2.5.4q-5.7 1-11.5.9a28 28 0 0 1 9-21c4.8-4 10.3-6 16-8.4l5.7-2.3 6-2.5a1556 1556 0 0 0 35-14.7l12-5c74-31.2 114.4-43.5 183.3 4.9"/>
            <path fill={CAR_GOLD} d="m853 337-3.7 10.4-1 3-1 2.8-1 2.7c-1.7 2.8-3.2 3.2-6.3 4.1q-5.5.6-11 1l-1 12 14-2-1 22-14 1c1.5 18.1 4.7 34.3 12 51l1.7 4 1.3 3-5 1a95 95 0 0 1-17-57 877 877 0 0 0-29.4 4l-6.2 1-17.7 2.7c-15.6 2.4-31 4.8-46.7 6.3l2-21q11.4-2.6 23-3.9 12-1.2 23.8-3.4 26.5-4.4 53.2-7.7l3-12-3.2.5c-35.2 5.6-35.2 5.6-47.5 7.3l-32.5 4.8-8 1.2-2.4.4q-6.2 1-12.4.8l-.8-2.7-1-3.6-1.1-3.5c-1.1-3.2-1.1-3.2-2.2-5.4-.9-1.8-.9-1.8-.9-4.8l30.2-4.5 14-2.1 16.3-2.5 2.6-.4 46.7-6.9 2-.3 8.2-1.3 6-1 3.6-.6q5.2-.6 10.4-.4"/>
            <path fill={CAR_BODY_LIGHT} d="M959.5 259.9h11.4q4.1.1 8.1 1.1l-1 2h-3.6c-38.2.6-77 1.7-114.5 9.4q-12.6 2.5-25.4 4.4-21.8 3.4-43.4 7.8a858 858 0 0 1-35.6 6.5l-9.1 1.5-2.2.4q-15.6 2.6-31 5.6-42.3 8-84.8 15.6l-29.6 5.2-5.2 1-7.9 1.3-39.6 7-14.3 2.6-9.2 1.6-4.3.8L505 336l-3.6.6c-9.1 1.5-16.2 2.6-24.8-1.7l-8.5-4.3-4.4-2.2q-13-6.2-25.4-13.5c-5.3-3-10.1-5-16.2-5.5q-1.1 0-2.3-.3l-1.8-.1v-1c21.8-6.1 38.3-2.7 58.9 5.7q6.4 2.6 12.9 5c.3 0 .3 0 1.9.7 15 5.2 33 .1 48.2-2.3l8.5-1.4L578 311l2.3-.4a5727 5727 0 0 0 151-26.4l2.2-.4q11.6-2.2 23-5.4c12-3.3 23.4-4 35.8-4.3q10-.2 20-1.4 8.8-1 17.7-.5c3-.2 5-1.1 7.9-2.4 4.7-1.8 9.9-2.2 14.9-3l3.6-.4q16.5-2 33-2.2 6.4-.2 12.6-1.2l11-.6q4.7-.1 9-1.4l8.8-.6h2.7q13-.6 26-.5"/>
            <path fill={CAR_BODY_LIGHT} d="m1031 271 2.3.6q19.7 5.6 38.7 13.4c-3.7 1.2-4.8.6-8.4-.6C992 261.6 916 269 843.4 281.6l-7 1.2A7614 7614 0 0 0 726 302.6l-39.5 7.1q-31.8 6-63.7 11.6l-7 1.2-3.6.7-66.4 11.9-21.6 3.9-10.7 1.9-11.9 2.1-3.6.7c-7.8 1.3-13.6 1.8-20.9-1.7l-2.7-1.3-2.8-1.4-3-1.5-26.7-13.5c-16.2-8.2-27.8-7.9-45.2-4.2l-4.7 1q-18.6 3.9-37.1 8l-23.7 5.3a3113 3113 0 0 0-76.4 17.3l-6.6 1.5-19.5 4.4a582 582 0 0 0-34.1 8.7c-.4 0-.4 0-2.6.7l-2.3.7c-1.8.3-1.8.3-3.8-.7 5-2.8 10.2-4.4 15.7-5.9l2.8-.8 9.2-2.6 6.3-1.7q19.5-5.4 39-10.4l14.4-4q15.3-4.1 30.5-8l2.9-.8a991 991 0 0 1 36.7-8.7l24-5.7q19-4.5 38.2-8c2.3-.4 2.3-.4 5.3-1.4q3.8-.3 7.6-.3l2-.1c6 0 10.2 1.7 15.4 4.4l3.1 1.6 8.9 4.6 11.6 6 11 5.8c15 8 26.3 5.8 42.5 2.7q19.5-3.6 39-7l2.4-.5 12.6-2.2 26.4-4.6 2.6-.4 54.4-9.8 21.6-3.9q12.7-2.2 25.3-4.7l32.7-6.2 2.5-.4a952 952 0 0 1 29-5q14.5-2.3 28.8-5.3 27.1-5.4 54.5-9.6 8.2-1.2 16.6-2.8A649 649 0 0 1 908 265l3.2-.4c38.8-4.3 82-4.3 119.8 6.4"/>
            <path fill={CAR_BODY} d="M1265 324a44 44 0 0 1 4 26 26 26 0 0 1-11.3 9.1l-2.2 1.2-6.8 3.5-4.5 2.3-21.2 11.2a146 146 0 0 1-42 16.7l-2 .4q-7.5 1.4-15 2.6l-5.8 1-9.3 1.5-17.9 3-2 .4-10.5 2-2.2.4-6 1.3c-3 .3-4.6.4-7.3-.6q11.8-5.1 23.8-9.9c16-6.3 32-13 47-21.7 2.9-1.3 5.1-1.8 8.2-2.3q8.5-1.6 16.8-3.6l3-.7 9.3-2.3 9.3-2.2 5.7-1.4q9-2.2 17.9-3.9a1166 1166 0 0 0-51.1 6.6L1176 367l-.2-3.4-.2-4.4-.2-2.2q-.2-5-1.4-10l-.2-5-.1-2.7c.3-2.3.3-2.3 1.3-4 3-2 6.2-2.4 9.6-3l2-.4q6.5-1 12.9-.9 7.9-.1 15.7-.9l3.5-.2 3.3-.3 3-.2a46 46 0 0 0 9-2.4q5.4-1 10.8-1.6l2.9-.4a109 109 0 0 1 17.3-1"/>
            <path fill={CAR_GOLD} d="m593 375-1 21q-26 4.3-52 8l-3.3.5-5.7.8a2744 2744 0 0 0-65 9.7l-18.5 2.9-7 1-2.1.4c-7 1-7 1-10.4.7-2.3-2.4-2.3-2.4-4.5-5.7a62 62 0 0 0-7.3-9C414 403 414 403 414 401l84.6-12.7 3.7-.6 42.2-6.3 17.1-2.5q4.4-.8 8.7-1.3l4.3-.7 6.4-1 3.7-.5c3.3-.4 3.3-.4 8.3-.4"/>
            <path fill="#ffffff" d="M487 503c2.2 2.1 2.2 2.1 4 5l2 3 2 3a73 73 0 0 0 41 26v1q-31 5.3-62.2 9.3l-34.3 4.7-3.4.5-16.1 2.4-5.8.9-2.7.4-2.5.4-2.1.3c-1.9.1-1.9.1-4.9-.9l2.6-1.7a86 86 0 0 0 34-44.5l.8-2.1.6-1.7 16.7-2.6 5.7-.8 8.2-1.3 2.5-.4q7-1.2 13.9-.9"/>
            <path fill={CAR_BODY} d="M292 395q-3.7 3.9-7.8 7.3c-5.7 4.9-10.4 9.4-13 16.6-1.1 2.1-1.1 2.1-3.2 4.1-2.8.6-5.2.8-8 1l-5.2.4-2.8.3q-8 .9-15.8 2.2l-3.4.5-10.3 1.7-10.4 1.6-6.4 1q-9.8 1.5-19.7 2.3l.9 3.6 1.1 4.7 1.6 6.8c.4 1.9.4 1.9.4 4.9l2.7-.5c14.7-2.8 29.5-4.6 44.3-6.5l-3 13-14.6 2.1-5 .8-7.2 1-2.2.3q-6 1-12 .8v7h-6l-3.3-14.5-1.1-4.9-1.7-7-.5-2.2-1-4.3q-.3-2.2-1-4.5c-.9-4-1.7-7.5-1.4-11.6l-13.8 1.6-4.6.5q-13.4 1.5-26.7 3.5-4 .6-7.9.4a25 25 0 0 1 10.3-3.6l2.2-.4 7-1.4 7.2-1.4 4.7-1 18.3-3.6 2.3-.5 5-1.1v-6q11.9-2.5 23.9-3.9l8-1 2.1-.3 19.8-2.8a1136 1136 0 0 1 39.3-5q2.9-.2 5.8-.6c10.9-1.4 10.9-1.4 12.1-1.4"/>
            <path fill={CAR_GOLD} d="m593 408 3.5 8.9 1 2.5 1 2.5.9 2.2a8 8 0 0 1 .6 3.9l-2.3.3-28.9 4.2-2.3.3A9152 9152 0 0 0 457.3 449l-2.2.3c-11.7 1.7-11.7 1.7-14.1 1.7l-3-8.3-.9-2.4-.8-2.3-.7-2.1c-.6-1.9-.6-1.9-.6-4.9q17.5-3.4 35.1-5.9l5.5-.8 14.4-2.1 15-2.2 20.5-3 26.1-3.9 13.5-2 6-.9 10.1-1.5q5.9-.8 11.8-.7"/>
            <path fill="#d4af37" d="M267 422a143 143 0 0 1-4.5 12l-4.5 11-16 1-.4 4.9c-.5 4.9-.5 4.9-1.6 7.1l16-2-.4 10.4-.2 3-.2 5.6c-.2 2-.2 2-1.2 3l-9.7.7-5.3.3.4 3.5q1.6 13.7 2.6 27.5h-3l-3.2-9.9c-2-6.4-2-12.4-1.8-19.1l-2.5.4-13.5 1.8c-7 1-14 2-21 2.8l-2-8-3 1c-2.7.9-4.7 1-7.6 1q-6.4 0-12.7.9l-4.8.5-7.3.9-7.1.8-2.2.3q-7.6.8-15.3.6c2.9-1.6 5.4-2.4 8.7-3l2.7-.6 3-.5 3-.6 9.7-1.9 9.7-1.8 6-1.2 2.8-.5 2.4-.4c2-.5 2-.5 4-1.5h6v-7l14.1-2.1 4.8-.8 7-1 2.1-.3q6.5-1 13-.8l.4-2.3.5-3 .6-3.1c.5-2.6.5-2.6 1.5-4.6l-4 .8q-10.5 2-21.1 3.5l-7 1-4.5.7-2.1.3q-4.2.6-8.3.7l-2.6-10.7-.5-2.3-.5-2.1c-.4-1.9-.4-1.9-.4-4.9 2.8-1.4 5.4-1.6 8.4-2q1 0 2-.3l6.7-.9 9.5-1.3 2.5-.4 22-3.2 11.2-1.6 7.7-1.2 2.3-.3q4.4-.7 8.7-.8"/>
            <path fill={CAR_GOLD} d="M966.4 252.6h9.5c21.7-.2 42.6 1.1 64.1 4.4l3.3.5c55.5 8.3 107.7 32.2 155.9 60l3.2 1.9 3 1.7 2.7 1.5 1.9 1.4v2l-4.4 1-2.4.6c-10.6 1.4-16.1-.6-25.1-6.2l-7-4.2-1.8-1c-18.3-11-37.6-20-57.3-28.2l-3.2-1.3A396 396 0 0 0 1058 270l-2.9-.8c-15.8-4-31.9-6.4-48.1-8.2l-2.4-.3c-15.1-1.6-30.1-2-45.4-2h-3.5q-26.8-.1-53.3 2.8l-15 1.5c-24.5 2.2-49 4.7-73.5 8.6q-8.7 1.5-17.5 2.2-4.5.4-9.2 1.3c-4.5.7-8.6 1.1-13.2.9 11.6-7.8 27.7-8.5 41.2-10.1l6.2-.8 15-1.8 7-.8q16-2 32.3-3l2.3-.1 11-.6q10-.3 19.8-2.2c19.1-3.8 38.2-4 57.6-4"/>
            <path fill={CAR_GOLD} d="m853 337-5 13.4-1.1 3-1 2.6c-.9 2-.9 2-1.9 3h-13v-6h-2l-1 3c-1 3-1 3-2 4l-4.1.7-2.6.4q-1.5 0-2.9.3l-2.8.4-17.4 2.3q-5.9.6-11.6 2a64 64 0 0 1-11.6 1.6c-2 .3-2 .3-3 1.3q-3.4.5-7 .9l-2.1.3-6.8.7c-17.8 2-17.8 2-25.2 3.7q-3.9.9-7.9.4c-3.1-2.4-4.2-5.4-5.7-9l-1.3-3.2c-1-2.8-1-2.8-1-5.8l30.2-4.5 14-2.1 16.3-2.5 2.6-.4 46.7-6.9 2-.3 8.2-1.3 6-1 3.6-.6q5.2-.6 10.4-.4"/>
            <path fill="#6fbcff" d="M785 265c-3.4 2-6.8 2.8-10.6 3.7l-2 .5-4.2 1-6.1 1.5c-26.6 6.5-53.4 11.3-80.3 16.2l-14.2 2.5-11 2-5.3 1-7.2 1.3-2.2.4q-6.9 1.1-13.9.9c3.2-2.1 5.3-2.6 9-3.3l3.8-.7 2-.4 10.3-2 2-.5q8.3-1.6 16.6-3.4l25.7-5.5 14.3-3 5.4-1.1a421 421 0 0 0 20.3-4.6q3.8-.7 7.6-.5a75 75 0 0 0-11.4-9.7l-1.8-1.4c-17.2-12-37-23-57.8-26.9 2.5-2.5 4.3-2.7 7.7-3.6l3-.7c38.2-8 70.4 15.4 100.3 36.3"/>
            <path fill={CAR_BODY_LIGHT} d="m1094.6 248.5 7 1.4a308 308 0 0 1 74 25l3 1.4c3 2.1 3.9 4.3 5.4 7.7a14 14 0 0 0 8 4l-2-5a70 70 0 0 1 14.6 6.3l3.2 1.7 3.4 1.7q13.5 7.3 26.8 15.3l-1 2 3.8 1.1c6 2 11.6 5 17.2 7.9v1c-12.4 3-20.4 2.5-31.3-4.1l-5.1-3.3q-6.5-4-13.1-7.4l-2.7-1.5c-42.7-23.2-87.9-42.6-135.8-51.7l-2.8-.6c-20-3.7-40-5-60.2-6.4v-1c29.2-2.5 58.9-1.7 87.6 4.5M515 221l-1 1.5-1.3 2.1-1.3 2c-1.4 2.4-1.4 2.4-2.5 5.5-2.5 3.8-4.4 4-8.7 5l-2.8.5-5.7 1.2-3 .6q-5.7 1.2-11.3 3l-2.2.5q-2.2.8-4.6 1.3l-5.5 1.6q-63.2 18.3-122 47.2l-6.1 3c-52 25.3-52 25.3-72 41l-2-1c31.8-24 66.8-44.6 102.3-62.6l6.9-3.6A575 575 0 0 1 491 225l2.9-.7 8.7-2.2 2.7-.7 2.6-.6 2.2-.6c1.9-.2 1.9-.2 4.9.8"/>
            <path fill={CAR_GOLD} d="m1106 260 3.4 1a606 606 0 0 1 120.7 54.8c4.8 2.8 4.8 2.8 5.9 6.2-6.3 2.8-14 3.5-20.6 1q-3.8-2.1-7.5-4.6l-5.8-3.6-3-2a483 483 0 0 0-89.9-42.3q-14.3-5.4-29.3-9.1l-2.3-.6c-33.2-8.4-67.4-12-101.6-12.8v-1c43-5.7 88.8-.3 130 13"/>
            <path fill={CAR_BODY_LIGHT} d="m1031 271 2.3.6q19.7 5.6 38.7 13.4c-3.7 1.2-4.8.6-8.4-.6C992 261.6 916 269 843.4 281.6l-7 1.2Q794 290 751.7 298l-2.9.5-5.8 1-3 .6-2.6.5q-4.3.6-8.4.4c-1-3-1-3-1-6q16.3-3.2 32.6-5.8 15-2.5 29.8-5.5 27.1-5.4 54.5-9.6 8.2-1.2 16.6-2.8A649 649 0 0 1 908 265l3.2-.4c38.8-4.3 82-4.3 119.8 6.4"/>
            <path fill={CAR_BODY} d="M1265 354a63 63 0 0 1-10 6.3l-3.4 1.8-3.8 2-3.8 2q-3.7 2.1-7.6 4L1216 381l-2.3 1.2A119 119 0 0 1 1181 394l-2 .4q-7.5 1.4-15 2.6l-5.8 1-9.3 1.5-17.9 3-2 .4-10.5 2-2.2.4-6 1.3c-3 .3-4.6.4-7.3-.6q11.8-5.1 23.8-9.9c16-6.3 32-13 47-21.7 2.9-1.3 5.1-1.8 8.2-2.3q8.5-1.5 16.7-3.6l3-.7 9.2-2.2 6.2-1.5 20.9-5 3.2-.8 2.6-.6a36 36 0 0 0 6.2-2.7c2.4-.4 2.4-.4 5-.6l2.5-.2q3.8-.2 7.5-.2M714.4 247.8l2 1.1c10 6 20 12.5 28.6 20.1v2a2879 2879 0 0 1-59.8 12.6q-14.1 2.7-28.3 6c-4.4 1-8.4 1.6-12.9 1.4 2-4.6 3.4-7 8-9 5-1.2 10-1.1 15-1v-1.9c1-12.9 6.9-20.2 16-29 2-1.1 2-1.1 4.4-.5q12.9 7.2 23.7 17.7c2.1 1.9 3 2.7 6 2.6l2.4-.3 2.4-.2c2.1-.4 2.1-.4 4.1-1.4a131 131 0 0 0-30-19.8c-2-1.2-2-1.2-3-3.2 8.4-1.7 14-1.7 21.4 2.8M502 279v36c-5.6-.7-9.4-1.3-14.5-3l-1.9-.6q-11.2-4-22.3-8.4l-3-1.1-2.7-1c-12.8-4.2-26-1.4-39 1.2l-4.8 1q-20 3.8-39.7 8.3-13.5 3-27.1 5.6v-2c9.4-3.4 19-5.9 28.6-8.4l20-5.2 3-.9q6.4-1.5 12.5-3.4a394 394 0 0 1 37.3-8.8L479 282l4.7-1 3.8-.7 3.8-.7c3.7-.6 3.7-.6 10.7-.6M255 477l.2 1.8c3.1 26.2 3.1 26.2 8 35.3.8 1.9.8 1.9.8 4.9q-10.2-2.9-20-7l1 6a120 120 0 0 1-22.6-7l-6.3-2.5-4-1.6-3.7-1.4a31 31 0 0 1-16.7-15.3C189 483 189 483 189 479l6-1 2 8 2.6-.6c11.4-2.5 22.7-4.8 34.4-4.4v2c.6 9.3 2.7 18 5 27h3l-.7-3.7c-1.5-9.2-2.8-18-2.3-27.3l7.4-1 2.2-.3c5.3-.7 5.3-.7 6.4-.7"/>
            <path fill={CAR_BODY} d="M780 285c-2.2 2.2-3 2.4-6 3q-1.2 0-2.5.4l-2.7.5-2.8.5-22.6 4-24.3 4.3-2 .4-27.5 5-6.2 1.1-11.7 2.2q-32.3 6-64.7 11.6l-6.4 1.1-36.5 6.5-17 3-16.9 3-6.3 1.1-21 3.7c-17.5 3-17.5 3-26.3-1.6l-2-1q-3.4-1.6-6.6-3.2l-4.5-2.2Q449 321.3 435 313c2-1 2-1 4.6-.2l3.3 1.2 3.6 1.4 2 .8 6 2.3q8.7 3.3 17.3 7l2.5 1.2 4.5 2.1c3.8 1.7 6.6 2.4 10.8 1.9l2.7-.3 12.5-2 2.8-.4 6-1 9.5-1.6L543 322q74-12.4 148-23.7 22.2-3.3 44.4-7l2-.2 20.6-3.4 6.5-1 3-.6 2.8-.4 2.4-.4q3.6-.4 7.3-.3"/>
            <path fill={CAR_GOLD} d="M267 422a143 143 0 0 1-4.5 12l-4.5 11-3 .4-14.3 1.9q-1.3 0-2.6.3-18.6 2.4-37.2 5.2l-3 .5-2.7.4c-2.2.3-2.2.3-5.2.3l-2.6-10.7-.5-2.3-.5-2.1c-.4-1.9-.4-1.9-.4-4.9 2.8-1.4 5.4-1.6 8.4-2q1 0 2-.3l6.7-.9 9.5-1.3 2.5-.4 22-3.2 11.2-1.6 7.7-1.2 2.3-.3q4.4-.7 8.7-.8"/>
            <path fill={CAR_BODY_LIGHT} d="m999 248 4.5.4A409 409 0 0 1 1126 276l2.8 1.1c31.2 12.6 62.4 28 90.2 46.9v1c-8.3 1-13.1-1.8-20.1-6q-4.6-2.9-9.3-5.6l-1.9-1A438 438 0 0 0 1026 256l-3.7-.6c-15-2.1-30-1.7-45.1-1.7h-9.6a318 318 0 0 0-61.3 4.4q-6 1.1-12 1.3l-3.5.1-3.5.1-3.6.1-8.7.3v-1q9.8-2.3 19.7-3.4l3.1-.3 10-1.2 6.9-.8 10.4-1.2 18-2.1c18.9-2.3 37-3.6 55.9-2"/>
            <path fill="#ffffff" d="M1096 294.5q22.6 7.7 43.7 18.9l2.3 1.2a52 52 0 0 1 12 8.4v3a170 170 0 0 1-67-10 36 36 0 0 1-17-11.6c-1.2-2.8-1.6-4.4-1-7.4 8-7.6 17.1-5.8 27-2.5"/>
            {isStandard73 && (
                <path fill={CAR_BODY} d="M685.5 358.7c4 3.6 7.1 6.8 7.7 12.3.1 5.2-.4 8.6-3.2 13l-2 2 2.8 1.6c3.6 2.5 6 5.1 7.2 9.4.8 7.4.9 13.5-3 20a27 27 0 0 1-18.6 7.4A18 18 0 0 1 665 420c-4.2-4.8-4.6-8.8-5-15l12-1 3 10c3.5.3 5.4.4 8.4-1.5 2.2-3.5 2.1-6.5 1.6-10.5-1.3-5.6-1.3-5.6-5-8-2-.2-2-.2-4.2-.1l-3.8.1-1-9 3.4-1.3c3.6-1.7 3.6-1.7 5.6-4.7.4-3.7.2-6.4-1-10-2-2-2-2-5.7-2.3l-3.3.3-.2 2.1-.2 2.8-.3 2.8c-.3 2.3-.3 2.3-1.3 3.3l-5.6.6-3 .2-2.4.2c-.6-9.7-.6-9.7 1.6-14.4 7-7.6 17.3-10.5 26.9-6"/>
            )}
            <path fill={CAR_BODY} d="M544.6 217.6c4.8 2.4 8.6 5.6 12.4 9.4l1.8 1.7c7 7.4 19.2 24.9 19.2 35.3l-6 1-1.5-3.1c-13.9-28.4-13.9-28.4-26.3-34.2-5-1-9.5-1.1-14.2 1.3-8.1 6.2-10.5 16.4-12 26l-.3 10v5.5l-.2 8.7v11c-.1 5-.9 8.3-3.5 12.8l-1.2 6.4-.5 3.2-.3 2.4h-3a238 238 0 0 1-1.2-29v-2.5c.1-45.8.1-45.8 13.2-61.5 7.1-6.8 14.5-8 23.6-4.4"/>
            <path fill={CAR_BODY_LIGHT} d="M1110 289q6 1.6 12 4c3 1 3 1 6.6 1.8 5.9 1.4 11 4.2 16.4 7l3.4 1.7q15 7.7 29.6 16.5l2.6 1.6 4.5 2.7c9 5.4 19.4 2.1 29.3.4q6.8-1 13.4-1.5 4.2-.3 8.2-1.2l1-2 2 .6c3.1.4 5.7.1 8.8-.3q5.6-.6 11.2-.3v1l-1.6.3c-46 7.4-46 7.4-64.7 10.7l-4.2.7-5.8 1-3.2.7c-2.5.6-2.5.6-4.5 2.6-.2 2.2-.2 2.2-.2 4.9v2.6c.2 2.5.2 2.5.7 4.4.8 3.4.6 6.9.6 10.4v2.2l-.1 5.5-3 1-.3-3-1.8-15.5c-1.3-13.1-1.3-13.1-5.3-16.7a34 34 0 0 0-7.6-2.8l.3-3.1c-.4-4.7-2-6.8-5.3-9.9a67 67 0 0 0-6.7-4.1l-2-1.1c-12.1-6.5-24.6-12.8-37.3-17.8 3.8-1.1 3.8-1.1 6 0-1-3-1-3-3-5"/>
            <path fill={CAR_GOLD} d="M829 353h2v6h9v1l-11 1-1 12 14-2-1 22-14 1c1.5 18.1 4.7 34.3 12 51l1.7 4 1.3 3-5 1a92 92 0 0 1-17-57l-8 1c3.2-2.1 4.3-2.2 8-2v-1.8c-.2-6.5.6-12.3 2-18.6l.5-2.7q1-5 2.5-9.9l-3.2.5c-35.2 5.6-35.2 5.6-47.5 7.3l-32.5 4.8-8 1.2-2.4.4q-6.2 1-12.4.8v-5l2 1v2l3.9-.8a402 402 0 0 1 36.5-5.2l3.4-.4 3-.3c2.2-.3 2.2-.3 3.2-1.3l4.3-.4q6-.5 11.8-2 7.3-1.7 14.7-2.7l2-.2q5.4-.6 10.7-1l2.2-.3 6-.4c3.3-1 3.3-1 5.3-4z"/>
            <path fill={CAR_BODY} d="m1129.3 303 2.1 1c23 11.2 23 11.2 27.6 19 .6 2.6.6 2.6 0 5-8.2 6.8-23 4.5-33 3.6-19.7-2-45.4-7.1-59.4-22.2a16 16 0 0 1-3.5-10.8c1.1-4.4 2.7-6.5 5.9-9.6 20.4-8.3 42.2 5.4 60.3 14m-60.3-6c.2 4.6 1 8 4.2 11.5 11.7 9.5 28.4 12.5 42.8 15.5l2.5.6c7.6 1.5 15 1.6 22.7 1.5h3.7l9.1-.1c-.8-3.8-.8-3.8-2.5-5.4-64.7-41.4-64.7-41.4-82.5-23.6"/>
            <path fill="#1e1e1e" d="M968 317a89 89 0 0 1 34.5 58q.4 4.5.5 9c-2-3.5-2.7-6.9-3.6-10.7a87 87 0 0 0-36.2-51.4c-17-10.1-37-14-56.5-9.9a75 75 0 0 0-44 36 89 89 0 0 0-9.3 24.4A130 130 0 0 0 851 391h-1c-1-25.3 7-48 24-67 8-8.4 17.3-13.7 28-18l2.3-1c20.5-7.8 46.7.1 63.7 12M349 385c23.8-1 41.7 3.7 59.8 19.9q5 4.8 9.3 10.4.8.7 1.4 1.7c2.9 3.8 4.8 7.5 6.5 12l-7.6 1-2.1.3c-9.2 1.2-9.2 1.2-13.3.7-2-2-2-2-3.4-4.9A88 88 0 0 0 349 386z"/>
            {isStandard73 && (
                <path fill={CAR_BODY} d="M651 362c1.7 7.2.8 12.5-1.7 19.3A135 135 0 0 0 642 428l-14 2a132 132 0 0 1 11-54l-24 2c-1.2-3.7-1-7.2-1-11l11.4-2 3.3-.5c14.9-2.5 14.9-2.5 22.3-2.5"/>
            )}
            <path fill={CAR_BODY_LIGHT} d="m292 395-5.3 5.5c-5.3 5.2-10.6 5.9-17.8 6.8l-3.5.5-11 1.4-7.5 1-10.5 1.5q-9.4 1.2-18.7 2.9-6.4.8-13 .8A142 142 0 0 0 178 419l5 1v1a54 54 0 0 1-13.5 3l-2.2.3-6.8.7-9 1-2.1.3q-8.7 1-17.5 2.3-4 .6-7.9.4a25 25 0 0 1 10.3-3.6l2.2-.4 7-1.4 7.2-1.4 4.7-1 18.3-3.6 2.3-.5 5-1.1v-6q11.9-2.5 23.9-3.9l8-1 2.1-.3 19.8-2.8a1136 1136 0 0 1 39.3-5q2.9-.2 5.8-.6c10.9-1.4 10.9-1.4 12.1-1.4"/>
            <path fill={CAR_BODY} d="M546 436a16 16 0 0 1-8.9 4.1l-2.9.5-3 .5-3.3.5q-12.3 1.9-24.8 2.7c-4.5.3-8 1-12.1 2.7l-7.3.5c-8 .4-8 .4-11.8 1.6-5.6 1.3-11.1 1-16.9.9l.8 3.3c3.9 15.4 4.3 30 4.2 45.7l4 1-7.6 1-2.2.3q-6 .8-12.2.7l.4-2.9c2.4-16.6 1.8-31.7-1.4-48.1 9-2 18-3.2 27-4.5l4.9-.7 12.9-2 20.5-3 7.2-1 4.4-.6 2.1-.3 15.5-2.5q5.3-.7 10.5-.4"/>
            <path fill="#1e1e1e" d="M1198 396a77 77 0 0 1-17 36l-1.4 1.9a64 64 0 0 1-38.5 22.8l-3.1.3 2.2-1.7a93 93 0 0 0 32.7-45l1.1-3.3 1.1-3.8c1.9-3.2 1.9-3.2 5.6-4.5l4.3-.6 4.3-.6 3.7-.5c3-1 3-1 5-1"/>
            <path fill="#d4af37" d="M966.4 252.6h9.5c25.9-.2 50.6 2 76.1 6.4v1l-10.4-.4-3-.2h-3l-2.6-.2c-2-.2-2-.2-3-1.2l-8-.5c-7.7-.4-7.7-.4-10-1.5a141 141 0 0 0-20.3-1.1h-20.3q-19.6 0-39.4 1.1h2.3l21.6.3 11 .2 10.8.1 6 .1c12.2.2 24.3.8 36.3 2.8q4 .6 8.1 1c4.6.3 8.7 1.5 13 2.7q6 1.4 11.7 2.2c2.2.6 2.2.6 4.2 3.6q-6.6-1-13-2.3a330 330 0 0 0-31-4.9l-2.1-.2a326 326 0 0 0-51-2.9h-3.6a483 483 0 0 0-54 2.8q-7.4.8-14.8 1.5c-24.6 2.2-49.2 4.7-73.6 8.6q-8.7 1.5-17.5 2.2-4.5.4-9.2 1.3c-4.5.7-8.6 1.1-13.2.9 11.6-7.8 27.7-8.5 41.2-10.1l6.2-.8 15-1.8 7-.8q16-2 32.3-3l2.3-.1 11-.6q10-.3 19.8-2.2c19.1-3.8 38.2-4 57.6-4"/>
            <path fill={CAR_BODY} d="M1010 310c3.3 1.4 5.4 3.2 7.8 5.8q3.7 3.8 7.7 7c16 13.6 24.5 34.5 29.5 54.2l1 3.5c1.7 6.4 1.5 13 1.6 19.5l.1 4 .3 10-5.7 1.5-3.3.8c-3 .7-3 .7-7 .7l.5-3c.8-6.6.7-13.2.7-19.7v-4a110 110 0 0 0-29-75.5z"/>
            <path fill="#1e1e1e" d="M374.1 408.5a85 85 0 0 1 29.4 52.2l.5 9.3c-2-2.9-2.5-5-3.2-8.2a81 81 0 0 0-34.5-50.6 69 69 0 0 0-51.5-9.2 70 70 0 0 0-40.8 35c-4.7 9.2-6.9 19-9 29h-1c-.2-5.1.4-9.7 1.7-14.7l.5-2.1a77 77 0 0 1 34.1-48.1c25.2-13.6 51-8.7 73.8 7.4M1025 340c5.8 7 8 16.7 10.3 25.4l.5 2q1.5 5.8 1.2 11.6c-7.7 1.2-15.2 2.3-23 2l-.4-2.9c-1.7-11-5.3-20.8-9.6-31.1l-1-3c7.2-2 14.5-3 22-4M426 429a70 70 0 0 1 11 36l-9.9 1.5-2.8.4-2.7.4-2.5.4c-2.1.3-2.1.3-4.1.3l-.5-1.9c-3-12.2-6-23.8-11.5-35.1l8.1-1 2.3-.3q6.3-.8 12.6-.7"/>
            <path fill={CAR_BODY} d="M177 422h6q2.3 6.4 3.5 13.2l.4 2L190 454l2.7-.5c14.7-2.8 29.5-4.6 44.3-6.5l-3 13-14.6 2.1-5 .8-7.2 1-2.2.3q-6 1-12 .8v7h-6l-3.3-14.5-1.1-4.9-1.7-7-.5-2.2-1-4.2-1-4.6-.5-2.4-.5-2.2q-.7-4-.4-8M841 393l.5 3.8c2 15.3 5.5 28.8 12.4 42.7 1.1 2.5 1.1 2.5 1.1 4.5l-16 3c-7.7-17-12.6-34.1-12-53 4.7-1.2 9.2-1 14-1"/>
            <path fill={CAR_BODY_LIGHT} d="M1190 283a70 70 0 0 1 14.6 6.3l3.2 1.7 3.4 1.7q13.6 7.3 26.8 15.3l-1 2 3.8 1.1c6 2 11.6 5 17.2 7.9v1c-12.4 3-20.3 2.5-31.3-4.1l-5-3.3q-6.8-4-13.7-7.7l-2.7-1.5q-14-7.4-28.3-14.4c2.5-.7 4.4-1 7-1l2-2 6 2z"/>
            <path fill={CAR_BODY} d="M820 396q0 1 .3 2c2.5 17.3 5.8 33 12.7 49l-5.2 1-3 .7c-3 .3-5 .4-7.8-.7-8.2-11.5-10.2-28.2-10-42v-8l4.3-1 2.3-.6c2.4-.4 2.4-.4 6.4-.4"/>
            <path fill={CAR_GOLD} d="M233 462v18c-9.3 2.6-18.4 4-28 5l-8 1c-1.5-3-1-5.7-1-9l-3-1 1-9 13.9-2.5q12.4-2.4 25.1-2.5"/>
            <path fill={CAR_BODY_LIGHT} d="m999 248 2.3.2 21 2q16.4 1.5 32.7 4.8v2l1.8.1q10.3 1 20.2 3.9v2c-3 .2-5.2 0-8.2-1q-5.8-1.4-12-1.9a646 646 0 0 1-39.8-5.1l-4-.5c-6.9-.8-13.8-.7-20.8-.7h-24.1c-21-.2-41.2.4-61.8 4.3q-6 1.1-12 1.3l-3.5.1-3.5.1-3.6.1-8.7.3v-1q9.8-2.3 19.7-3.4l3.1-.3 10-1.2 6.9-.8 10.4-1.2 18-2.1c18.9-2.3 37-3.7 55.9-2"/>
            <path fill={CAR_BODY} d="m255 477 .2 1.8c3.1 26.2 3.1 26.2 8 35.3.8 1.9.8 1.9.8 4.9q-10.2-2.9-20-7l1 6h-3l-3-8h3l-.7-3.7c-1.5-9.2-2.8-18-2.3-27.3l7.4-1 2.2-.3c5.3-.7 5.3-.7 6.4-.7"/>
            <path fill={CAR_GOLD} d="M267 422a143 143 0 0 1-4.5 12l-4.5 11-3 .4-14.3 1.9q-1.3 0-2.6.3-18.6 2.4-37.2 5.2l-3 .5-2.7.4c-2.2.3-2.2.3-5.2.3l-2.6-10.7-.5-2.3-.5-2.1c-.4-1.9-.4-1.9-.4-4.9 3-1.5 6.2-1.7 9.5-2.2q1.2 0 2.3-.3l4.8-.7 7.2-1 19.2-2.6 2.3-.3c1.7.1 1.7.1 3.7 2.1l-2 .2-9.3 1.2-3.2.4q-9 1-18 2.8-4.6.7-9.2 1l-3 .3-2.3.1 1.4 6.3 2.6 9.7 3.4-1q8-1.5 16.3-1.6A400 400 0 0 0 238 446l.6-1.8A78 78 0 0 1 246 428l-10-1v-1l11.8-1.7 4-.6 5.8-.8 3.5-.5c2.9-.4 2.9-.4 5.9-.4"/>
            <path fill={CAR_BODY_LIGHT} d="M469 225a45 45 0 0 1-11.7 4.4l-3 .8q-12.6 3.8-25 8.7c-3.3 1.1-3.3 1.1-6.2 1-6 0-12 1.2-17.9 2l-4 .7-11 1.7L379 246l-17.8 2.7-20.8 3.2-8 1.2-4.7.8q-11.3 1.6-22.4 3.7-5.1.7-10.3.4c3-2 4.3-2.4 7.7-2.9l3-.5 3.6-.5q22-3.8 44-8.3 30.3-6.2 60.9-11.7l26.2-5 2.2-.4 9.5-2c5.8-1.2 11-2 16.9-1.7"/>
            <path fill="#ffffff" d="M697 231c22.7-3 48.3 14.7 66.4 26.6l2.4 1.6 5.2 3.8v2a23 23 0 0 1-13 2c-5.8-2.8-10.8-7.3-15.8-11.3a93 93 0 0 0-9.9-6.5l-1.8-1-5.5-3.2-1.9-1a161 161 0 0 0-26.1-12z"/>
            <path fill="#0a0a0a" d="m852.1 469.4 1.9 1.6v2c-48.4 6.1-48.4 6.1-71.7 8.7q-11.2 1.2-22.6 2.8l-17.6 2.1-3.5.4q-8.9 1.2-17.6 1v-1l21.6-3.6 7.4-1.3q24-4 48.3-7.7l10.5-1.6 9.2-1.4 18.3-3c5.5-.8 10.6-1.3 15.8 1M342 459c4.8 3.3 9.2 7.5 11 13 1 13.6 1 13.6-3 19-3.3 3.7-5.4 5.8-10.5 6.2-6 .2-9.8 0-14.5-4.2-5.4-5.9-6.5-11.2-6.4-19 .8-6 3.8-9.5 8-13.4 5-3.4 9.8-3.4 15.5-1.6m-16 8c-3 4.9-2.6 10.4-2 16 1.8 3.6 1.8 3.6 4 6l1.3 1.6c2.9 2.3 5.7 1.9 9.3 1.8 3.5-.5 5.1-1.7 7.4-4.4 2.8-4.5 2.7-9.9 2-15-2.5-4.7-5-8.3-10-10-5.5-.5-8.1 0-12 4"/>
            <path fill="#6fbcff" d="m292 395-4 4-1.3 1.5c-5.3 5.2-10.7 6-17.9 6.8l-3.5.6-7.4 1-11.3 1.6-7.2 1-3.3.4c-16.4 2.2-16.4 2.2-21.1-.9 3.5-3.2 7.3-4 11.8-5l2.3-.4 7.5-1.6 5-1a495 495 0 0 1 33.4-6l9.6-1.7q3.7-.4 7.4-.3"/>
            <path fill={CAR_BODY_LIGHT} d="m383 258-16 8-1.9 1c-2.2 1-3.7 1.3-6.1 1.4a233 233 0 0 0-17.5 2.3l-8 1.2-5.8.8-12 1.8-15.2 2.3-11.8 1.8-5.6.8-8 1.2-2.4.4-16.2 2.7q-4.2.5-8.5.3v-1l2-.4 20.6-4 7.6-1.5 59.9-12 11.6-2.3 6-1.2 8.7-1.7 2.6-.5c13.4-2.7 13.4-2.7 16-1.4M1015 261v1h-1.7c-15.8-1-31.7-1.1-47.6-1.1h-3q-15.7-.1-31.4.6h-2.7l-2.5.2-2.2.1c-1.9.2-1.9.2-4.9 1.2l-8.2.5q-6 .2-12 1-6.4.8-12.6.7-16.8.3-33.4 2.7l-3.5.5c-4.8.7-9.2 1.4-13.7 3.2a19 19 0 0 1-9.4 1.5 142 142 0 0 0-20 1.2q-7.5.9-15.2.7c3.6-2.4 5.8-2.5 10-3l2.2-.2 6.7-.8 10.9-1.2 16-2.3c12.7-2 25.5-3.2 38.2-4.5l3.1-.3c45.4-4.8 91.5-8.2 136.9-1.7"/>
            <path fill="#6fbcff" d="M889 302a54 54 0 0 1-29.2 10.6l-4.7.5-12.1 1.4-12.1 1.3-14.3 1.6a925 925 0 0 0-33.6 4.4q-8 1.3-16 1.2v-1l7-1.2 3-.6 3.1-.5 3.3-.6 24.7-4.4q1.7-.2 3.4-.6l3.4-.6 3.1-.5 7.5-1.3 4.4-.8 38.7-7 4.6-.8 6.3-1.1 3.6-.7c2.9-.3 2.9-.3 5.9.7"/>
            <path fill="#d4af37" d="m1070.4 251 2.2.5 6.1 1.1 3.6.7c2.7.7 2.7.7 4.7 2.7-8.5-.3-16-1-24.3-3.4-4-.9-7.6-.8-11.7-.6q6.2 1.8 12.6 2.4a31 31 0 0 1 11.4 3.6c-3.6 1.3-6.3.7-10 0l-3.7-.8-2-.5A460 460 0 0 0 976 248v-1c31.6-4.2 63.1-1.6 94.4 4"/>
            <path fill={CAR_BODY} d="m195 478 1 2.4 1.3 3.3 1.2 3.2c5.2 11 16.1 13.2 26.8 17l7 2.6 3.1 1c4 2.3 5.2 5.3 6.6 9.5-7.5-1.4-14.3-3.8-21.3-6.6l-5.7-2.2-3.6-1.5-3.3-1.3A31 31 0 0 1 189 479c2-1 2-1 6-1"/>
            <path fill="#6fbcff" d="M669 240c18.4-2 38.7 12.3 52.7 23a30 30 0 0 1 5.3 6 24 24 0 0 1-12 2c-2.6-1.6-2.6-1.6-5.1-4l-3-2.4-2.9-2.6a142 142 0 0 0-35-21z"/>
            <path fill={CAR_BODY} d="M780 285c-2.2 2.2-3 2.4-6 3q-1.2 0-2.5.4l-2.7.5-2.8.5-22.6 4a2864 2864 0 0 0-51.8 9.3l-13.4 2.5-9.7 1.8-6.2 1.1-2.8.6q-7.7 1.4-15.5 2.3l1-2h6v-2h-10v-1l25-3.9 3.8-.6 44.9-7q3.4-.4 6.7-1l19.4-3 6-.8 7.5-1.2 18.3-3.1q3.7-.6 7.4-.4"/>
            <path fill="#dcdcdc" d="M1092.1 296.1q6 1.8 11.9 3.9c-3 2-3 2-6.1 3.2-2.9 1.8-2.9 1.8-4 4.6.1 3.8 1.2 6 3.1 9.2v2c-17.4-4.6-17.4-4.6-21.3-9.7a16 16 0 0 1-1.7-10.3c5-6 11.4-4.8 18.1-2.9"/>
            <path fill="#6fbcff" d="M821.2 394.9h3.3l2.5.1.3 3.3c1.6 16.6 5 31.4 11.7 46.7l1.7 4 1.3 3-5 1a92 92 0 0 1-17-57l-8 1c3.5-2.4 5-2.2 9.2-2.1"/>
            <path fill={CAR_BODY_LIGHT} d="m1236 320 2.5.6c3.3.4 6 .1 9.3-.3q5.7-.6 11.2-.3v1l-1.6.3c-46 7.4-46 7.4-64.7 10.7l-4.2.7-5.8 1-3.2.7c-2.5.6-2.5.6-4.5 2.6-.2 2.2-.2 2.2-.2 4.9v2.6c.2 2.5.2 2.5.7 4.4.8 3.4.6 6.9.6 10.4v2.2l-.1 5.5-3 1a169 169 0 0 1-3.5-31.9c.5-3.1.5-3.1 2.3-5 5.3-2.7 11.4-2.2 17.2-2.1l1-2 3.8.2c6.2 0 12-1 18.2-2q7.8-1.5 15.8-2 4.2-.4 8.2-1.2zM806 376v1l-19.3 2.9-6.6 1-29 4.2q-9.4 1.4-18.7 3l-2.4.3-2 .4c-2 .2-2 .2-6 .2l.1 3.8q0 5.8-1.1 11.5l-.6 3.3-.4 2.4 1.9-.3q16.5-2.8 33.1-5.4l2.4-.4q7.3-1.1 14.6-.9l-1 2c-2 .5-2 .5-4.7.8l-2.8.4-8.8 1.1-2.7.3c-2 .4-2 .4-3 1.4l-6.4 1-4 .5-4.2.6-4.1.5L720 413c-2.3-3.4-3.4-5.4-3-9.6l.4-2.5.3-2.6q0-1.3.3-2.6c.7-6.4.7-6.4 3-8.7a120 120 0 0 1 10.6-2.5c9.8-2 19.7-3 29.6-4.2L773 379l3.5-.5c2.6-.4 2.6-.4 4.6-1.4a221 221 0 0 1 25-1"/>
            <path fill={CAR_GOLD} d="M1050 251c5.4-.3 10.1-.1 15.3 1.4q6.7 1.8 13.6 2c20.4 1.3 40.2 9 59.1 16.6-3 1-4.5 1-7.7.6l-2.4-.4-1.9-.2v-2l-5-1v-2l-3.2.3c-6.2 0-12-2.3-17.8-4.3l1 4 2 .5c7.5 2 15 4.2 22 7.5l1 2q-8.3-2.4-16.4-5.4-13.5-5.2-27.6-8.7c-.5 0-.5 0-2.8-.6l-2.4-.6c-1.8-.7-1.8-.7-2.8-2.7-4.8-2.1-10-2.7-15.1-3.5q-4.6-.8-8.9-2.5z"/>
            <path fill={CAR_BODY} d="M546 379h14v1a826 826 0 0 1-37.7 5.8 1282 1282 0 0 0-43.4 6.4 1134 1134 0 0 0-47.2 7.9c-16.4 3-16.4 3-22 .2a63 63 0 0 1-6.7-7.3q-4.9-3.1-10-6l-3-2a37 37 0 0 1 15.1 4.9l2.1 1q4.4 2.1 8.2 5c4.2 1.8 8 .7 12.6.1l12-1.1 6.6-.6 6.4-.6 3.8-.3q3.7-.4 7.2-1.4h8v-2l3.2-.4 4.1-.5 2.1-.3q4.4-.4 8.6-1.8l8.9-.8a542 542 0 0 0 35-4.4l3-.5q4.5-.4 9.1-.3zM1190 283a70 70 0 0 1 14.6 6.3l3.2 1.7 3.4 1.7q13.6 7.3 26.8 15.3l-1 2 9 3c-9.7 2.4-19.8-3.4-28.3-7.6l-3.3-1.6c-23.3-11.5-23.3-11.5-25.4-15.8h3z"/>
            <path fill={CAR_GOLD} d="m234 460-1 3-2.9.1q-12.7.5-25 2.9-5.6 1.2-11.1 1l.6 2.8c.4 3.2.4 3.2-.6 6.2l2 1-1 3v-2l-3 1c-2.7.9-4.7 1-7.6 1q-6.4 0-12.7.9l-4.8.5-7.3.9-7.1.8-2.2.3q-7.6.8-15.3.6c2.9-1.6 5.4-2.4 8.7-3l2.7-.6 3-.5 3-.6 9.7-1.9 9.7-1.8 6-1.2 2.8-.5 2.4-.4c2-.5 2-.5 4-1.5h6v-7l14.1-2.1 4.8-.8 7-1 2.1-.3q6.5-1 13-.8"/>
            <path fill="#0a0a0a" d="M177 422h6a90 90 0 0 1 3.9 15.1l2.2 12.4a73 73 0 0 0 2 9.1q1.6 6.5 1.9 13.4h-6l-3.3-14.5-1.1-4.9-1.7-7-.5-2.2-1-4.2-1-4.6-.5-2.4-.5-2.2q-.7-4-.4-8"/>
            <path fill={CAR_BODY} d="M524 406v2a1171 1171 0 0 1-31.7 4.5c-23.1 3-23.1 3-30.1 5.6-4.4 1.3-8.6 1.4-13 1.5l-2.7.1-6.5.3 4 7h13v1q-.9 0-1.7.3l-7.6 1.1-2.6.5-2.6.4-2.3.3-6.2 1.4-6-12 74.2-11.4 8.7-1.3 2.6-.4 2.5-.4 2-.3c2-.2 2-.2 6-.2"/>
            <path fill="#d4af37" d="m847 263-1 3 4 1-3.2.3a500 500 0 0 0-32.5 4.3q-9 1.5-17.9 2.2-4.5.4-9.1 1.3-6.6 1.1-13.3.9c11.2-7.4 26.5-8.4 39.4-10l9.3-1.1 6-.8q1.4 0 2.8-.3 7.8-1 15.5-.8"/>
            <path fill={CAR_BODY_LIGHT} d="m698 240 2 .9 5 2.1v1c-9.2 2.4-15 1.8-23.7-1.8a25 25 0 0 0-10.8-1.3c-4.5.2-9-.4-13.5-.9 12.1-13.3 27.2-6 41 0"/>
            <path fill={CAR_BODY} d="M256 400v1a1803 1803 0 0 1-57.7 12l-2.5.5-7 1.3-2 .3c-4.7.9-4.7.9-5.8.9v-6q11.9-2.5 23.9-3.9l8-1 2-.3q12.5-1.6 25-3.6 8-1.4 16.1-1.2"/>
            <path fill={CAR_BODY_LIGHT} d="M392 239v2l-6 2 1 2-2.5.4q-11.6 1.6-23.3 3.4l-12 1.7-11.5 1.7-4.4.6q-13.4 2-26.6 4.6-5.9.9-11.7.6c3-2 4.3-2.4 7.7-2.9l3-.5 3.6-.5c18-3 36-6.7 54-10.3l3.6-.8 6.7-1.3c13.1-2.7 13.1-2.7 18.4-2.7"/>
            <path fill={CAR_GOLD} d="M258.2 425h5.8l-1.4 4.4-.8 2.4c-.8 2.2-.8 2.2-2.8 4.2l-1 7c-3.2 1-6 1.1-9.3 1H244c.5-6.4 1.8-12.4 5-18 3.3-1 5.7-1.1 9.2-1M593 375l-1 21q-27.9 4.6-55.8 8.6l-9.2 1.3c-17.3 2.5-17.3 2.5-26 3.1 3.9-3.9 10-4 15.3-4.1l8.7.1v-2l2.4-.2 3-.2 3.1-.3c2.5-.3 2.5-.3 3.5-1.3l6.2-.9 4-.5q1.2 0 2.3-.3l13.8-1.8 2.8-.4q8.5-1.1 16.9-2.8c2-.3 2-.3 6-.3l-.1-3.4c0-4.7 1-9 2.1-13.6l-2.7.4c-7.2 1.1-14 1.9-21.3 1.6v-1l10.2-1.5 2.9-.4 2.8-.4 2.6-.4c2.5-.3 2.5-.3 7.5-.3"/>
            <path fill={CAR_GOLD} d="M249.3 459h4.7c.1 5.7.2 11.4-1 17-2.8 1.4-5 1.1-8.1 1H239v-17c3.8-.8 6.6-1.1 10.3-1"/>
            <path fill={CAR_BODY_LIGHT} d="m811 397 .2 1.9c3.3 31 3.3 31 9 45 .8 2.1.8 2.1.8 5.1-1.8-.2-1.8-.2-4-1-8-12-10.2-28-10-42v-8c3-1 3-1 4-1"/>
            <path fill="#6fbcff" d="m711 279 3 3-2.5.4-23.1 4.2-12 2.1-11.5 2-4.3.9-4.2.7-5.8 1-6.9 1.3-2.9.6-2.5.4q-5.1.7-10.3.4c3.2-2.1 5.3-2.6 9-3.3l3.8-.7 2-.4 10.2-2 2-.4 17.9-3.8 5.5-1.2 8.9-2 10-2 3-.8 3-.6 2.5-.5c2.2-.3 2.2-.3 5.2.7"/>
            <path fill="#d4af37" d="M445 429q2.6 4 4.5 8.3l1.3 2.8q1.7 4.5 3.2 8.9l-13 2-3-8.3-.9-2.4-.8-2.3-.7-2.1c-.6-1.9-.6-1.9-.6-4.9z"/>
            <path fill={CAR_BODY_LIGHT} d="M546 436a16 16 0 0 1-8.9 4.1l-2.9.5-3 .5-3.3.5q-12.3 1.9-24.8 2.7c-4.5.3-8 1-12.1 2.7l-7.3.5q-6.9.2-13.6 2-4.5.9-9 1c-15.6 1-15.6 1-19.1 4.5l-1-4c9-2 18-3.2 27-4.5l4.9-.7 12.9-2 20.5-3 7.2-1 4.4-.6 2.1-.3 15.5-2.5q5.3-.7 10.5-.4"/>
            <path fill="#0a0a0a" d="m954 412 10 3c-2.2 7.7-8.5 13.1-15.1 17.2-1.9.8-1.9.8-5.9.8a27 27 0 0 1-1-10q2.5-2.8 6-4.7c2.6-1.7 4.2-3.8 6-6.3M325 436q1.5 5.4 1 11a21 21 0 0 1-6 4.7 21 21 0 0 0-6 6.3l-9-3a33 33 0 0 1 15-18c2-1 2-1 5-1M966 371c3.2 7.2 4.1 13 4 20.8v8.2c-3.4-1-6-2-9-4-.7-3-.7-3-1.1-6.8-.9-7.1-.9-7.1-1.6-10-.3-2.2-.3-2.2.8-4l1.7-1.5 1.7-1.6c1.5-1.1 1.5-1.1 3.5-1.1M319 502q3.9 1.9 7.4 4 4.2 2.4 8.6 4l1 10c-9.7 1-16.7-5.2-24-11 1.3-4 3.5-4.8 7-7M337 434c10 .5 17.6 4.2 25 11-1.5 4.4-4 4.9-8 7l-3-2.3c-2.8-2-5-3-8.3-3.9-2-.6-2-.6-3.7-1.8a33 33 0 0 1-2-10M891 382l5 2 2.1.7c1.9 1.3 1.9 1.3 2.5 4.2v3.4c.4 6.5.4 6.5 1.1 9.4.3 2.3.3 2.3-.8 4.1l-1.7 1.5-1.7 1.6C896 410 896 410 894 410a57 57 0 0 1-4-26z"/>
            <path fill={CAR_BODY_LIGHT} d="M1045 247h6.1l3.5-.1q4.7.1 9.4 1.1v2l1.7-.1c10-.3 19.7 2 29.1 5.4q6 1.8 12.2 2.7v2l2.9.4c13 1.9 13 1.9 19.1 5.6q3.5.8 7 1.5c2 .5 2 .5 4 2.5a58 58 0 0 0 8.5 3c5.8 1.7 5.8 1.7 8.5 3l1 3q-11.3-3.2-22.2-7.7a374 374 0 0 0-34.2-11.6l-7-2c-16.2-4.7-33-7-49.6-9.7z"/>
            <path fill={CAR_BODY_LIGHT} d="M1081 246v1h-13v2h5v1h-9v-2h-2.4q-27.4-.7-54.6-3v-1c24-2 50.3-3 74 2"/>
            <path fill={CAR_GOLD} d="m722 389 3 1h-2v17l5.7-1q6.9-1 13.9-1.5 7.6-.5 15.3-2 7.1-1.1 14.4-2c2.7-.5 2.7-.5 3.7-1.5q4.7-.9 9.4-1.5l2.9-.4q13.3-1.7 26.7-2.1c-3.7 2.4-7 2.8-11.4 3.4l-2.5.4-8.5 1.2-5.9.9-12.3 1.8-15.8 2.3-12.1 1.8-5.9.8-8.1 1.2-2.5.4q-5 .8-10 .8z"/>
            <path fill="#6fbcff" d="m844 309-1 5-2 .3-20.2 2.6-7.6 1-7.3 1-7.2.8-14.6 2-4 .5-3.1.5a83 83 0 0 1-10 .3v-1l1.8-.3 18.8-3.3 7-1.2 10.2-1.8 3.4-.6 24.3-4.6q5.7-1.3 11.5-1.2"/>
            <path fill={CAR_BODY_LIGHT} d="m825 362-1 5-1-2-3.6.9a197 197 0 0 1-30.9 3.9c-2.5.2-2.5.2-4.5 1.2l-11.2 1.2q-5 .3-9.7 1.9c-4.5 1.3-8.8 1.1-13.5 1h-2.8l-6.8-.1v-1l2.7-.4 45.2-6.7 3.1-.5 12-1.9 8.3-1.2 2.5-.4q5.6-1 11.2-.9"/>
            <path fill={CAR_GOLD} d="m848 340-2 9.8a12 12 0 0 1-5 7.2c-2.4.6-2.4.6-4.7.8l-2.5.1-1.8.1q-.2-7 1-14l1-1-2-2 5.8-.5 3.2-.3z"/>
            <path fill="#d4af37" d="m424.5 402.5 3.5 3.5 2 1.8c3.4 3.2 5.4 5.7 7 10.2l3 1a26 26 0 0 1-12 1c-3-2.7-4.9-5.5-7-8.9a48 48 0 0 0-7-8.1v-2c4.5-1.3 7-1.5 10.5 1.5"/>
            <path fill="#dcdcdc" d="M992 252v1h-2q-10.3 0-20.6.3h-7.7c-18.7.2-37 1.3-55.5 4.8q-6 1.1-12 1.3l-3.4.1-3.5.1-3.6.1-8.7.3v-1c10.4-2.4 20.9-3.8 31.5-5.2l3.3-.4c27.4-3.4 54.6-2.6 82.2-1.4"/>
            <path fill={CAR_BODY_LIGHT} d="M259 346v2l-7 2 2 2-3.8.9c-44 10-44 10-64.2 15.1 2.3-2.7 4.2-3.6 7.6-4.6l2.8-.7 3-.9 3.1-.9 10-2.8 6.7-1.8 15.8-4.5 8.5-2.4 2.5-.7 4.6-1.3a29 29 0 0 1 8.4-1.4"/>
            <path fill={CAR_BODY} d="m258 445-2 11a54 54 0 0 1-16 2l2-12c5.6-1 10.3-1 16-1"/>
            <path fill={CAR_BODY_LIGHT} d="M546 379h14v1a887 887 0 0 1-41.4 6.3q-12 1.5-24 3.5l-3 .4-15 2.4c-9.5 1.5-19 3-28.6 3.4a48 48 0 0 1 24-4v-2l3.2-.4 4.1-.5 2.1-.3q4.4-.4 8.6-1.8l8.9-.8q15.7-1.5 31.3-3.9l3.6-.5 3.2-.5q4.5-.4 9-.3zM1055 256c7-.5 13.2 1.4 20 3.2l3.6 1c21.5 5.7 21.5 5.7 31.4 9.8-3.3 1.1-5 1-8-.4-2.7-1.2-4-1.6-7-1.6l5 3c-2 1-2 1-5.6 0l-4.7-1.6c-10.7-3.6-21.6-6-32.7-8.4v-1a59 59 0 0 1 20 3v-2l-2.3-.4q-10-1.5-19.7-3.6z"/>
            <path fill="#ffffff" d="M186 468h1v5a814 814 0 0 1-31.3 6.7l-4.9 1L139 483h13v1c-8.6 2.5-17 2.2-26 2 3.3-3 6-4.6 10.3-5.6l3.1-.7q7.3-1.5 14.6-2.6 4.6-.7 9-2.1a52 52 0 0 1 10.6-2q6.3-.8 12.4-2z"/>
            <path fill={CAR_GOLD} d="M839 374c.4 12.1.4 12.1-2 16q-4.4 1.5-9 2c-1.5-3.1-.8-6.3-.6-9.6l.2-2.2.4-5.2a71 71 0 0 1 11-1"/>
            <path fill={CAR_BODY_LIGHT} d="m844 359-2 12c-9.6 2.3-9.6 2.3-14 2-.1-8-.1-8 1-12l5.3-1 2.9-.6c2.8-.4 2.8-.4 6.8-.4"/>
            <path fill="#6fbcff" d="m238 516 19 7c-2 3-2 3-5.7 4.1-17.7 3.4-17.7 3.4-25.3-.1h-2v-2l6.2-1 3.5-.6q4.2-.5 8.3-.4c-.3-2-.3-2-1-4l-3-1z"/>
            <path fill="#d4af37" d="m853 337-3.7 10.4-1 3-1 3-1 2.6c-1.3 2-1.3 2-4 2.8l-2.3.2 3-1 .3-2.2.5-2.9.5-2.8c.8-3.6 2.2-6.7 3.7-10.1a1208 1208 0 0 0-43.6 6.2q-8.6 1.3-17.4.8v-1l2-.3 9.5-1.4 3.6-.5q10.3-1.4 20.6-3.2l2.1-.3 10.6-1.7 3.9-.7 3.4-.5q5.2-.6 10.3-.4"/>
            <path fill={CAR_GOLD} d="M533 417a13 13 0 0 1-7 2.8l-2.4.3-2.5.3a125 125 0 0 0-16.3 3.2 72 72 0 0 1-16.5 2.1c-3 .1-5.4.3-8.3 1.3l-6.5.4q-6.7.4-13.3 1.7c-4.8 1-9.3 1-14.2.9v-1l30.5-4.7 14.1-2.2 13.7-2 5.2-.9 7.3-1.1 2.2-.3a82 82 0 0 1 14-.8"/>
            <path fill="#ffffff" d="m1097.6 295.1 5.4 1.9 3 1v4h-5v-2c-14.1-4.9-14.1-4.9-22-4-2.6 1.5-2.6 1.5-4 3 1 7.4 1 7.4 2 11-4.2-1.5-5.9-4.1-8-8-.6-2.6-.6-2.6 0-5 8.6-8.2 18.4-5.3 28.6-1.9"/>
            <path fill={CAR_BODY_LIGHT} d="m262.6 420.9 5.4.1-1 2q-4.5.8-9.2 1.2-22.5 2.7-44.9 6.4l-3 .4-5.5.9q-7.2 1.1-14.5 1.8c-1.9.3-1.9.3-4.9 1.3v-3l2-.1 2.8-.3 2.7-.2c2.5-.4 2.5-.4 5.5-2.4 3.1-.2 3.1-.2 6.7-.1h3.6l2.7.1v-2l3-.3 11.4-1.3 4.9-.5c8-1 15.8-1.8 23.7-3.5q4.3-.8 8.6-.5"/>
            <path fill={CAR_GOLD} d="M1035 249c16.4-.6 34.2.4 50 5l2 2c-8.5-.3-16-1-24.3-3.4-4-.9-7.6-.8-11.7-.6q6.2 1.8 12.6 2.4a31 31 0 0 1 11.4 3.6c-4 1.5-7.4.6-11.4-.2l-2.1-.4-6.7-1.3-4.6-1-11.2-2.1v-2zM593 410c2 3.1 3.3 6 4.6 9.6l1.4 3.5c1 2.9 1 2.9 1 4.9l-26.5 3.9-12.3 1.8-16.4 2.3Q533 438 521 439c2-2 2-2 5.1-2.1l2.9.1v-2q13.8-2.4 28-3.2c6-.4 11.3-1.2 17-2.8q4-.7 8-1.1l2-.3q6.5-.7 13-.6l-.9-2.7-1.1-3.6-1.1-3.5c-.9-3.2-.9-3.2-.9-7.2"/>
            <path fill={CAR_BODY_LIGHT} d="m383 258-16 8-2.1 1.1c-6 2.9-14.3 2-20.9 1.9 1.8-2 1.8-2 4-4h4v-2l10.6-2.4 3-.7c14.5-3.4 14.5-3.4 17.4-1.9"/>
            <path fill="#6fbcff" d="m1236 320 2.5.6c3.3.4 6 .1 9.3-.3q5.7-.6 11.2-.3v1l-1.8.3-18.6 3-7 1.1-9.9 1.7-3.1.4q-8.3 1.5-16.3 3.2c-2.7.4-4.7 0-7.3-.7l-6-1 1-2 3.8.2c6.2 0 12-1 18.2-2q7.8-1.5 15.8-2 4.2-.4 8.2-1.2z"/>
            <path fill={CAR_BODY_LIGHT} d="M936 391h6c-.2 6.7-1.1 10.3-6 15-3.7 1.9-8 1.6-12 1a15 15 0 0 1-7.4-7.8l-.6-2.2h2l2.2 2.5c2.8 2.5 2.8 2.5 6.4 3 3.4-.5 3.4-.5 5.7-2 2.1-3 2.9-6 3.7-9.5"/>
            <path fill={CAR_BODY} d="M786 453a26 26 0 0 1-11.3 3l-4.6.6-2.5.3a1481 1481 0 0 0-58.7 8.3l-5.3.9q-5.8 1-11.6.9c7-4 15.4-4.6 23.2-5.5l6.1-.8 3-.3c15.3-2 15.3-2 16.7-3.4l6.4-.4q9.2-.5 18.4-2.2A87 87 0 0 1 786 453"/>
            <path fill={CAR_BODY_LIGHT} d="m999 248 1 3-59 1v-1c19.7-3.1 38-4.6 58-3"/>
            <path fill="#1e1e1e" d="M524 406v2a1171 1171 0 0 1-31.7 4.5c-23.3 3-23.3 3-30.1 5.6-4.4 1.3-8.5 1.1-13 1h-2.7l-6.5-.1v-1l57.8-8.9 6.7-1 3.8-.6c10.6-1.5 10.6-1.5 15.7-1.5"/>
            <path fill="#6fbcff" d="M230 480h9l1.5 11.6.4 3.3.4 3.3.4 3q.5 4.3.3 8.8h-3c-3.2-9.8-6-18.5-5-29z"/>
            <path fill={CAR_GOLD} d="M519 439v1l-49.2 7.4-5.6.9-3.3.5c-2.9.2-5.1 0-7.9-.8v-1l2.9-.4 3.7-.5 3.8-.5c3.6-.6 3.6-.6 6.5-1.6 5.1-1.7 10.4-2.3 15.8-3.1l3.6-.6q14.9-2 29.7-1.3M774.6 366.9l12.4.1c-3.7 2.3-7.5 2.7-11.7 3.2l-2.4.3-7.3 1-7.6 1-5 .6-21.9 3q-6 1-12.1.9v-5l2 1v2l3.9-.8q18.1-3.4 36.5-5.2l3.4-.4 3-.3c3.3-.5 2.9-1.3 6.8-1.4"/>
            <path fill={CAR_BODY_LIGHT} d="M838.4 336.9h2.3l5.3.1v1l-45.6 7q-13.1 2.2-26.4 3v-2l3.6-.3 4.8-.5 2.3-.2q6.3-.6 12.2-2.5a65 65 0 0 1 15.8-2.6c9.4-.6 9.4-.6 14-2 4-1 7.6-1.1 11.7-1M343 477h5c-.2 5.8-.6 9.7-5 14-3.8 1.9-8 1.8-12 1-2.6-2-4.3-4.3-6-7l1-2 2.1 2c3.4 2.4 4.9 2.7 8.9 2 3.7-2.7 4.8-5.6 6-10M310 272v3q-17.2 3-34.6 5.8l-7.8 1.2-5 .8-2.4.4q-6 1-12.2.8v-1l21.6-4.3 10-2 11.6-2.3 3.6-.7 3.4-.7 3-.6q4.4-.6 8.8-.4M1234 313c9.1-.3 16.2 1 24 6v1l-19 2v-3l-5-2z"/>
            <path fill="#ffffff" d="M1190 283a68 68 0 0 1 11.5 4.7l3.1 1.6 3.3 1.8 3.3 1.7q13 6.9 25.8 14.2c-4 1.3-6.3 0-10-1.7l-2-1a280 280 0 0 1-20-10.2 88 88 0 0 1-15-10.1z"/>
            <path fill={CAR_BODY} d="M780 285c-2.2 2.2-3 2.4-6 3q-1.2 0-2.5.4l-2.7.5-2.8.5-9 1.6-3 .5q-19 3.4-38 6.5c1.6-2.6 2.5-3.8 5.5-4.8l6.3-1 3.6-.6 3.7-.6 19.7-3 7.6-1.2 3.6-.5 3.3-.5 3-.5q3.8-.4 7.7-.3"/>
            <path fill={CAR_BODY} d="m834 447 3 6-16 2-1-4-1.9.2q-8.5 1-17.1.8v-1l11.7-1.7 6-.9 3.7-.5 3.5-.5q4-.6 8.1-.4"/>
            <path fill="#1e1e1e" d="M1279 445v1q-9 2.1-18.2 3.3l-2.5.4-5.2.6-8 1.1-5 .7-2.4.3-5.7.6-1-1-7-1v-1l18.2-2.1 6.2-.8 8.9-1 2.8-.3q9.4-1.2 18.9-.8"/>
            <path fill="#1e1e1e" d="m130 417-21.5 2.7-10 1.3-11.6 1.5-3.6.4q-8.1 1.2-16.3 1.1v-1l23.3-3.9 7.9-1.3 21.2-3.6c4.2-.3 7 .9 10.6 2.8"/>
            <path fill={CAR_GOLD} d="M978 255h19.4l7-.1h2.2c5.2 0 5.2 0 7.4 1.1l10.4.7 5.6.3v1h-8v2h-4.3l-2.4.1c-2.3-.1-2.3-.1-5.3-1.1l-4.7-.5-2.9-.2-3-.3-5.7-.5L978 256zM267 422a143 143 0 0 1-4.5 12l-4.5 11-15 1 1-4v2l14-1v-7l2-2 3-7 1-2q-3.8 0-7.4.3h-2c-2.1 0-2.1 0-5.6.7-1.5 2-1.5 2-2 4l-1-2c-2.3-.4-2.3-.4-5-.6l-2.8-.2-2.2-.2v-1l11.8-1.7 4-.6 9.3-1.3c2.9-.4 2.9-.4 5.9-.4"/>
            <path fill={CAR_BODY_LIGHT} d="M1157 290q18 8.2 35 18l-4 1v2l3 1-2 1c-1.9-.8-1.9-.8-4.1-2l-2.5-1.5-2.5-1.4-8.9-5.1c3.8-1.1 3.8-1.1 6 0v-2l-2.5-.8q-5.6-2-10.9-4.8l-2-1-4.6-2.4z"/>
            <path fill="#6fbcff" d="m1195 329 1 2c-11.7 3-11.7 3-16 3.5-3.2.5-4.7 1.3-7 3.5l-1-1-1 8h-1l-.2-5.8-.2-3.3c.4-2.9.4-2.9 2.2-4.7 6.8-3.7 15.8-2.3 23.2-2.2"/>
            <path fill={CAR_BODY_LIGHT} d="m217 410-1 1 4 3c-5 1.2-10 1.3-15 1.5q-12 .5-24 1.5l1-2q3.3-.9 6.7-1.5l2-.4 4.4-.9 6.6-1.2 4.2-.9 3.8-.7c3-.3 4.6-.4 7.3.6"/>
            <path fill={CAR_BODY} d="M192 367c-3 2-3 2-6 3a17 17 0 0 0-6 8c-1.1 8.2-.6 17 1 25l2.3-.4A87 87 0 0 1 202 401v1l-8.7 1.5-2.5.4q-5.8 1.2-11.8 1.1c-4.9-23.3-4.9-23.3.3-31.7 1.3-1.8 1.3-1.8 2.7-3.3l1.4-1.7c2.6-2.2 5.4-1.5 8.6-1.3"/>
            <path fill={CAR_BODY_LIGHT} d="M413 236c-2.6 3.7-4.5 5.7-9 6.6a115 115 0 0 1-20 1.4c2.7-3 2.7-3 5.7-3.2l2.3.2v-2a67 67 0 0 1 21-3M594 373c3.1 6.3.9 16.3 0 23h-2v-10.6l-.1-2.3v-2q.2-3.1 1.1-6.1l-2.3.4-10.3 1.6-3.5.6c-5.7.9-11.1 1.7-16.9 1.4v-1l2-.4 2.4-.5 2.5-.6c2.1-.5 2.1-.5 3.1-1.5a231 231 0 0 1 24-2"/>
            <path fill={CAR_GOLD} d="M500 409v1l-22.6 3.4-7.7 1.2-11.1 1.6-3.5.6A93 93 0 0 1 438 418v-1l3.1-.6 4.3-.8 2-.4q4.5-.7 9-1.7 9.7-2 19.5-3.1l3-.4q10.5-1.4 21.1-1"/>
            <path fill="#6fbcff" d="m1151 321 3 2v3c-15 .3-29.4.5-44-3v-1l41 1z"/>
            <path fill="#d4af37" d="m806 269-1 1 5 1v1l-3 .4-4.2.5-2.2.2-13.7 2q-6.4 1.1-12.9.9c3.4-2.3 6.8-3.4 10.6-4.6l2.2-.6c6.4-2 12.6-3.7 19.2-1.8"/>
            <path fill={CAR_GOLD} d="M1087 256c4.5-.2 8 .4 12.4 1.8l3.6 1.1 3.9 1.2 3.9 1.3q13.8 4.3 27.2 9.6c-3 1-4.5 1-7.7.6l-2.4-.4-1.9-.2v-2l-5-1v-2l-3.4.2a36 36 0 0 1-13.6-3.2v-2l-10-1v-2l-7-1z"/>
            <path fill={CAR_BODY} d="M1248 357a36 36 0 0 1-10 3.5l-3.4.8-3.6.8-3.6.9c-8.9 2-8.9 2-13.4 2v-2l-3 .5q-6.4.8-13 .5v-1l23.5-3.4 8.5-1.3 2.7-.4q7.5-1 15.3-.9"/>
            <path fill="#d4af37" d="M592 408c-3 2-4.4 2.4-7.9 3q-6 .9-11.8 2.5c-12.7 3-26.3 3.7-39.3 3.5v-1l22.8-3.4 7.8-1.2 11.1-1.6 3.5-.6 3.3-.5 2.9-.4q3.7-.4 7.6-.3"/>
            <path fill="#1e1e1e" d="M592 397c-2.4 2.4-3.3 2.4-6.6 2.8q-1.5 0-2.9.3l-3.1.3-6.5.8-3.4.4-16.9 2-3.1.4-2.9.4-2.6.3c-2 .3-2 .3-4 1.3h-11c3.1-1.8 5.9-2.4 9.4-3l3.3-.5 3.6-.5 3.6-.5 7.7-1.1 11.7-1.7 7.4-1.1 3.6-.5 3.3-.5 2.9-.4c2.4-.2 4.2 0 6.5.8"/>
            <path fill={CAR_BODY} d="M256 400v1c-34.7 8.6-34.7 8.6-49 6v-1l17.6-2.6 6-.8 8.5-1.3 2.7-.4q7.1-1 14.2-.9"/>
            <path fill="#1e1e1e" d="M768 480c-.5 2-.5 2-2 4q-4 .9-8 1.3l-2.4.2-7.7.8-5.1.5Q731.9 488 721 488v-1l17.7-3 6-1 8.6-1.5 2.7-.4q6-1.2 12-1.1"/>
            <path fill={CAR_BODY} d="M339 382a64 64 0 0 1-19.6 4c-6.1.5-11.5 1.2-17.4 3-9.4 2-18.4 2.2-28 2v-1l1.8-.2q9.4-1.4 19-2.7l7-1 10.2-1.4 3.1-.4a260 260 0 0 0 17.5-3c2.5-.3 4 0 6.4.7"/>
            <path fill={CAR_BODY_LIGHT} d="M773 348v1l-22.8 3.4-7.7 1.2-11.2 1.6-3.5.6-3.3.5-2.9.4q-3.7.4-7.6.3l2-1v-2q5.4-1.4 11-1.7l4-.4 6.6-.5q12.3-1 24.7-3 5.3-.6 10.7-.4M1041 255h14v2l1.8.1q10.3 1 20.2 3.9v2c-3 .2-5.2 0-8-1-5.3-1.5-10.7-1.8-16.2-2.2a32 32 0 0 1-11.8-2.8zM922 261c-3.7 2.5-6.9 2.4-11.2 2.6q-6.1 0-12.2 1-7 .6-14 .5h-2.8l-6.8-.1v-2q23.4-2.5 47-2"/>
            <path fill={CAR_BODY} d="M1243 326v1l-3 .4-4 .5-3.8.6c-3.2.5-3.2.5-4.2 1.5l-5.6.5-3.4.3-3.7.3-3.6.2q-7.8.7-15.7.7c5.3-3 11.4-3.6 17.3-4.7l3.8-.7c9-1.5 17-2.1 25.9-.6"/>
            <path fill={CAR_BODY_LIGHT} d="M233 481a22 22 0 0 1-8.5 2.8l-5.3.7c-12.2 1.6-12.2 1.6-17.2 3.5l-1 3h2v2h2v2l1.9.6L217 499v2c-8.4-2-14.2-4.7-19-12v-3c11.5-2.9 23.1-5.5 35-5M546 436c-3 2.6-5.3 3.5-9.2 4.2l-3.1.5-3.2.5-3.1.5A111 111 0 0 1 506 443c3.6-2.4 6.8-2.8 11-3.5l2.2-.4 10.3-1.7c5.6-1 10.8-1.6 16.5-1.4M606 307v2l-4 1 9 1v1l-10.8 1.7-3.1.5-3 .4-2.7.5c-2.4-.1-2.4-.1-4-1.5L586 312l-3-2 9.3-1.5 2.6-.4 2.6-.4 2.3-.4c2.2-.3 2.2-.3 6.2-.3"/>
            <path fill="#1e1e1e" d="m205.4 590.5 1.6 1.5-15.4 1.7-5.2.6-7.5.8-2.4.3q-7.2.8-14.5.6v-1l14.6-2.6 5-.8 7.2-1.3 2.2-.4c10.6-1.8 10.6-1.8 14.4.6"/>
            <path fill={CAR_BODY_LIGHT} d="M996 249h16l2 2-7 1v1a1022 1022 0 0 1-40.9-.6L953 252v-1l43-1z"/>
            <path fill="#d4af37" d="M564 380q-11 2.5-22.1 4.6l-2.6.5-2.4.4c-1.9.5-1.9.5-3.9 1.5q-13.5 1.3-27 1v-1l3-.4 10.9-1.6 4.8-.7q15-2 30-4.6c3.4-.6 6-.7 9.3.3"/>
            <path fill={CAR_BODY_LIGHT} d="M1133 280c4.7.6 8.6 2.5 12.8 4.6l2.1 1 5.1 2.4-3 1 1 3q-11.8-3.9-23-9c2.5-.7 4.4-1 7-1z"/>
            <path fill="#d4af37" d="M1020 245v1l-18 1 10.4.5c5.4.3 5.4.3 7.6 2.5l-3.8-.2L976 248v-1a294 294 0 0 1 44-2M234 460l-1 3-2.9.1q-12.7.5-25 2.9-5.6 1.2-11.1 1l1 6h-8v-1h6v-7l14.1-2.1 4.8-.8 7-1 2.1-.3q6.5-1 13-.8"/>
            <path fill="#6fbcff" d="M345 249v2l-15 2.5-2.6.4-2.6.5-2.5.4-4.8.8-2.3.4-4.3.7-5.3.9q-5.3.7-10.6.4a19 19 0 0 1 9.1-3.2l3.8-.6a392 392 0 0 0 30.2-5.7c2.8-.5 4.3-.4 6.9.5"/>
            <path fill="#1e1e1e" d="M823 487v1l5 1v1l-15.8 1.7-5.4.6-7.7.8-2.4.3q-7.3.8-14.7.6v-1l15.1-2.6 5.1-.8 7.4-1.3 2.3-.4q5.6-1 11.1-.9"/>
            <path fill={CAR_GOLD} d="m740 354-2 1v2a94 94 0 0 1-22 2l.7 1.8.9 2.4.8 2.4c.6 2.6.5 4-.4 6.4l-2.5-5.8-1.4-3.3C713 360 713 360 713 357l9-1.5 2.5-.4A80 80 0 0 1 740 354"/>
            <path fill={CAR_BODY_LIGHT} d="M806 376v1l-23.1 3.4-8.4 1.3-2.7.4q-5.9 1-11.8.9v-2a79 79 0 0 1 16.7-2.7c2.3-.3 2.3-.3 4.3-1.3l8.1-.6h2.3q7.2-.5 14.6-.4"/>
            <path fill={CAR_GOLD} d="M1058 269c11.4 1 21.3 3 32 7v2l2 .6 2.8.8 2.6.8q3.5 1 6.6 2.8c-2 1-2 1-5.7-.2l-5-1.8a508 508 0 0 0-35.3-11z"/>
            <path fill="#6fbcff" d="M669 240c8.3-.7 15.6 1.4 23 5l1 3c-6.9 1.5-10.5.4-16.5-3l-2.2-1.1-5.3-2.9z"/>
            <path fill={CAR_BODY_LIGHT} d="M329 321v1l-2.1.5c-33.3 7.5-33.3 7.5-46.7 12q-3.6.8-7.2.5c2.3-2.3 3.7-2.7 6.9-3.6l3-.8 3.3-1c.5 0 .5 0 3.4-.8a482 482 0 0 1 26-6.4c4.5-1 8.7-1.7 13.4-1.4"/>
            <path fill={CAR_BODY} d="M1259 321v1l3.4.3c3.6.7 3.6.7 5 2.3.8 3.2.7 6.2.6 9.4h-1l-2-10-2.7.4a163 163 0 0 1-28.3 1.6l1-2q4.4-1 8.7-1.6l2.4-.4q6.5-1.2 12.9-1"/>
            <path fill="#d4af37" d="m168 478-3 1 9 1v1l-12.3 1.3-4.2.4q-11.2 1.4-22.5 1.3c5.1-2.9 10.8-3.6 16.5-4.7l3.5-.7 3.3-.7 3-.6c2.6-.3 4.3-.1 6.7.7"/>
            <path fill={CAR_BODY_LIGHT} d="m1185 286 11.4 6.6 2.1 1.3 1.5 1.1v2c-8.9-.1-15.4-3.9-23-8 2.5-.7 4.4-1 7-1z"/>
            <path fill={CAR_BODY} d="m1172 364 1 4q-14.7 8.9-30.4 15.6l-1.8.8c-10.4 4.6-10.4 4.6-12.8 4.6v-2l3.4-1.4c14.7-5.9 14.7-5.9 20.8-9.7 1.8-.9 1.8-.9 5.8-.9v-2l2.8-1.2 3.6-1.6 3.7-1.6c2.9-1.6 2.9-1.6 3.9-4.6"/>
            <path fill="#d4af37" d="M1178 320c7.5.6 7.5.6 10 2.4 1 1.6 1 1.6 1 3.6l15-1v-3l-3-1 2-1q3.7 1.8 7 4v2c-10 2.4-17.4 3.9-26.6-1.4l-5.4-3.6z"/>
            <path fill={CAR_BODY_LIGHT} d="M810 397c-9.1 8.2-26.5 6.4-38 6v-1l13.3-2.1 4.6-.8 6.5-1 2-.3q5.9-1 11.6-.8"/>
            <path fill="#1e1e1e" d="M1055 256c4.8-.2 9 .3 13.6 1.5l3.6 1 3.7 1 3.8 1 9.3 2.5v1l-9-1v2c-7.9-.5-15.3-2-23-4v-1a59 59 0 0 1 20 3v-2l-2.3-.4q-10-1.5-19.7-3.6z"/>
            <path fill={CAR_BODY_LIGHT} d="M782 369c-3.8 2.3-7.9 2.8-12.1 3.6-7.7 1.3-7.7 1.3-9.9 2.4l-4.6.1H747l-7-.1v-1l14-2.1 4.9-.8 6.9-1 2.1-.3a84 84 0 0 1 14.1-.8"/>
            <path fill="#d4af37" d="M865 261v1l10 1v1c-20 2.3-20 2.3-29 2l1-3a67 67 0 0 1 18-2"/>
            <path fill={CAR_GOLD} d="M1095 271c7.4 1.4 14.1 3.8 21.1 6.4l3.2 1.2q8 3 15.7 6.4c-3.5 1.1-4.3.8-7.6-.3l-2.7-1-2.9-1-2.8-.9q-8-2.7-16-5.8v-2l-2.9-.4c-3.1-.6-3.1-.6-5.1-2.6"/>
            <path fill="#6fbcff" d="m238 516 5.2 1.9 3 1 7.8 3.1-1 3c-5.7 1.1-5.7 1.1-8 0h-15v-1l12-1-1-4-3-1z"/>
            <path fill={CAR_BODY} d="m195 408-1 3 2 2q-7.4 2.3-15 3v-6l4.8-1 2.6-.6c2.6-.4 2.6-.4 6.6-.4M940 289c22.3-.6 38.3 1.3 58 12l-2 1c-2.6-1.1-2.6-1.1-5.7-2.8-5.2-2.8-10-4.9-15.9-5.7-3.4-.5-3.4-.5-5.7-1.5-3.1-1.1-5.6-1.3-8.9-1.4l-3.5-.1-3.6-.1-12.7-.4zM559 279v2l-2.7 1-3.5 1.3-3.5 1.3a59 59 0 0 0-8.3 4.4l-4 1.4c-7 2.7-10.9 6.3-15 12.6l-1-2c5.8-9.5 13.2-12.7 23.3-16.8l3.6-1.5c8.8-3.7 8.8-3.7 11.1-3.7"/>
            <path fill={CAR_BODY_LIGHT} d="M558 314c9.4-.2 9.4-.2 14 1l-1 3-10 2.1c-5.4 1.1-5.4 1.1-8.5 0L551 319l3-.8 3-1.2z"/>
            <path fill="#d4af37" d="m505 389-5.4 1.4-3.1.8-3.5.8-2 .5a89 89 0 0 1-19 2.1l-3.3.1-7.7.3v-1l22.6-3.5 8.3-1.3 2.6-.4 2.4-.4 2.1-.3c2.2-.1 3.9.3 6 .9"/>
            <path fill={CAR_BODY} d="m842 362-1 7c-3.7 1.2-7.2 1-11 1-.2-2.4-.2-2.4 0-5 4-2.6 7.3-3 12-3"/>
            <path fill="#d4af37" d="M784 348c-5 1.3-9.7 2.3-15 2v2c-2.7 1.4-5 1.2-8.1 1.3l-3.7.1-3.8.2-13.4.4v-1l22.6-3.5 8.3-1.3 2.6-.4 2.4-.4 2.1-.3c2.2-.1 3.9.3 6 .9"/>
            <path fill={CAR_BODY_LIGHT} d="M1050 243v1l-15 1 6 1v1q-17-.6-34-2v-1c14.3-1.2 28.6-1.1 43-1"/>
            <path fill={CAR_BODY} d="M790.3 453h3.7v2l-2 .1q-7.2.6-14.1 1.9a125 125 0 0 1-27.9 2v-1l2.9-.4 10.6-1.3 4.5-.5 6.6-.8 2-.3c4.7-.6 9-1.8 13.6-1.8"/>
            <path fill={CAR_BODY_LIGHT} d="M584.5 406.8h2.7c6.6 0 6.6 0 7.8 1.2v5c-2-3-2-3-2-5l-2.4.4-10.8 1.6-3.8.6-3.6.5-3.4.5q-4 .6-8 .4c7.8-4 14.7-5.5 23.5-5.2"/>
            <path fill={CAR_BODY} d="M544 489a32 32 0 0 1-12.8 2.8c-2.2.2-2.2.2-4.2 1.2l-4.7.5-2.9.3-3 .3-2.9.2q-8.7.9-17.5.7v-1l18.6-2.6 6.3-1 9-1.2 3-.4 5-.7q3.1-.1 6.1.9"/>
            <path fill="#d4af37" d="M489 424a58 58 0 0 1-19.5 3.8 73 73 0 0 0-9.3 1.3c-4.8 1-9.3 1-14.2.9v-1l16.4-2.6 5.6-1q4-.5 8-1.2l2.6-.4 4.4-.7q3.2 0 6 .9"/>
            <path fill={CAR_BODY} d="M508 267h1v3.3l.3 12v5l.2 7.5v2.4c.2 5.4.2 5.4 2 7.7l1.5 1.1c0 2.3 0 2.3-.3 4.7l-.4 2.4-.3 1.9h-3c-1.3-10-1.1-20-1-30.2V267"/>
            <path fill="#d4af37" d="M903 256h9c-7 4.2-16.5 3.3-24.4 3.6l-3.7.1-8.9.3v-1l4-1 2.2-.5q10.8-1.8 21.9-1.6"/>
            <path fill={CAR_BODY_LIGHT} d="M155 422v2l4 1-12.5 1.7-4.3.6-9.9 1.3q-4.2.5-8.3.4c3.1-2 5-2.6 8.7-3.3l3.3-.6 3.5-.7 3.5-.7c8.6-1.7 8.6-1.7 12-1.7"/>
            <path fill="#1e1e1e" d="M559 412v1l-17.2 2.6-5.8.8-8.5 1.3-2.6.4q-6.4 1-12.9.9c3.7-2 7-3 11.2-3.5l2.4-.2 5-.6c6.3-.6 6.3-.6 7.4-1.7q10.5-1.3 21-1"/>
            <path fill={CAR_BODY_LIGHT} d="M465.3 225h3.7c-4.6 2.4-9.5 3.8-14.5 5.3l-2.9 1-2.8.7-2.5.8c-2.3.2-2.3.2-4.6-1.2L440 230l7.7-2 2.2-.5c10.5-2.6 10.5-2.6 15.4-2.6"/>
            <path fill={CAR_GOLD} d="M519 439v1c-12.6 2.3-25.2 2.6-38 3 9.7-6.4 26.8-4.2 38-4M828 267c-6.2 4.1-11 4.3-18.3 4.1h-2.8l-6.9-.1v-1c8.8-3.6 18.6-3.2 28-3"/>
            <path fill={CAR_BODY_LIGHT} d="M506 236c1.6 3.2 0 5.7-1 9a278 278 0 0 0-3 34l-3-1c2.2-37.2 2.2-37.2 7-42M369 247c-9 2-17.7 3.5-27 3a27 27 0 0 1 27-3"/>
            <path fill="#6fbcff" d="M292 395c-5 5.1-5 5.1-8 7l-3-1 1-3-3.1.7-4 .8-2.1.4c-3.7.8-7 1.3-10.8 1.1 2.4-2.4 3.6-2.5 6.9-3l3-.5 3.1-.5 3.2-.6A68 68 0 0 1 292 395"/>
            <path fill={CAR_BODY_LIGHT} d="M614.2 306h4.8l-1 3 2 1c-3.9 1.3-7.7 1.1-11.8 1H601l1-2h4v-2c3-1 5-1.1 8.2-1M1041 266a106 106 0 0 1 22 4.6l3.5 1 8.5 2.4a22 22 0 0 1-11.6-.2l-2.1-.5c-16.5-3.3-16.5-3.3-20.3-7.3M436 233v2c-5.6 2.3-11 2.6-17 3v-2l-5-1v-1a57 57 0 0 1 22-1"/>
            <path fill="#6fbcff" d="M237 447h5l-2 12h-6z"/>
            <path fill="#d4af37" d="M246 429c1.6 4 .4 6.8-1 10.8l-1 3.5-1 2.7-5 1c.5-4.6 1.7-7.8 4-11.8l1.6-3c1.4-2.2 1.4-2.2 2.4-3.2"/>
            <path fill={CAR_BODY_LIGHT} d="M600 428a18 18 0 0 1-8.2 3.1l-2.7.5-2.1.4v1h-20v-1l12-2 3.4-.6c6-1 11.6-1.6 17.6-1.4"/>
            <path fill="#1e1e1e" d="M1128 295c4 .6 7.2 2 10.8 3.7l3.4 1.7 3.5 1.8 3.4 1.7q10.2 5 19.9 11.1l-2 1c-2.6-1-2.6-1-6-2.8l-1.8-1-21-11-10.2-5.2zM362 466c2.5 1.9 3 2.8 3.5 6l.3 3.4c.7 6 .7 6 2.9 8.6 2 1.3 2 1.3 5.3 3-3.4 1.1-4 1-7.1-.4-2.5-1.5-3.7-2.7-4.4-5.5q-.8-7.5-.5-15.1"/>
            <path fill="#d4af37" d="m1126 276 11 1v2l3 .7a48 48 0 0 1 13.4 6.6l4.6 2.7-2 1c-1.9-.6-1.9-.6-4.2-1.7l-2.6-1.2-2.7-1.3q-10.1-4.7-20.5-8.8z"/>
            <path fill={CAR_BODY_LIGHT} d="m189 451 1 3 3-1a59 59 0 0 1 8 0q-3.7 2.1-8 3l1 6 11 1v1l-12 1-1 4z"/>
            <path fill="#ffffff" d="M1190 283a69 69 0 0 1 15.4 7.1l2.5 1.4 6.1 3.5-1 2a55 55 0 0 1-13.7-6.4l-2-1.2c-3.2-2-5.2-3.3-7.3-6.4"/>
            <path fill={CAR_BODY} d="m861 322 2 1c-4.8 10.5-4.8 10.5-9 14-5.2 1.7-10.7.8-16 0v-1l3-.6 3.9-.8 3.8-.9c3.3-.7 3.3-.7 5.3-1.7l2.5-4.5c2.3-4.4 2.3-4.4 4.5-5.5M435 312q11.7 3.4 23 8l-3 1v2a58 58 0 0 1-15.3-7.2L435 313z"/>
            <path fill={CAR_BODY_LIGHT} d="M1193 296c6.5-.5 10.5.3 16.3 3.4 2.2 2 2.4 3.6 2.7 6.6q-6.3-2.5-12.3-5.6l-2-1-4.7-2.4z"/>
            <path fill="#ffffff" d="M1083 293c8.3-.8 15.3 2.2 23 5v4h-5v-2l-18-6z"/>
            <path fill="#d4af37" d="M1052 260c8.5.4 16.3 2.1 24.5 4.4l3.5 1c8.6 2.3 8.6 2.3 12 4.6q-9-1-17.8-3l-2.6-.4-4.6-1c-2-.6-2-.6-5-2.6a71 71 0 0 0-8-1.6l-2-.4zM593 375l-1 21h-1v-19l-6.4 1q-8.8 1.4-17.6 1v-1l10.2-1.5 2.9-.4 2.8-.4 2.6-.4c2.5-.3 2.5-.3 7.5-.3"/>
            <path fill={CAR_BODY_LIGHT} d="m682 357 1 2-3 .2-3.8.2-3.8.3c-5.7.5-5.7.5-8.2 3.4l-1.9 2.5-1.9 2.5-1.4 1.9c-.6-1.8-.6-1.8-1-4 2.6-4 5.2-6.8 9.8-8.5 4.7-1 9.5-.7 14.2-.5"/>
            <path fill={CAR_BODY} d="M680 300h13v2a72 72 0 0 1-19.4 2.7l-5.6.3 1-2c2.5-.6 2.5-.6 5.6-1.1l3-.5 2.4-.4z"/>
            <path fill={CAR_GOLD} d="M1001 246c21.7-.4 21.7-.4 31 2v1q-11.4.2-22.8-.4h-2.1l-5.1-.6z"/>
            <path fill="#6fbcff" d="M803 318v1l-12 1.7-4 .6-9.5 1.3q-5.3.6-10.5.4v-1l17.3-3.3c6.6-1.2 12.2-2 18.7-.7"/>
            <path fill={CAR_BODY} d="M937 291a119 119 0 0 1-25 4.8c-2 .2-2 .2-3 1.2h-9c6.5-4.3 15.3-4.6 22.8-5.7l2.8-.4 2.7-.4 2.5-.4c2.3-.1 4 .2 6.2.9M599 262v2q-10.4 4.9-21 8.9-3 1-5.6 2.3c-2.7.9-3.8.6-6.4-.2l17.6-7.4 6.4-2.8 2-.8c4.8-2 4.8-2 7-2"/>
            <path fill={CAR_BODY_LIGHT} d="M447 396v1l-26.2 4.4-2.2.4c-2 .3-2 .3-5.6.2-2.5-2.5-2.5-2.5-4-5l1.6.5c8.1 1.7 16.6.5 24.6-1q5.9-.9 11.8-.5"/>
            <path fill="#d4af37" d="m1220 311 5.8 2.8 3.2 1.6q3.8 2 7 4.6v2c-5.9 2.6-11.7 2.2-18 2v-1l4.8-1 2.6-.6c2.6-.4 2.6-.4 6.6-.4v-2l-2-.7a85 85 0 0 1-10-5.3zM445 429l1 2-9 1 3.1 9.6c1.8 5.3 1.8 5.3 2.9 6.4a115 115 0 0 0 11 0 13 13 0 0 1-8.2 2.6l-2.7.3-2.1.1-3-8.3-.9-2.4-.8-2.3-.7-2.1c-.6-1.9-.6-1.9-.6-4.9z"/>
            <path fill={CAR_GOLD} d="M233 427h14l-9 19-3-1h2l.3-2q1.4-5.1 3.9-10c.8-2 .8-2 .8-4l-3.4.1c-3.6-.1-3.6-.1-5.6-2.1M1056 250c26.2 1.2 26.2 1.2 31 6-10.8-.3-20.6-2-31-5z"/>
            <path fill={CAR_BODY_LIGHT} d="M499 421v1l-9.6 1.5-2.7.4q-7.3 1.3-14.7 1.1v-2c9-2.6 17.8-2.2 27-2M202 413l6.8.6 3.5.2 2.7.2v1h-1.7q-16.2.7-32.3 2l1-2a106 106 0 0 1 10-2.1 20 20 0 0 1 10 .1"/>
            <path fill={CAR_GOLD} d="M1012 255a263 263 0 0 1 40 4v1l-10.4-.4-6-.3h-2.6c-2-.3-2-.3-3-1.3l-10.2-.5c-5.6-.3-5.6-.3-7.8-2.5"/>
            <path fill="#d4af37" d="m196 480 1 3 3.3-.4c8.3-1 16.3-2 24.7-1.6-3.7 2.3-7.5 2.6-11.7 3l-2.1.3-4.1.5q-5 .5-10.1 1.2z"/>
            <path fill={CAR_GOLD} d="m459 430-9 2 1.4 4.2q1.7 4.8 2.6 9.8h9v1h-10l-3.5-7.4-1-2c-2.5-5.4-2.5-5.4-2.5-7.6l4.3-.6 2.3-.3c2.4-.1 2.4-.1 6.4.9"/>
            <path fill={CAR_BODY} d="m1125 399-6 3 4 2-7.7 1.6-2.3.4c-3.7.8-6.4 1.1-10 0l8.5-3.7c10.8-4.7 10.8-4.7 13.5-3.3"/>
            <path fill={CAR_GOLD} d="m921 257-1 2c-2.9.4-2.9.4-6.7.6l-2 .2-6.4.3-4.3.3-10.6.6v-2a196 196 0 0 1 31-2M822 375l-1 10h-1v-8l-3.9.4-5.1.6-2.5.3q-7.7.9-15.5.7v-1l9.4-1.5 2.7-.4q8.4-1.4 16.9-1.1"/>
            <path fill={CAR_BODY} d="M259 507q5 5 5 12-10.2-2.9-20-7v-1c4.3-.3 7.9.7 12 2v2l5 1z"/>
            <path fill={CAR_BODY_LIGHT} d="M816 432a47 47 0 0 1 4.4 11.7c.6 2.3.6 2.3.6 5.3-1.8-.1-1.8-.1-4-1-2.2-3-3.1-5-2.7-8.6q.7-3.8 1.7-7.4"/>
            <path fill="#6fbcff" d="M825 362h4l-1 11-5 1 .4-4.3.3-2.4c.3-2.3.3-2.3 1.3-5.3"/>
            <path fill={CAR_BODY} d="M524 406h13a24 24 0 0 1-9 2.9q-1.5 0-2.8.3l-3 .4-3 .4q-7.4 1.2-15.2 1c3.8-2.5 7.9-2.4 12.3-2.6l2.2-.1 5.5-.3z"/>
            <path fill={CAR_BODY_LIGHT} d="m287 319 1 3-1.7 1-7.6 4.8-2.6 1.7-2.6 1.6-2.3 1.5-6.2 4.4-2-1c16.1-12 16.1-12 24-17M383 258l-14 7-1-3-3-1v-1l7.9-1.6 2.2-.4c5.7-1.1 5.7-1.1 7.9 0"/>
            <path fill={CAR_BODY_LIGHT} d="M215 360v1l-11.7 3-3.3.8-3.3.8-3 .7-7.7 1.7c3.5-4 7.9-4.8 12.8-6.2l2.7-.9c4.9-1.5 8.5-2.3 13.5-.9"/>
            <path fill={CAR_BODY} d="M1267 334h1q1.2 5.3 1.3 10.6v2.8c-.4 3.1-1 4.4-3.3 6.6-2.7.6-2.7.6-5.7.8l-3 .1-2.3.1c2.2-2.2 3.1-2.4 6-3 3.9-.9 3.9-.9 5-2a217 217 0 0 0 1-16M380 309a16 16 0 0 1-7.3 3l-2.6.5-2.7.5-2.6.5-5.2 1L347 317v-2q5-2.2 10.3-3l3-.6 3.2-.5 3.1-.6q6.6-1.2 13.4-1.3M1192 286c4 1.4 6.8 3.3 10 6l-2 4-11-7 3-1z"/>
            <path fill={CAR_BODY_LIGHT} d="M911.4 263h8.6v1a111 111 0 0 1-26 2l1-2a75 75 0 0 1 16.4-1"/>
            <path fill="#1e1e1e" d="m264 552 1 2-9 1-2.5.3q-7.7.9-15.5.7c4.2-2.3 8.3-3 13-3.7l2.4-.4 2.4-.4 2.2-.4c2.2-.1 3.9.1 6 .9"/>
            <path fill={CAR_BODY_LIGHT} d="M234 459v1l-10.6 1.5-3 .4q-7.7 1.3-15.4 1.1v-1c9.3-4 19-3.3 29-3"/>
            <path fill="#1e1e1e" d="M140 412v1l6 1v1a182 182 0 0 1-23 1 27 27 0 0 1 17-4"/>
            <path fill={CAR_BODY} d="M1115 329h12.1l2.6-.1h2.3c2 .1 2 .1 4 1.1l6.1.6 3.4.2 2.5.2v1q-16.7.4-33-2zM1265 324c1.8 3.2 2.2 5.3 2 9h-2v-6c-2.4-.8-4-1-6.5-.6-5.2.9-10.3.7-15.5.6v-1c7.4-1.3 14.5-2.3 22-2"/>
            <path fill="#6fbcff" d="M654 291c-2.8 2.8-5.9 3-9.6 3.6l-2.1.4q-7 1.3-14.3 1c4-2.6 7.8-3.2 12.4-4.2l2.6-.6 2.6-.5 2.3-.5c2.3-.2 3.9.1 6.1.8"/>
            <path fill={CAR_BODY_LIGHT} d="M1041 255h14l-1 3 2 2c-10.6-.8-10.6-.8-15-3z"/>
            <path fill="#d4af37" d="M829 353h2v6h9v1a78 78 0 0 1-19 2v-1h5l1-2.9c1-3.1 1-3.1 2-5.1"/>
            <path fill={CAR_BODY} d="m1229 328-1 2c-2.4.4-2.4.4-5.6.6l-3.4.3-3.7.2-3.6.3q-7.8.7-15.7.6c10.1-5.4 21.9-4.2 33-4"/>
            <path fill={CAR_BODY_LIGHT} d="M1081 246v1h-13v2h5v1h-9v-2l-3-1a31 31 0 0 1 20-1M237 570v2l-9.6 1-2.7.3q-7.3.8-14.7.7v-1l11.3-2 3.2-.7 3-.5 3-.5a14 14 0 0 1 6.5.7M689 342c6.8 1 11.4 8 15.4 13.1a27 27 0 0 1 4.6 9.9q-4.4-4.3-7.7-9.3c-3.2-4.5-6.6-8-10.8-11.5L689 343zM1162 295c3.8.6 6.9 1.8 10.3 3.6l2.7 1.3 2 1.1v2l-4.7-.9-2.7-.5c-2.5-.6-4.4-1.3-6.6-2.6-.7-2.1-.7-2.1-1-4"/>
            <path fill={CAR_BODY} d="M803.8 448.9h7.2l6 .1v1l-10.4 1.5-3 .4q-8.8 1.4-17.6 1.1c3.2-2.1 4.4-2.3 8.1-2.6 3.8-.2 6-1.4 9.7-1.5"/>
            <path fill={CAR_GOLD} d="M799 347v1l-10 1.5-2.7.4q-8.7 1.3-17.3 1.1v-1c10.2-2.4 19.5-3.4 30-3"/>
            <path fill={CAR_GOLD} d="M549 433v1l-11 1v2l-5.7 1-3.2.6q-4 .5-8.1.4c2-2 2-2 5.1-2.1l2.9.1v-2a89 89 0 0 1 20-2"/>
            <path fill={CAR_BODY_LIGHT} d="M1175 351h1v16l-3 1-1-8.4V357l2-2zM1170 316a102 102 0 0 1 19 11c-3 1-3 1-6 0v-2l-8.7-4.1-2.5-1.1-1.8-.8z"/>
            <path fill="#d4af37" d="m847 263-1 3 4 1h-10v-1h-15v-1c14.6-2.3 14.6-2.3 22-2"/>
            <path fill={CAR_GOLD} d="m1077 256 12 1v2h4v2c-6.2.4-10.5-.2-16-3z"/>
            <path fill={CAR_BODY} d="M697 467v1l-2.5.4-3.3.5-3.3.6c-2.9.5-2.9.5-5.9 1.5h-16v-1l9.9-1.5 2.8-.4q9-1.4 18.3-1.1"/>
            <path fill={CAR_BODY} d="M676.2 466.9h7.8l3 .1v1l-10 1.5-2.8.4q-8.1 1.3-16.2 1.1l1-2c3-.4 3-.4 6.5-.6 4-.2 7-1.4 10.7-1.5"/>
            <path fill="#d4af37" d="m719 372 2 1v2l3.7-.4 4.9-.6 2.4-.3q7-.8 14-.7v1l-10.1 1.5-3 .4q-6.8 1.2-13.9 1.1z"/>
            <path fill={CAR_BODY_LIGHT} d="M318 331v2c-15.6 4.6-15.6 4.6-24 4 3.8-2.2 7.8-3.1 12-4.1l2.2-.6c3.4-.8 6.3-1.3 9.8-1.3"/>
            <path fill="#1e1e1e" d="M468 448q-6.5 1.6-12.9 2.7l-2 .4-6 1.1c-3.1.8-3.1.8-5.1 2.8l-1-4a383 383 0 0 1 20.1-3.7c2.7-.3 4.4-.2 6.9.7M998 360c2.2 3.3 2.8 5.8 3.6 9.8l.8 3.6q.8 5.3.6 10.6a48 48 0 0 1-4.8-13.4c-1-3.9-1.4-6.7-.2-10.6"/>
            <path fill={CAR_BODY} d="m704 428 3 1-4.7 5.3-1.4 1.5c-4.9 5.4-4.9 5.4-7.9 7.2l-3-1 1.5-1.3q7-5.8 12.5-12.7"/>
            <path fill="#d4af37" d="M260 423v2h-2.3l-3 .3h-3.1c-2.6.7-2.6.7-4 2.8l-.6 1.9-1-2c-2.3-.4-2.3-.4-5-.6l-2.8-.2-2.2-.2v-1l9.8-1.5 2.7-.4 2.7-.4 2.5-.4c2.3-.3 2.3-.3 6.3-.3"/>
            <path fill={CAR_GOLD} d="M833 345c1 3.3.9 5.4 0 8.8l-.5 2.4-.5 1.8 4.4-1 2.4-.5c2.2-.5 2.2-.5 4.2-1.5v3a20 20 0 0 1-7.7 1H831c-1.5-8-1.5-8 .4-12z"/>
            <path fill={CAR_BODY_LIGHT} d="M838.4 336.9h2.3l5.3.1v1l-9.2 1.5-2.6.4q-6 1.2-12.2 1.1c1-2 1-2 4-3.1 4.2-1.1 8.2-1.1 12.4-1"/>
            <path fill={CAR_BODY} d="M1111 295c7.3 2.9 7.3 2.9 10 6l2 1-1 3-9-3 2-4-4-1z"/>
            <path fill="#6fbcff" d="m668 288 2 2c-6.4 1.2-12.5 2.3-19 2 4.3-4.1 11.3-6 17-4"/>
            <path fill="#d4af37" d="m842 371-1 22h-1v-20l-5 1h-8v-1l5.8-1c.6 0 .6 0 3.3-.6 2.9-.4 2.9-.4 5.9-.4"/>
            <path fill={CAR_GOLD} d="M1119 290c7 .2 12.6 1.2 18 6v2a145 145 0 0 1-18-7z"/>
            <path fill={CAR_BODY_LIGHT} d="M775.3 274.9h7.5l6.2.1v1c-7.7 2-15 2.2-23 2 1-2 1-2 2.8-2.6a35 35 0 0 1 6.5-.5M1143 262l8 2.8 2.3.8q7 2.4 13.7 5.4c-2.8 1.3-4 1-7-.1l-1.7-.9-9.2-3.7-3.5-1.3-2.6-1z"/>
            <path fill="#d4af37" d="m1051 254 10.3.4c5.3.2 9 1.3 13.7 3.6a15 15 0 0 1-8.8.2l-2.7-.5-2.7-.6-2.9-.6-6.9-1.5z"/>
            <path fill={CAR_GOLD} d="m256 456-1 12h-1v-9l-14 1v-2l6.3-1 3.6-.6c3.1-.4 3.1-.4 6.1-.4"/>
            <path fill={CAR_BODY} d="m822 449 .4 2.4.6 2.6 2 1h-4l-1-4-1.9.2q-8.5 1-17.1.8v-1l7.7-1 2.2-.3a69 69 0 0 1 11.1-.7"/>
            <path fill={CAR_BODY_LIGHT} d="M712 357q2.8 4.2 4.6 8.8l1.4 3c1 3.3 1.2 5.8 1 9.2-2.3-3.4-2.5-6-3-10h-2c-2.3-3.6-2.2-6.8-2-11M377 268v2c-6 4.8-13.4 7.8-21 9 3.6-3 7.5-5 11.6-7.2l2-1.1c5.1-2.7 5.1-2.7 7.4-2.7M399 258l-1 3-4.9 2.2q-4.6 1.9-9.2 4c-1.9.8-1.9.8-3.9.8v-2l10.8-5.2 2.3-1 2.1-1c1.8-.8 1.8-.8 3.8-.8"/>
            <path fill="#6fbcff" d="M1189 327h19c-2 3-2 3-4.1 3.6-5.6.5-9.7.3-14.9-1.6z"/>
            <path fill={CAR_BODY_LIGHT} d="M1237 313c8.3.1 14.1 1.3 21 6v1h-7l1-3-3-.4-7.8-1-3.2-.6z"/>
            <path fill={CAR_GOLD} d="M1162 300c3 1 5.7 1.8 8.3 3.4q4.6 2.5 9.5 3.8 3.9 1.4 7.2 3.8c-2 1-2 1-5.2 0l-4-1.6-2-.9q-7.4-3-13.8-7.5z"/>
            <path fill={CAR_BODY} d="M979 292c5 .5 9.3 1.2 14 3v2h3v2l4 2c-4 0-7-1.7-10.5-3.4l-2-1a65 65 0 0 1-8.5-4.6"/>
            <path fill={CAR_BODY_LIGHT} d="M255 477v11c-2-4-2-4-2-8h-14v-1l7.4-1 2.2-.3c5.3-.7 5.3-.7 6.4-.7"/>
            <path fill={CAR_GOLD} d="m572 379-4 1v2q-9.5 1.3-19 1v-1l2.8-.4 3.6-.5 3.6-.6c9-1.6 9-1.6 13-1.5"/>
            <path fill={CAR_BODY_LIGHT} d="M842 364c1.3 2.7.7 4.2 0 7-9.4 2.3-9.4 2.3-14 2v-2l4.3-1 2.3-.6c2.4-.4 2.4-.4 6.4-.4z"/>
            <path fill={CAR_BODY} d="m543 286-2.9 1c-7.2 2.9-12.6 5.4-17.1 12l-1-3 1-2h2l1-3q3.8-2.3 8-4l2.8-1.3c2.5-.8 3.7-.4 6.2.3"/>
            <path fill={CAR_BODY_LIGHT} d="m241 453 1 2h14c-3.5 2.4-5.5 2.4-9.7 2.6l-3.6.3-2.7.1z"/>
            <path fill={CAR_BODY} d="M1057 393h1l1 17h9c-2 2-2 2-11 3z"/>
            <path fill="#1e1e1e" d="M810 397a12 12 0 0 1-9 3.5l-2.8.1h-3l-3 .2-7.2.2v-1l9.1-1.5 2.6-.4A65 65 0 0 1 810 397"/>
            <path fill="#d4af37" d="M1036 264q3.8 0 7.7.3h2.2c4.5.3 7.4 1 11.1 3.7-3 1-5 1-8.1.2l-2.3-.5-2.3-.6-2.5-.6-5.8-1.5z"/>

            {/* Background (Far) Wheels on driver left side */}
            <g id="far_wheels">
                <defs>
                    <clipPath id="far_rear_wheel_clip">
                        <polygon points="465,490 645,465 645,560 465,560" />
                    </clipPath>
                    <clipPath id="far_front_wheel_clip">
                        <polygon points="1065,445 1110,410 1215,373 1215,485 1065,485" />
                    </clipPath>
                </defs>

                {/* Far Rear Wheel peeking below mid-chassis */}
                <g clipPath="url(#far_rear_wheel_clip)">
                    <g transform="translate(556 464) rotate(-7.7) translate(-556 -464)">
                        <ellipse cx="556" cy="464" rx="80" ry="83" fill="#0A0A0A" />
                        <path d="M 556 547 A 80 83 0 0 0 636 464 A 71 73.7 0 0 1 556 547 Z" fill="#1e1e1e" />
                    </g>
                </g>

                {/* Far Front Wheel peeking under front nose */}
                <g clipPath="url(#far_front_wheel_clip)">
                    <g transform="translate(1115 375) rotate(-7.7) translate(-1115 -375)">
                        <ellipse cx="1115" cy="375" rx="90" ry="94" fill="#0A0A0A" />
                        <path d="M 1115 469 A 90 94 0 0 0 1205 375 A 80.5 84 0 0 1 1115 469 Z" fill="#1e1e1e" />
                    </g>
                </g>
            </g>

            {/* Ground Track Line and Aerodynamic Speed Streaks */}
            <g id="ground_speed_streaks" fill="#0A0A0A">
                {/* Primary Ground Track Line running at -7.7 deg along all wheel contact patches */}
                <path d="M 160 594.5 L 1360 431.5 L 1360 437 L 160 600 Z" />

                {/* Trailing Speed Streaks behind rear wheel */}
                <path d="M 175 592.5 L 285 577.5 L 285 579.5 L 175 594.5 Z" />
                <path d="M 220 571.5 L 275 564 L 275 565.8 L 220 573 Z" />

                {/* Mid-chassis speed streaks between rear and front wheels */}
                <path d="M 660 522.5 L 870 494 L 870 496.2 L 660 524.5 Z" />
                <path d="M 720 513.5 L 815 500.5 L 815 502.5 L 720 515.5 Z" />
                <path d="M 750 482.5 L 840 470.2 L 840 472 L 750 484.2 Z" />

                {/* Wheel Contact Patch Shadows */}
                <ellipse cx="333" cy="573.5" rx="36" ry="3.5" transform="rotate(-7.7 333 573.5)" />
                <ellipse cx="928" cy="499.5" rx="34" ry="3.3" transform="rotate(-7.7 928 499.5)" />
            </g>

            {/* Wheel at (333, 478) */}
            <g id="wheel_333_478" transform="translate(333 478) rotate(-7.7) scale(0.98 1)">
                {/* Motion speed arc trailing behind tire */}
                <path d="M -86.4 -50 A 105.6 105.6 0 0 0 -86.4 50" fill="none" stroke="#6fbcff" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
                <path d="M -86.4 -50 A 105.6 105.6 0 0 0 -86.4 50" fill="none" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />

                {/* Outer Tire Black Body */}
                <circle cx="0" cy="0" r="96" fill="#0A0A0A" />

                {/* Outer Tread Bevel (Charcoal Grey) */}
                <path d="M 0 96 A 96 96 0 0 0 0 -96 A 86.4 86.4 0 0 1 0 96 Z" fill="#1e1e1e" />

                {/* Inner Rim Recess Lip */}
                <circle cx="0" cy="0" r="76" fill="#0A0A0A" />

                {/* Main Wheel Face (Dark Metallic Grey) */}
                <circle cx="0" cy="0" r="72" fill="#1e1e1e" />

                {/* 5 Radial Cutout Windows showing interior depth */}
                <path d="M 38.93 -2.38 L 63.88 -3.91 A 64.00 64.00 0 0 1 49.38 40.71 L 30.09 24.81 A 39.00 39.00 0 0 0 38.93 -2.38 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M 14.29 36.29 L 23.46 59.55 A 64.00 64.00 0 0 1 -23.46 59.55 L -14.29 36.29 A 39.00 39.00 0 0 0 14.29 36.29 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M -30.09 24.81 L -49.38 40.71 A 64.00 64.00 0 0 1 -63.88 -3.91 L -38.93 -2.38 A 39.00 39.00 0 0 0 -30.09 24.81 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M -32.89 -20.95 L -53.98 -34.39 A 64.00 64.00 0 0 1 -16.02 -61.96 L -9.76 -37.76 A 39.00 39.00 0 0 0 -32.89 -20.95 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M 9.76 -37.76 L 16.02 -61.96 A 64.00 64.00 0 0 1 53.98 -34.39 L 32.89 -20.95 A 39.00 39.00 0 0 0 9.76 -37.76 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />

                {/* Center Axle Hub Ring */}
                <circle cx="0" cy="0" r="35" fill="#1e1e1e" stroke="#0A0A0A" strokeWidth="1.8" />
                <circle cx="0" cy="0" r="23" fill="#0A0A0A" />

                {/* Metallic Axle Pin Button Dome */}
                <circle cx="0" cy="0" r="16.5" fill="#dcdcdc" />

                {/* Axle Pin Shadow Bevel */}
                <path d="M 0 -16.5 A 16.5 16.5 0 0 0 0 16.5 A 12.5 12.5 0 0 1 0 -16.5 Z" fill="#1e1e1e" opacity="0.45" />

                {/* Specular Highlight Glint */}
                <ellipse cx="6" cy="-2.5" rx="5.5" ry="3.8" transform="rotate(30 6 -2.5)" fill="#ffffff" />
            </g>

            {/* Wheel at (928, 404) */}
            <g id="wheel_928_404" transform="translate(928 404) rotate(-7.7) scale(0.98 1)">
                {/* Motion speed arc trailing behind tire */}
                <path d="M -86.4 -50 A 105.6 105.6 0 0 0 -86.4 50" fill="none" stroke="#6fbcff" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
                <path d="M -86.4 -50 A 105.6 105.6 0 0 0 -86.4 50" fill="none" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />

                {/* Outer Tire Black Body */}
                <circle cx="0" cy="0" r="96" fill="#0A0A0A" />

                {/* Outer Tread Bevel (Charcoal Grey) */}
                <path d="M 0 96 A 96 96 0 0 0 0 -96 A 86.4 86.4 0 0 1 0 96 Z" fill="#1e1e1e" />

                {/* Inner Rim Recess Lip */}
                <circle cx="0" cy="0" r="76" fill="#0A0A0A" />

                {/* Main Wheel Face (Dark Metallic Grey) */}
                <circle cx="0" cy="0" r="72" fill="#1e1e1e" />

                {/* 5 Radial Cutout Windows showing interior depth */}
                <path d="M 38.93 -2.38 L 63.88 -3.91 A 64.00 64.00 0 0 1 49.38 40.71 L 30.09 24.81 A 39.00 39.00 0 0 0 38.93 -2.38 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M 14.29 36.29 L 23.46 59.55 A 64.00 64.00 0 0 1 -23.46 59.55 L -14.29 36.29 A 39.00 39.00 0 0 0 14.29 36.29 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M -30.09 24.81 L -49.38 40.71 A 64.00 64.00 0 0 1 -63.88 -3.91 L -38.93 -2.38 A 39.00 39.00 0 0 0 -30.09 24.81 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M -32.89 -20.95 L -53.98 -34.39 A 64.00 64.00 0 0 1 -16.02 -61.96 L -9.76 -37.76 A 39.00 39.00 0 0 0 -32.89 -20.95 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M 9.76 -37.76 L 16.02 -61.96 A 64.00 64.00 0 0 1 53.98 -34.39 L 32.89 -20.95 A 39.00 39.00 0 0 0 9.76 -37.76 Z" fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="1.6" strokeLinejoin="round" />

                {/* Center Axle Hub Ring */}
                <circle cx="0" cy="0" r="35" fill="#1e1e1e" stroke="#0A0A0A" strokeWidth="1.8" />
                <circle cx="0" cy="0" r="23" fill="#0A0A0A" />

                {/* Metallic Axle Pin Button Dome */}
                <circle cx="0" cy="0" r="16.5" fill="#dcdcdc" />

                {/* Axle Pin Shadow Bevel */}
                <path d="M 0 -16.5 A 16.5 16.5 0 0 0 0 16.5 A 12.5 12.5 0 0 1 0 -16.5 Z" fill="#1e1e1e" opacity="0.45" />

                {/* Specular Highlight Glint */}
                <ellipse cx="6" cy="-2.5" rx="5.5" ry="3.8" transform="rotate(30 6 -2.5)" fill="#ffffff" />
            </g>
            {!isStandard73 && (
                <text
                    x="678"
                    y="418"
                    textAnchor="middle"
                    fontFamily="Impact, 'Arial Black', sans-serif"
                    fontWeight="900"
                    fontSize="68"
                    fill={CAR_BODY}
                    transform="rotate(-8 678 418) skewX(-4)"
                >
                    {number}
                </text>
            )}
        </svg>
    );
}

interface SealProps {
    size?: number;
    className?: string;
    year?: string | number;
}

/**
 * The official circular Pinewood Derby seal medallion for the certificate footer.
 */
export function PinewoodDerbySeal({
    size = 140,
    className,
    year = '2026',
}: SealProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 160 160"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <path
                    id="topSealArc"
                    d="M 28 80 A 52 52 0 0 1 132 80"
                    fill="none"
                />
                <path
                    id="bottomSealArc"
                    d="M 23 80 A 57 57 0 0 0 137 80"
                    fill="none"
                />
            </defs>

            {/* Outer navy base with gold serrated/double edge */}
            <circle cx="80" cy="80" r="76" fill={SEAL_NAVY} stroke={GOLD} strokeWidth="3" />
            <circle cx="80" cy="80" r="71" fill="none" stroke={GOLD} strokeWidth="1.2" strokeDasharray="3,2" />
            <circle cx="80" cy="80" r="66" fill={SEAL_NAVY_DARK} stroke={GOLD} strokeWidth="1.5" />

            {/* Circular text along arcs */}
            <text fill={WHITE} fontSize="9" fontWeight="800" letterSpacing="2.5" fontFamily="var(--font-body)">
                <textPath href="#topSealArc" startOffset="50%" textAnchor="middle">
                    PINEWOOD DERBY
                </textPath>
            </text>

            <text fill={WHITE} fontSize="9" fontWeight="800" letterSpacing="2.5" fontFamily="var(--font-body)">
                <textPath href="#bottomSealArc" startOffset="50%" textAnchor="middle">
                    {year} WINNER
                </textPath>
            </text>

            {/* Stars at 9 and 3 o'clock */}
            <g transform="translate(18, 80)">
                <polygon points="0,-4 1.2,-1.2 4,0 1.2,1.2 0,4 -1.2,1.2 -4,0 -1.2,-1.2" fill={GOLD} />
            </g>
            <g transform="translate(142, 80)">
                <polygon points="0,-4 1.2,-1.2 4,0 1.2,1.2 0,4 -1.2,1.2 -4,0 -1.2,-1.2" fill={GOLD} />
            </g>

            {/* Inner ring */}
            <circle cx="80" cy="80" r="42" fill={SEAL_NAVY_DARK} stroke={GOLD} strokeWidth="2" />

            {/* Laurel wreath around center */}
            <g fill={GOLD} stroke={CAR_ACCENT_DARK} strokeWidth="0.4">
                {/* Left branch */}
                <path d="M 52 80 Q 52 64 63 54 Q 61 63 56 70 Q 53 75 52 80 Z" />
                <path d="M 52 80 Q 52 96 63 106 Q 61 97 56 90 Q 53 85 52 80 Z" />
                <ellipse cx="55" cy="62" rx="4" ry="2" transform="rotate(-35 55 62)" />
                <ellipse cx="61" cy="55" rx="4" ry="2" transform="rotate(-50 61 55)" />
                <ellipse cx="55" cy="98" rx="4" ry="2" transform="rotate(35 55 98)" />
                <ellipse cx="61" cy="105" rx="4" ry="2" transform="rotate(50 61 105)" />

                {/* Right branch */}
                <path d="M 108 80 Q 108 64 97 54 Q 99 63 104 70 Q 107 75 108 80 Z" />
                <path d="M 108 80 Q 108 96 97 106 Q 99 97 104 90 Q 107 85 108 80 Z" />
                <ellipse cx="105" cy="62" rx="4" ry="2" transform="rotate(35 105 62)" />
                <ellipse cx="99" cy="55" rx="4" ry="2" transform="rotate(50 99 55)" />
                <ellipse cx="105" cy="98" rx="4" ry="2" transform="rotate(-35 105 98)" />
                <ellipse cx="99" cy="105" rx="4" ry="2" transform="rotate(-50 99 105)" />
            </g>

            {/* Center golden cog / rosette and star */}
            <circle cx="80" cy="80" r="18" fill={GOLD} stroke={CAR_ACCENT_DARK} strokeWidth="1.5" />
            <circle cx="80" cy="80" r="14" fill={SEAL_NAVY_DARK} stroke={GOLD} strokeWidth="1" />
            <polygon
                points="80,69 82.5,76 89.5,76 84,80.5 86,87.5 80,83.5 74,87.5 76,80.5 70.5,76 77.5,76"
                fill={GOLD}
                stroke={CAR_ACCENT_DARK}
                strokeWidth="0.6"
            />
        </svg>
    );
}

