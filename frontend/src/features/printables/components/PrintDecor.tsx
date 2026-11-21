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

import { useId, type ReactElement } from 'react';

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
            <path d="M40 10 L12 2 L24 19 Z" fill={color} />
            <path d="M40 40 L12 48 L24 31 Z" fill={color} />
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
    const uid = useId();
    const bodyClipId = `derbyBodyClip-${uid}`;
    const wheelId = `derbyWheel-${uid}`;
    const ink = '#0A0A0A';

    const bodyPath =
        'M 168 380 ' +
        'C 164 366, 174 356, 198 350 ' +
        'C 265 332, 330 318, 385 318 ' +
        'C 425 318, 452 342, 476 342 ' +
        'C 565 330, 680 302, 775 280 ' +
        'C 865 258, 965 236, 1055 246 ' +
        'C 1135 255, 1215 292, 1266 330 ' +
        'C 1278 339, 1276 355, 1262 365 ' +
        'C 1226 388, 1170 400, 1110 407 ' +
        'L 1020 419 ' +
        'C 1015 350, 965 310, 912 314 ' +
        'C 855 318, 822 366, 822 442 ' +
        'L 426 496 ' +
        'C 425 424, 382 382, 326 386 ' +
        'C 272 390, 236 434, 236 506 ' +
        'C 202 502, 180 484, 174 454 Z';

    return (
        <svg
            width={width}
            height={height}
            viewBox="40 180 1260 550"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <clipPath id={bodyClipId}>
                    <path d={bodyPath} />
                </clipPath>

                {/* Reusable 5-hole Pinewood Derby wheel */}
                <g id={wheelId}>
                    {/* Motion speed arcs trailing behind tire */}
                    <path d="M -88 -50 A 107 107 0 0 0 -88 50" fill="none" stroke="#6fbcff" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
                    <path d="M -88 -50 A 107 107 0 0 0 -88 50" fill="none" stroke={WHITE} strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
                    {/* 3D tire depth / right sidewall */}
                    <ellipse cx="12" cy="0" rx="94" ry="96" fill={ink} />
                    <path d="M 12 -96 A 94 96 0 0 1 12 96 L 0 96 A 94 96 0 0 0 0 -96 Z" fill="#1e1e1e" opacity="0.5" />
                    {/* Outer tire body & tread bevel */}
                    <circle cx="0" cy="0" r="95" fill={ink} />
                    <circle cx="0" cy="0" r="84" fill="#1e1e1e" />
                    <circle cx="0" cy="0" r="78" fill={ink} />
                    {/* Main wheel face */}
                    <circle cx="0" cy="0" r="72" fill="#1e1e1e" />
                    {/* 5 radial cutout windows */}
                    <path d="M 38.93 -2.38 L 63.88 -3.91 A 64 64 0 0 1 49.38 40.71 L 30.09 24.81 A 39 39 0 0 0 38.93 -2.38 Z" fill={ink} />
                    <path d="M 14.29 36.29 L 23.46 59.55 A 64 64 0 0 1 -23.46 59.55 L -14.29 36.29 A 39 39 0 0 0 14.29 36.29 Z" fill={ink} />
                    <path d="M -30.09 24.81 L -49.38 40.71 A 64 64 0 0 1 -63.88 -3.91 L -38.93 -2.38 A 39 39 0 0 0 -30.09 24.81 Z" fill={ink} />
                    <path d="M -32.89 -20.95 L -53.98 -34.39 A 64 64 0 0 1 -16.02 -61.96 L -9.76 -37.76 A 39 39 0 0 0 -32.89 -20.95 Z" fill={ink} />
                    <path d="M 9.76 -37.76 L 16.02 -61.96 A 64 64 0 0 1 53.98 -34.39 L 32.89 -20.95 A 39 39 0 0 0 9.76 -37.76 Z" fill={ink} />
                    {/* Center axle hub & metallic cap */}
                    <circle cx="0" cy="0" r="34" fill="#1e1e1e" stroke={ink} strokeWidth="2" />
                    <circle cx="0" cy="0" r="22" fill={ink} />
                    <circle cx="0" cy="0" r="16" fill="#dcdcdc" />
                    <path d="M 0 -16 A 16 16 0 0 0 0 16 A 12 12 0 0 1 0 -16 Z" fill="#1e1e1e" opacity="0.35" />
                    <ellipse cx="5.5" cy="-3" rx="5" ry="3.4" transform="rotate(30 5.5 -3)" fill={WHITE} />
                </g>
            </defs>

            {/* Far (driver-left) wheels peeking below chassis */}
            <g id="far_wheels">
                <g transform="translate(556 468) rotate(-7.1)">
                    <ellipse cx="0" cy="0" rx="80" ry="74" fill={ink} />
                    <path d="M 0 -74 A 80 74 0 0 1 0 74 A 62 74 0 0 0 0 -74 Z" fill="#1e1e1e" />
                </g>
                <g transform="translate(1108 396) rotate(-7.1)">
                    <ellipse cx="0" cy="0" rx="82" ry="76" fill={ink} />
                    <path d="M 0 -76 A 82 76 0 0 1 0 76 A 64 76 0 0 0 0 -76 Z" fill="#1e1e1e" />
                </g>
            </g>

            {/* Ground track line and aerodynamic speed streaks */}
            <g id="ground_speed_streaks" fill={ink}>
                <path d="M 145 595 L 1345 446 L 1345 450.5 L 145 599 Z" />
                <path d="M 190 577 L 285 565 L 285 568 L 190 579.5 Z" />
                <path d="M 235 557 L 280 551.5 L 280 553.5 L 235 559 Z" />
                <path d="M 650 521 L 860 495 L 860 498 L 650 523.5 Z" />
                <path d="M 705 501 L 810 488 L 810 490 L 705 503 Z" />
                <ellipse cx="333" cy="573.5" rx="44" ry="4" transform="rotate(-7.1 333 573.5)" />
                <ellipse cx="928" cy="499.5" rx="42" ry="3.8" transform="rotate(-7.1 928 499.5)" />
            </g>

            {/* Trailing aerodynamic speed streaks behind fairing and tail */}
            <g id="rear_speed_streaks">
                <path d="M 225 274 L 460 232 L 455 237 L 225 276 Z" fill={CAR_BODY_LIGHT} />
                <path d="M 265 292 L 415 265 L 412 269 L 265 294 Z" fill={CAR_BODY} opacity="0.7" />
                <path d="M 65 436 L 175 421 L 175 424 L 65 438 Z" fill={ink} />
                <path d="M 105 453 L 180 443 L 180 446 L 105 455 Z" fill={CAR_BODY_LIGHT} />
                <path d="M 115 478 L 188 468 L 188 471 L 115 480 Z" fill={CAR_GOLD} />
            </g>

            {/* Wheel well interior shadows */}
            <path d="M 225 505 C 225 420, 275 375, 338 375 C 398 375, 435 420, 435 502 Z" fill={ink} />
            <path d="M 815 446 C 815 352, 865 305, 926 305 C 986 305, 1030 352, 1030 424 Z" fill={ink} />

            {/* Rollover headrest fairing */}
            <g id="rollover_fairing">
                <path
                    d="M 235 352 C 310 308, 415 260, 505 224 C 528 214, 550 220, 565 242 C 578 262, 584 288, 586 318 L 470 344 C 440 342, 415 322, 375 322 Z"
                    fill={CAR_BODY}
                    stroke={ink}
                    strokeWidth="5.5"
                    strokeLinejoin="round"
                />
                <path
                    d="M 255 344 C 335 300, 425 258, 512 226 C 522 223, 530 226, 534 232 C 445 266, 355 304, 270 344 Z"
                    fill={CAR_BODY_LIGHT}
                />
                <path
                    d="M 498 336 C 496 286, 504 240, 526 234 C 548 228, 564 268, 566 320 Z"
                    fill={ink}
                />
                <path
                    d="M 505 334 C 504 288, 512 246, 528 240"
                    fill="none"
                    stroke={CAR_BODY_LIGHT}
                    strokeWidth="3"
                    strokeLinecap="round"
                    opacity="0.6"
                />
            </g>

            {/* Cockpit tub and wraparound windshield */}
            <g id="cockpit_windshield">
                <path d="M 485 342 C 510 308, 575 292, 650 296 L 755 280 L 485 346 Z" fill={SEAL_NAVY_DARK} />
                <path
                    d="M 488 338 C 525 292, 615 232, 675 230 C 715 228, 750 250, 775 278 C 685 298, 575 324, 488 338 Z"
                    fill={CAR_BODY}
                    stroke={ink}
                    strokeWidth="5.5"
                    strokeLinejoin="round"
                />
                <path
                    d="M 555 286 C 605 248, 655 234, 682 234 C 712 234, 740 252, 762 274 L 728 282 C 710 262, 686 246, 658 248 C 625 250, 588 268, 555 286 Z"
                    fill={CAR_BODY_LIGHT}
                />
                <path
                    d="M 652 242 C 685 238, 722 252, 748 275 L 728 280 C 708 260, 680 248, 652 246 Z"
                    fill={WHITE}
                    opacity="0.88"
                />
                <path
                    d="M 618 253 C 642 250, 668 262, 688 286 L 674 289 C 656 268, 636 258, 618 257 Z"
                    fill="#6fbcff"
                    opacity="0.75"
                />
            </g>

            {/* Main car body */}
            <g id="car_body">
                <path d={bodyPath} fill={CAR_BODY} />
                <g clipPath={`url(#${bodyClipId})`}>
                    {/* Lower rocker / underbody shadow */}
                    <path d="M 160 472 L 1280 338 L 1280 430 L 160 520 Z" fill="#0A0A0A" opacity="0.22" />
                    {/* Upper shoulder / fender highlight ridge */}
                    <path
                        d="M 170 368 C 250 346, 325 326, 385 326 C 425 326, 450 348, 478 348 C 580 334, 700 304, 800 282 C 890 262, 980 246, 1065 254 C 1135 262, 1205 295, 1255 332 L 1245 340 C 1192 304, 1125 274, 1058 268 C 975 260, 888 276, 802 296 C 702 318, 582 346, 478 358 C 446 358, 420 338, 382 338 C 324 338, 250 356, 172 378 Z"
                        fill={CAR_BODY_LIGHT}
                    />
                    <path
                        d="M 480 351 C 595 336, 725 304, 840 280 C 930 262, 1010 254, 1075 262"
                        fill="none"
                        stroke="#6fbcff"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        opacity="0.6"
                    />
                    {/* Dual gold racing stripes (side flank) */}
                    <path d="M 162 426 L 845 334 L 845 352 L 162 444 Z" fill={CAR_GOLD} />
                    <path d="M 162 454 L 845 362 L 845 380 L 162 472 Z" fill={CAR_GOLD} />
                    {/* Dual gold racing stripes (hood & nose) */}
                    <path
                        d="M 870 256 C 955 246, 1028 248, 1085 260 C 1135 271, 1178 294, 1216 325 L 1201 327 C 1165 298, 1124 277, 1076 267 C 1020 255, 950 253, 870 262 Z"
                        fill={CAR_GOLD}
                    />
                    <path
                        d="M 920 245 C 995 239, 1062 243, 1114 256 C 1162 268, 1205 292, 1244 322 L 1230 324 C 1193 296, 1152 274, 1106 263 C 1056 250, 992 246, 920 251 Z"
                        fill={CAR_GOLD}
                    />
                    {/* Front bumper nose crease highlight */}
                    <path d="M 1165 344 C 1205 344, 1245 338, 1272 332" fill="none" stroke={CAR_BODY_LIGHT} strokeWidth="4" strokeLinecap="round" />
                    <path d="M 1165 344 C 1170 364, 1172 384, 1168 400" fill="none" stroke={CAR_BODY_LIGHT} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                </g>
                <path d={bodyPath} fill="none" stroke={ink} strokeWidth="5.5" strokeLinejoin="round" />
            </g>

            {/* Headlights */}
            <g id="headlights">
                <path
                    d="M 1068 298 C 1082 288, 1118 296, 1148 318 C 1154 323, 1152 330, 1140 331 C 1112 333, 1076 322, 1066 308 C 1063 303, 1064 300, 1068 298 Z"
                    fill={WHITE}
                    stroke={ink}
                    strokeWidth="4.5"
                    strokeLinejoin="round"
                />
                <path d="M 1071 304 C 1084 316, 1116 324, 1142 325 C 1118 329, 1082 321, 1069 307 Z" fill={CAR_ACCENT_DARK} />
                <path
                    d="M 1212 292 C 1226 294, 1244 304, 1254 315 C 1242 316, 1224 308, 1212 292 Z"
                    fill={WHITE}
                    stroke={ink}
                    strokeWidth="3.5"
                    strokeLinejoin="round"
                />
            </g>

            {/* White number roundel */}
            <g id="number_roundel">
                <ellipse cx="628" cy="400" rx="56" ry="59" transform="rotate(-7.1 628 400)" fill={WHITE} />
                <text
                    x="0"
                    y="25"
                    textAnchor="middle"
                    fontFamily="Impact, 'Arial Black', sans-serif"
                    fontWeight="900"
                    fontSize="74"
                    fill={CAR_BODY}
                    transform="translate(628 400) rotate(-7.1) skewX(-5)"
                >
                    {number}
                </text>
            </g>

            {/* Near wheels */}
            <use href={`#${wheelId}`} transform="translate(333 478) rotate(-7.1) scale(0.98 1)" />
            <use href={`#${wheelId}`} transform="translate(928 404) rotate(-7.1) scale(0.98 1)" />
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
    const uid = useId();
    const topArcId = `topSealArc-${uid}`;
    const bottomArcId = `bottomSealArc-${uid}`;

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
                    id={topArcId}
                    d="M 28 80 A 52 52 0 0 1 132 80"
                    fill="none"
                />
                <path
                    id={bottomArcId}
                    d="M 22 80 A 58 58 0 0 0 138 80"
                    fill="none"
                />
            </defs>

            {/* Outer navy base with gold serrated/double edge */}
            <circle cx="80" cy="80" r="76" fill={SEAL_NAVY} stroke={GOLD} strokeWidth="3" />
            <circle cx="80" cy="80" r="71" fill="none" stroke={GOLD} strokeWidth="1.2" strokeDasharray="3,2" />
            <circle cx="80" cy="80" r="66" fill={SEAL_NAVY_DARK} stroke={GOLD} strokeWidth="1.5" />

            {/* Circular text along arcs */}
            <text fill={WHITE} fontSize="9" fontWeight="800" letterSpacing="2.5" fontFamily="var(--font-body)">
                <textPath href={`#${topArcId}`} startOffset="50%" textAnchor="middle">
                    PINEWOOD DERBY
                </textPath>
            </text>

            <text fill={WHITE} fontSize="9" fontWeight="800" letterSpacing="2.5" fontFamily="var(--font-body)">
                <textPath href={`#${bottomArcId}`} startOffset="50%" textAnchor="middle">
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
            <g fill={GOLD}>
                {/* Left stem & leaves */}
                <path d="M 73 108 A 29 29 0 0 1 62 56" fill="none" stroke={GOLD} strokeWidth="1.4" strokeLinecap="round" />
                <ellipse cx="66" cy="105" rx="4.5" ry="2" transform="rotate(28 66 105)" />
                <ellipse cx="58" cy="97" rx="4.5" ry="2" transform="rotate(42 58 97)" />
                <ellipse cx="53" cy="87" rx="4.5" ry="2" transform="rotate(60 53 87)" />
                <ellipse cx="52" cy="76" rx="4.5" ry="2" transform="rotate(-78 52 76)" />
                <ellipse cx="55" cy="66" rx="4.5" ry="2" transform="rotate(-55 55 66)" />
                <ellipse cx="62" cy="57" rx="4.5" ry="2" transform="rotate(-35 62 57)" />

                {/* Right stem & leaves */}
                <path d="M 87 108 A 29 29 0 0 0 98 56" fill="none" stroke={GOLD} strokeWidth="1.4" strokeLinecap="round" />
                <ellipse cx="94" cy="105" rx="4.5" ry="2" transform="rotate(-28 94 105)" />
                <ellipse cx="102" cy="97" rx="4.5" ry="2" transform="rotate(-42 102 97)" />
                <ellipse cx="107" cy="87" rx="4.5" ry="2" transform="rotate(-60 107 87)" />
                <ellipse cx="108" cy="76" rx="4.5" ry="2" transform="rotate(78 108 76)" />
                <ellipse cx="105" cy="66" rx="4.5" ry="2" transform="rotate(55 105 66)" />
                <ellipse cx="98" cy="57" rx="4.5" ry="2" transform="rotate(35 98 57)" />
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

