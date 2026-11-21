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
            {/* Fastback wedge body with rear spoiler chamfer and semicircular
                wheel-well clearance arches so tires separate cleanly even at 24px. */}
            <path
                d="M 10 35 L 11 14 L 18 13 Q 38 15, 52 19 Q 86 20, 113 28 C 116 28.5, 117 32, 115 35 L 103.5 35 A 10.5 10.5 0 0 0 82.5 35 L 39.5 35 A 10.5 10.5 0 0 0 18.5 35 Z"
                fill={color}
            />
            {/* Wheels punched with evenodd hub cutouts so cutouts stay transparent
                on light paper AND on dark masthead headers. */}
            <path
                fillRule="evenodd"
                fill={color}
                d="M 29 26.8 A 8.2 8.2 0 1 0 29 43.2 A 8.2 8.2 0 1 0 29 26.8 Z M 29 31.8 A 3.2 3.2 0 1 1 29 38.2 A 3.2 3.2 0 1 1 29 31.8 Z"
            />
            <path
                fillRule="evenodd"
                fill={color}
                d="M 93 26.8 A 8.2 8.2 0 1 0 93 43.2 A 8.2 8.2 0 1 0 93 26.8 Z M 93 31.8 A 3.2 3.2 0 1 1 93 38.2 A 3.2 3.2 0 1 1 93 31.8 Z"
            />
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
            {/* Sleek fuselage with ogive nose, tapered rear thruster nozzle, and
                evenodd forward-set porthole cutout. */}
            <path
                fillRule="evenodd"
                fill={color}
                d="M 24 25 C 24 17, 32 14, 46 14 L 84 14 Q 106 14, 118 25 Q 106 36, 84 36 L 46 36 C 32 36, 24 33, 24 25 Z M 67 19.8 A 5.2 5.2 0 1 0 67 30.2 A 5.2 5.2 0 1 0 67 19.8 Z"
            />
            <path d="M 13 20 L 25 22 L 25 28 L 13 30 Z" fill={color} />
            {/* Swept chamfered Space Derby tail fins */}
            <path d="M 44 14 L 22 4 L 16 4 L 26 17 Z" fill={color} />
            <path d="M 44 36 L 22 46 L 16 46 L 26 33 Z" fill={color} />
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
            {/* Raked hull with sheer deck curve, pointed bow, and angled stern transom */}
            <path
                d="M 12 35 Q 64 37, 116 33 L 100 44 L 20 44 Z"
                fill={color}
            />
            {/* Tall mast with clean 4px boom clearance gap above the deck */}
            <rect x="52" y="4" width="3" height="31.5" fill={color} />
            {/* Billowing mainsail & foresail separated cleanly from the mast */}
            <path d="M 50.5 6 C 35 16, 23 23, 18 31 Q 35 29.5, 50.5 31 Z" fill={color} />
            <path d="M 56.5 7 L 99 31 L 56.5 31 Z" fill={color} />
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
            {/* Chamfered outer blue rule, nested inner gold rule, centered
                diamond lozenge in the corner pocket, and terminal dots. */}
            <path
                d="M 4 56 L 4 12 L 12 4 L 56 4"
                fill="none"
                stroke={BLUE}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="4" cy="56" r="1.8" fill={BLUE} />
            <circle cx="56" cy="4" r="1.8" fill={BLUE} />

            <path
                d="M 14 48 L 14 16 Q 14 14 16 14 L 48 14"
                fill="none"
                stroke={GOLD}
                strokeWidth="1.6"
                strokeLinecap="round"
            />
            <circle cx="14" cy="48" r="1.4" fill={GOLD} />
            <circle cx="48" cy="14" r="1.4" fill={GOLD} />

            <path d="M 9 5.5 L 12.5 9 L 9 12.5 L 5.5 9 Z" fill={GOLD} />
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
    const lobes = 16;
    const scallopPath =
        Array.from({ length: lobes }, (_, i) => {
            const a0 = (i / lobes) * Math.PI * 2 - Math.PI / 2;
            const aMid = ((i + 0.5) / lobes) * Math.PI * 2 - Math.PI / 2;
            const a1 = ((i + 1) / lobes) * Math.PI * 2 - Math.PI / 2;
            const x0 = (50 + Math.cos(a0) * 25).toFixed(2);
            const y0 = (40 + Math.sin(a0) * 25).toFixed(2);
            const cx = (50 + Math.cos(aMid) * 33).toFixed(2);
            const cy = (40 + Math.sin(aMid) * 33).toFixed(2);
            const x1 = (50 + Math.cos(a1) * 25).toFixed(2);
            const y1 = (40 + Math.sin(a1) * 25).toFixed(2);
            return `${i === 0 ? `M ${x0} ${y0}` : ''} Q ${cx} ${cy} ${x1} ${y1}`;
        }).join(' ') + ' Z';

    const pleatPath = Array.from({ length: lobes }, (_, i) => {
        const a = (i / lobes) * Math.PI * 2 - Math.PI / 2;
        const x0 = (50 + Math.cos(a) * 19).toFixed(2);
        const y0 = (40 + Math.sin(a) * 19).toFixed(2);
        const x1 = (50 + Math.cos(a) * 25).toFixed(2);
        const y1 = (40 + Math.sin(a) * 25).toFixed(2);
        return `M ${x0} ${y0} L ${x1} ${y1}`;
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
            {/* Splayed swallowtail ribbon tails with inset gold trim */}
            <path d="M 36 56 L 23 95 L 35 88 L 43 96 L 49 62 Z" fill={BLUE} />
            <path d="M 64 56 L 77 95 L 65 88 L 57 96 L 51 62 Z" fill={BLUE} />
            <path d="M 38 60 L 28 90 M 46 62 L 40 91" fill="none" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
            <path d="M 62 60 L 72 90 M 54 62 L 60 91" fill="none" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
            {/* Cast shadow under the rosette across top of ribbons */}
            <path d="M 31 62 A 24 24 0 0 0 69 62 L 66 70 A 26 26 0 0 1 34 70 Z" fill="rgba(0, 0, 0, 0.25)" />

            {/* 16-lobe pleated satin rosette */}
            <path d={scallopPath} fill={GOLD} stroke={BLUE} strokeWidth="1.2" strokeLinejoin="round" />
            <path d={pleatPath} fill="none" stroke={BLUE} strokeWidth="1" strokeLinecap="round" opacity="0.28" />

            {/* Center medallion & mathematically centered 5-point star */}
            <circle cx="50" cy="40" r="18.5" fill="var(--print-surface-color)" stroke={BLUE} strokeWidth="2.2" />
            <circle cx="50" cy="40" r="15" fill="none" stroke={GOLD} strokeWidth="1.2" />
            <path
                d="M 50 28.5 L 52.7 36.3 L 60.9 36.5 L 54.4 41.4 L 56.8 49.3 L 50 44.6 L 43.2 49.3 L 45.6 41.4 L 39.1 36.5 L 47.3 36.3 Z"
                fill={GOLD}
                stroke={BLUE}
                strokeWidth="1.4"
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
    const numStr = String(number);
    const numFontSize = numStr.length >= 3 ? 52 : numStr.length === 1 ? 76 : 68;

    const bodyPath =
        'M 168 380 ' +
        'C 164 366, 174 356, 198 350 ' +
        'C 265 332, 330 318, 385 318 ' +
        'C 425 318, 452 342, 476 342 ' +
        'C 565 330, 680 302, 775 280 ' +
        'C 865 258, 965 236, 1055 246 ' +
        'C 1135 253, 1215 284, 1266 326 ' +
        'C 1277 335, 1276 353, 1262 363 ' +
        'C 1230 385, 1175 398, 1110 407 ' +
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
                    {/* 3D tire depth / right sidewall */}
                    <ellipse cx="16" cy="0" rx="92" ry="96" fill={ink} />
                    <path d="M 16 -96 A 92 96 0 0 1 16 96 L 0 96 A 92 96 0 0 0 0 -96 Z" fill="#1e1e1e" opacity="0.55" />
                    {/* Outer tire body & tread bevel */}
                    <circle cx="0" cy="0" r="95" fill={ink} />
                    <circle cx="0" cy="0" r="84" fill="#1e1e1e" />
                    <circle cx="0" cy="0" r="78" fill={ink} />
                    {/* Upper-left tire shoulder highlight to separate tire from dark wheel well */}
                    <path
                        d="M -76 -54 A 93 93 0 0 1 18 -92"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.22)"
                        strokeWidth="4"
                        strokeLinecap="round"
                    />
                    {/* Main wheel face with subtle contrast sheen */}
                    <circle cx="0" cy="0" r="72" fill="#1e1e1e" />
                    <circle cx="0" cy="0" r="72" fill="rgba(255, 255, 255, 0.12)" />
                    <circle cx="0" cy="0" r="70" fill="none" stroke="rgba(255, 255, 255, 0.16)" strokeWidth="2.5" />
                    {/* 5 radial cutout windows */}
                    <path d="M 38.93 -2.38 L 63.88 -3.91 A 64 64 0 0 1 49.38 40.71 L 30.09 24.81 A 39 39 0 0 0 38.93 -2.38 Z" fill={ink} />
                    <path d="M 14.29 36.29 L 23.46 59.55 A 64 64 0 0 1 -23.46 59.55 L -14.29 36.29 A 39 39 0 0 0 14.29 36.29 Z" fill={ink} />
                    <path d="M -30.09 24.81 L -49.38 40.71 A 64 64 0 0 1 -63.88 -3.91 L -38.93 -2.38 A 39 39 0 0 0 -30.09 24.81 Z" fill={ink} />
                    <path d="M -32.89 -20.95 L -53.98 -34.39 A 64 64 0 0 1 -16.02 -61.96 L -9.76 -37.76 A 39 39 0 0 0 -32.89 -20.95 Z" fill={ink} />
                    <path d="M 9.76 -37.76 L 16.02 -61.96 A 64 64 0 0 1 53.98 -34.39 L 32.89 -20.95 A 39 39 0 0 0 9.76 -37.76 Z" fill={ink} />
                    {/* Center axle hub collar & metallic cap */}
                    <circle cx="0" cy="0" r="35" fill="#1e1e1e" stroke={ink} strokeWidth="2.2" />
                    <circle cx="0" cy="0" r="34" fill="rgba(255, 255, 255, 0.15)" />
                    <circle cx="0" cy="0" r="22" fill={ink} />
                    <circle cx="0" cy="0" r="17" fill="#dcdcdc" stroke="rgba(255, 255, 255, 0.55)" strokeWidth="1.5" />
                    <path d="M 0 -17 A 17 17 0 0 0 0 17 A 12 12 0 0 1 0 -17 Z" fill="#1e1e1e" opacity="0.35" />
                    <ellipse cx="5.5" cy="-3.5" rx="5.5" ry="3.5" transform="rotate(30 5.5 -3.5)" fill={WHITE} />
                </g>
            </defs>

            {/* Far (driver-left) wheels peeking below chassis */}
            <g id="far_wheels">
                <g transform="translate(570 462) rotate(-7.1)">
                    <ellipse cx="0" cy="0" rx="72" ry="78" fill={ink} />
                    <path d="M 0 -78 A 72 78 0 0 1 0 78 A 56 78 0 0 0 0 -78 Z" fill="#1e1e1e" />
                    <path d="M -52 -46 A 70 76 0 0 1 12 -74" fill="none" stroke="rgba(255, 255, 255, 0.14)" strokeWidth="3" strokeLinecap="round" />
                </g>
                <g transform="translate(1100 392) rotate(-7.1)">
                    <ellipse cx="0" cy="0" rx="74" ry="80" fill={ink} />
                    <path d="M 0 -80 A 74 80 0 0 1 0 80 A 58 80 0 0 0 0 -80 Z" fill="#1e1e1e" />
                    <path d="M -54 -48 A 72 78 0 0 1 12 -76" fill="none" stroke="rgba(255, 255, 255, 0.14)" strokeWidth="3" strokeLinecap="round" />
                </g>
            </g>

            {/* Ground track line and aerodynamic speed streaks */}
            <g id="ground_speed_streaks" fill={ink}>
                <path d="M 145 595 L 1345 446 L 1345 451 L 145 600 Z" />
                <path d="M 185 577 L 285 564.5 L 285 568.5 L 185 580.5 Z" />
                <path d="M 228 557 L 278 551 L 278 554 L 228 560 Z" />
                <path d="M 650 521 L 860 495 L 860 499 L 650 524.5 Z" />
                <path d="M 705 501 L 810 488 L 810 491 L 705 504 Z" />
                <ellipse cx="333" cy="573.5" rx="44" ry="4" transform="rotate(-7.1 333 573.5)" />
                <ellipse cx="928" cy="499.5" rx="42" ry="3.8" transform="rotate(-7.1 928 499.5)" />
            </g>

            {/* Trailing aerodynamic speed streaks behind fairing and tail */}
            <g id="rear_speed_streaks">
                <path d="M 225 274 L 460 232 L 455 238 L 225 277 Z" fill={CAR_BODY_LIGHT} />
                <path d="M 265 292 L 415 265 L 412 270 L 265 295 Z" fill={CAR_BODY} opacity="0.7" />
                <path d="M 65 436 L 175 421 L 175 425 L 65 439.5 Z" fill={ink} />
                <path d="M 105 453 L 180 443 L 180 447 L 105 456.5 Z" fill={CAR_BODY_LIGHT} />
                <path d="M 115 478 L 188 468 L 188 472 L 115 481.5 Z" fill={CAR_GOLD} />
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
                    strokeWidth="6.5"
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
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    opacity="0.65"
                />
            </g>

            {/* Cockpit tub, driver helmet silhouette, and wraparound windshield */}
            <g id="cockpit_windshield">
                <path
                    d="M 482 344 C 522 292, 615 232, 675 230 C 715 228, 750 250, 775 278 C 685 298, 575 326, 482 344 Z"
                    fill={CAR_BODY}
                    stroke={ink}
                    strokeWidth="6.5"
                    strokeLinejoin="round"
                />
                {/* Subtle driver helmet silhouette inside the wraparound cockpit */}
                <path
                    d="M 632 295 C 632 268, 650 248, 672 248 C 688 248, 698 262, 696 282 Z"
                    fill={ink}
                    opacity="0.48"
                />
                <path
                    d="M 555 286 C 605 248, 655 234, 682 234 C 712 234, 740 252, 762 274 L 728 282 C 710 262, 686 246, 658 248 C 625 250, 588 268, 555 286 Z"
                    fill={CAR_BODY_LIGHT}
                />
                <path
                    d="M 652 242 C 685 238, 722 252, 748 275 L 728 280 C 708 260, 680 248, 652 246 Z"
                    fill={WHITE}
                    opacity="0.9"
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
                    {/* Lower rocker & front chin shadow plane */}
                    <path d="M 160 472 L 1280 338 L 1280 430 L 160 520 Z" fill="#0A0A0A" opacity="0.22" />
                    <path d="M 1165 344 L 1280 330 L 1280 410 L 1165 402 Z" fill="#0A0A0A" opacity="0.25" />
                    {/* Rear transom bevel shadow */}
                    <path d="M 164 356 L 194 348 L 200 506 L 164 506 Z" fill="#0A0A0A" opacity="0.18" />
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
                    {/* Dual gold racing stripes (hood & curved nose) */}
                    <path
                        d="M 870 256 C 955 246, 1028 248, 1085 260 C 1138 272, 1185 298, 1226 334 L 1210 336 C 1170 302, 1126 279, 1076 267 C 1020 255, 950 253, 870 262 Z"
                        fill={CAR_GOLD}
                    />
                    <path
                        d="M 920 245 C 995 239, 1062 243, 1114 256 C 1166 269, 1212 296, 1252 330 L 1237 332 C 1198 300, 1154 276, 1106 263 C 1056 250, 992 246, 920 251 Z"
                        fill={CAR_GOLD}
                    />
                    {/* Chiseled 3/4 front bumper crease highlight */}
                    <path d="M 1162 346 C 1205 344, 1245 338, 1272 332" fill="none" stroke={CAR_BODY_LIGHT} strokeWidth="4.5" strokeLinecap="round" />
                    <path d="M 1162 346 C 1168 366, 1170 385, 1166 401" fill="none" stroke={CAR_BODY_LIGHT} strokeWidth="3.5" strokeLinecap="round" opacity="0.75" />
                    {/* Subtle inner wheel-well motion arcs inside dark fender paint */}
                    <path d="M 232 458 A 104 104 0 0 0 232 504" fill="none" stroke="rgba(255, 255, 255, 0.55)" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M 824 390 A 104 104 0 0 0 824 440" fill="none" stroke="rgba(255, 255, 255, 0.55)" strokeWidth="2.5" strokeLinecap="round" />
                </g>
                <path d={bodyPath} fill="none" stroke={ink} strokeWidth="6.8" strokeLinejoin="round" />
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
                    d="M 1212 294 C 1226 295, 1244 304, 1254 315 C 1242 317, 1224 309, 1212 294 Z"
                    fill={WHITE}
                    stroke={ink}
                    strokeWidth="4"
                    strokeLinejoin="round"
                />
            </g>

            {/* White number roundel */}
            <g id="number_roundel">
                <ellipse cx="628" cy="400" rx="56" ry="59" transform="rotate(-7.1 628 400)" fill={WHITE} stroke={ink} strokeWidth="3" />
                <text
                    x="0"
                    y="0"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontFamily="var(--font-header, Impact, 'Arial Black', sans-serif)"
                    fontWeight="900"
                    fontSize={numFontSize}
                    fill={CAR_BODY}
                    transform="translate(628 402) rotate(-7.1) skewX(-5)"
                >
                    {number}
                </text>
            </g>

            {/* Near wheels */}
            <use href={`#${wheelId}`} transform="translate(333 478) rotate(-7.1) scale(0.91 1)" />
            <use href={`#${wheelId}`} transform="translate(928 404) rotate(-7.1) scale(0.91 1)" />
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

    const foilTeeth = 40;
    const foilRimPath =
        Array.from({ length: foilTeeth }, (_, i) => {
            const a0 = (i / foilTeeth) * Math.PI * 2 - Math.PI / 2;
            const aMid = ((i + 0.5) / foilTeeth) * Math.PI * 2 - Math.PI / 2;
            const a1 = ((i + 1) / foilTeeth) * Math.PI * 2 - Math.PI / 2;
            const x0 = (80 + Math.cos(a0) * 74.5).toFixed(2);
            const y0 = (80 + Math.sin(a0) * 74.5).toFixed(2);
            const cx = (80 + Math.cos(aMid) * 78.5).toFixed(2);
            const cy = (80 + Math.sin(aMid) * 78.5).toFixed(2);
            const x1 = (80 + Math.cos(a1) * 74.5).toFixed(2);
            const y1 = (80 + Math.sin(a1) * 74.5).toFixed(2);
            return `${i === 0 ? `M ${x0} ${y0}` : ''} Q ${cx} ${cy} ${x1} ${y1}`;
        }).join(' ') + ' Z';

    const badgeLobes = 12;
    const centerBadgePath =
        Array.from({ length: badgeLobes }, (_, i) => {
            const a0 = (i / badgeLobes) * Math.PI * 2 - Math.PI / 2;
            const aMid = ((i + 0.5) / badgeLobes) * Math.PI * 2 - Math.PI / 2;
            const a1 = ((i + 1) / badgeLobes) * Math.PI * 2 - Math.PI / 2;
            const x0 = (80 + Math.cos(a0) * 16.5).toFixed(2);
            const y0 = (80 + Math.sin(a0) * 16.5).toFixed(2);
            const cx = (80 + Math.cos(aMid) * 20).toFixed(2);
            const cy = (80 + Math.sin(aMid) * 20).toFixed(2);
            const x1 = (80 + Math.cos(a1) * 16.5).toFixed(2);
            const y1 = (80 + Math.sin(a1) * 16.5).toFixed(2);
            return `${i === 0 ? `M ${x0} ${y0}` : ''} Q ${cx} ${cy} ${x1} ${y1}`;
        }).join(' ') + ' Z';

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
                <path id={topArcId} d="M 26 80 A 54 54 0 0 1 134 80" fill="none" />
                <path id={bottomArcId} d="M 26 80 A 54 54 0 0 0 134 80" fill="none" />
            </defs>

            {/* Serrated gold foil outer edge & navy seal rings */}
            <path d={foilRimPath} fill={GOLD} />
            <circle cx="80" cy="80" r="73.5" fill={SEAL_NAVY} stroke={GOLD} strokeWidth="2.2" />
            <circle cx="80" cy="80" r="69.5" fill="none" stroke={GOLD} strokeWidth="1" strokeDasharray="2.5,2.5" />
            <circle cx="80" cy="80" r="65.5" fill={SEAL_NAVY_DARK} stroke={GOLD} strokeWidth="1.5" />
            {/* Faint upper-left stamped foil sheen */}
            <path d="M 22 46 A 68 68 0 0 1 114 22" fill="none" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="2" strokeLinecap="round" />

            {/* Circular text along centered r=54 track */}
            <text fill={WHITE} fontSize="9.2" fontWeight="800" letterSpacing="2.3" fontFamily="var(--font-body)" dominantBaseline="central">
                <textPath href={`#${topArcId}`} startOffset="50%" textAnchor="middle">
                    PINEWOOD DERBY
                </textPath>
            </text>

            <text fill={WHITE} fontSize="9.2" fontWeight="800" letterSpacing="2.3" fontFamily="var(--font-body)" dominantBaseline="central">
                <textPath href={`#${bottomArcId}`} startOffset="50%" textAnchor="middle">
                    {year} WINNER
                </textPath>
            </text>

            {/* Stars and flanking dots at 9 and 3 o'clock */}
            <g transform="translate(26, 80)" fill={GOLD}>
                <circle cx="0" cy="-8" r="1.3" />
                <polygon points="0,-4 1.2,-1.2 4,0 1.2,1.2 0,4 -1.2,1.2 -4,0 -1.2,-1.2" />
                <circle cx="0" cy="8" r="1.3" />
            </g>
            <g transform="translate(134, 80)" fill={GOLD}>
                <circle cx="0" cy="-8" r="1.3" />
                <polygon points="0,-4 1.2,-1.2 4,0 1.2,1.2 0,4 -1.2,1.2 -4,0 -1.2,-1.2" />
                <circle cx="0" cy="8" r="1.3" />
            </g>

            {/* Inner ring */}
            <circle cx="80" cy="80" r="42" fill={SEAL_NAVY_DARK} stroke={GOLD} strokeWidth="2" />

            {/* Organic tied 7-leaf-per-side laurel wreath */}
            <g fill={GOLD}>
                {/* Left stem & 7 splayed laurel leaves sweeping upward */}
                <path d="M 79 111 C 62 108, 51 94, 52 76 C 53 66, 57 59, 63 54" fill="none" stroke={GOLD} strokeWidth="1.5" strokeLinecap="round" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(71 109) rotate(-130)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(62 103) rotate(-168)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(55 94) rotate(-150)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(52 84) rotate(-132)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(52 73) rotate(-112)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(56 63) rotate(-88)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(63 54) rotate(-58)" />

                {/* Right stem & 7 splayed laurel leaves sweeping upward */}
                <path d="M 81 111 C 98 108, 109 94, 108 76 C 107 66, 103 59, 97 54" fill="none" stroke={GOLD} strokeWidth="1.5" strokeLinecap="round" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(89 109) rotate(-50)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(98 103) rotate(-12)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(105 94) rotate(-30)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(108 84) rotate(-48)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(108 73) rotate(-68)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(104 63) rotate(-92)" />
                <path d="M 0 0 Q 3.8 -3 8.5 0 Q 3.8 3 0 0 Z" transform="translate(97 54) rotate(-122)" />

                {/* Ribbon-tie knot joining stems at bottom */}
                <circle cx="80" cy="111" r="2.2" />
            </g>

            {/* 12-scallop gold center badge and mathematically centered 5-point star */}
            <path d={centerBadgePath} fill={GOLD} stroke={SEAL_NAVY_DARK} strokeWidth="1.2" strokeLinejoin="round" />
            <circle cx="80" cy="80" r="13.5" fill={SEAL_NAVY_DARK} stroke={GOLD} strokeWidth="1.2" />
            <path
                d="M 80 69 L 82.6 76.4 L 90.5 76.6 L 84.2 81.4 L 86.5 88.9 L 80 84.4 L 73.5 88.9 L 75.8 81.4 L 69.5 76.6 L 77.4 76.4 Z"
                fill={GOLD}
            />
        </svg>
    );
}

