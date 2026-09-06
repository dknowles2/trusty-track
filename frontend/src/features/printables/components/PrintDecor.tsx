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

const CAR_STREAK = 'var(--print-highlight-bg-color, #6fbcff)';
const CAR_BODY = 'var(--print-primary-color, #003F87)';
const CAR_BODY_DARK = 'var(--print-header-gradient-start, #002a5c)';
const CAR_BODY_LIGHT = 'var(--print-header-gradient-end, #0b4f9e)';
const CAR_ACCENT = 'var(--print-accent-color, #FCD116)';
const CAR_ACCENT_DARK = 'var(--print-rule-line-color, #c8d2de)';
const CAR_ACCENT_LIGHT = 'var(--print-accent-color, #FCD116)';
const CAR_TIRE = 'var(--print-text-color, #0A0A0A)';
const CAR_HUB = 'var(--print-primary-color, #003F87)';
const CAR_WINDOW = 'var(--print-highlight-bg-color, #6fbcff)';
const CAR_SHADOW = 'rgba(0, 0, 0, 0.25)';
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
 * An angled 3D perspective Pinewood Derby racing car with speed streaks
 * for the certificate.
 */
export function DerbyCarIllustration({
    width = 320,
    height = 145,
    className,
    number = '73',
}: DerbyCarProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 440 200"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <linearGradient id="speedStreak" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={CAR_STREAK} stopOpacity="0.8" />
                    <stop offset="100%" stopColor={CAR_BODY} stopOpacity="0.1" />
                </linearGradient>
            </defs>

            {/* Speed streaks trailing behind the car */}
            <g opacity="0.75">
                <rect x="230" y="65" width="130" height="5" rx="2.5" fill="url(#speedStreak)" />
                <rect x="270" y="78" width="120" height="4" rx="2" fill="url(#speedStreak)" />
                <rect x="240" y="90" width="150" height="6" rx="3" fill="url(#speedStreak)" />
                <rect x="300" y="104" width="110" height="4.5" rx="2.25" fill="url(#speedStreak)" />
                <rect x="260" y="118" width="140" height="5" rx="2.5" fill="url(#speedStreak)" />
                <rect x="290" y="132" width="100" height="4" rx="2" fill="url(#speedStreak)" />
            </g>

            {/* Far wheels (right side) */}
            {/* Front right wheel */}
            <g transform="translate(108, 126) rotate(-12)">
                <ellipse cx="0" cy="0" rx="14" ry="24" fill={CAR_TIRE} />
                <ellipse cx="-1" cy="0" rx="9" ry="17" fill={CAR_HUB} />
                <ellipse cx="-1" cy="0" rx="5" ry="9" fill={GOLD} />
            </g>

            {/* Rear right wheel */}
            <g transform="translate(258, 134) rotate(-10)">
                <ellipse cx="0" cy="0" rx="16" ry="28" fill={CAR_TIRE} />
                <ellipse cx="-1" cy="0" rx="11" ry="20" fill={CAR_HUB} />
                <ellipse cx="-1" cy="0" rx="6" ry="11" fill={GOLD} />
            </g>

            {/* Main body of the derby car */}
            {/* Under-shadow */}
            <ellipse cx="195" cy="168" rx="125" ry="10" fill={CAR_SHADOW} />

            {/* Front nose / wing / splitter */}
            <path
                d="M 52 152 L 102 128 L 138 142 L 88 166 Z"
                fill={CAR_ACCENT}
                stroke={CAR_ACCENT_DARK}
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
            <path
                d="M 52 152 L 52 159 L 88 173 L 88 166 Z"
                fill={CAR_ACCENT_DARK}
            />
            <path
                d="M 88 166 L 88 173 L 138 149 L 138 142 Z"
                fill={CAR_ACCENT_DARK}
            />

            {/* Nose cone tip */}
            <path
                d="M 82 144 L 112 130 L 126 137 L 96 151 Z"
                fill={CAR_ACCENT_LIGHT}
            />

            {/* Main fuselage / car body */}
            <path
                d="M 96 148 L 175 112 L 248 116 L 272 138 L 244 148 L 168 154 Z"
                fill={CAR_BODY}
                stroke={CAR_BODY_DARK}
                strokeWidth="2"
                strokeLinejoin="round"
            />

            {/* Cockpit hood and side panels */}
            <path
                d="M 120 137 L 180 110 L 228 114 L 208 132 L 148 142 Z"
                fill={CAR_BODY_LIGHT}
            />

            {/* Gold racing side stripe */}
            <path
                d="M 112 146 L 165 124 L 255 128 L 248 138 L 164 135 L 118 150 Z"
                fill={GOLD}
                stroke={CAR_ACCENT_DARK}
                strokeWidth="0.8"
            />

            {/* Cockpit windshield & dome */}
            <path
                d="M 190 102 C 195 86, 218 84, 226 98 L 235 120 L 198 124 Z"
                fill={CAR_BODY_DARK}
                stroke={GOLD}
                strokeWidth="2"
            />
            <path
                d="M 193 103 C 196 90, 215 88, 222 99 L 210 116 L 196 116 Z"
                fill={CAR_WINDOW}
                opacity="0.85"
            />

            {/* Rear intake / engine cowl */}
            <path
                d="M 224 96 L 252 98 L 256 122 L 230 120 Z"
                fill={CAR_BODY}
            />

            {/* Rear wing / spoiler struts & wing */}
            <path d="M 238 98 L 244 76 L 249 76 L 243 98 Z" fill={CAR_ACCENT} />
            <path d="M 264 102 L 270 78 L 275 78 L 269 102 Z" fill={CAR_ACCENT} />
            {/* Top wing blade */}
            <path
                d="M 222 76 L 285 80 L 283 71 L 220 67 Z"
                fill={CAR_BODY}
                stroke={GOLD}
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
            {/* Left wing endplate */}
            <polygon points="216,63 226,65 224,82 214,80" fill={CAR_ACCENT} stroke={CAR_ACCENT_DARK} strokeWidth="1" />
            {/* Right wing endplate */}
            <polygon points="280,68 290,70 288,86 278,84" fill={CAR_ACCENT} stroke={CAR_ACCENT_DARK} strokeWidth="1" />

            {/* Car numbers */}
            <g transform="translate(136, 138) rotate(-22) skewX(20)">
                <text
                    x="0"
                    y="0"
                    fill={WHITE}
                    stroke={CAR_BODY_DARK}
                    strokeWidth="1.2"
                    fontSize="17"
                    fontWeight="900"
                    fontFamily="sans-serif"
                    textAnchor="middle"
                >
                    {number}
                </text>
            </g>
            <g transform="translate(216, 114) rotate(-8) skewX(10)">
                <text
                    x="0"
                    y="0"
                    fill={GOLD}
                    stroke={CAR_TIRE}
                    strokeWidth="0.8"
                    fontSize="13"
                    fontWeight="900"
                    fontFamily="sans-serif"
                    textAnchor="middle"
                >
                    {number}
                </text>
            </g>

            {/* Near wheels (left side) */}
            {/* Front left wheel */}
            <g transform="translate(132, 160) rotate(-14)">
                <ellipse cx="0" cy="0" rx="16" ry="28" fill={CAR_TIRE} />
                <ellipse cx="-1" cy="0" rx="11" ry="21" fill={CAR_HUB} />
                <ellipse cx="-1" cy="0" rx="7" ry="13" fill={GOLD} stroke={CAR_ACCENT_DARK} strokeWidth="1" />
                <circle cx="-1" cy="0" r="3" fill={CAR_TIRE} />
            </g>

            {/* Rear left wheel */}
            <g transform="translate(278, 146) rotate(-10)">
                <ellipse cx="0" cy="0" rx="19" ry="32" fill={CAR_TIRE} />
                <ellipse cx="-1" cy="0" rx="13" ry="24" fill={CAR_HUB} />
                <ellipse cx="-1" cy="0" rx="8" ry="15" fill={GOLD} stroke={CAR_ACCENT_DARK} strokeWidth="1" />
                <circle cx="-1" cy="0" r="3.5" fill={CAR_TIRE} />
            </g>
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
            <text fill={WHITE} fontSize="9" fontWeight="800" letterSpacing="2.5" fontFamily="sans-serif">
                <textPath href="#topSealArc" startOffset="50%" textAnchor="middle">
                    PINEWOOD DERBY
                </textPath>
            </text>

            <text fill={WHITE} fontSize="9" fontWeight="800" letterSpacing="2.5" fontFamily="sans-serif">
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

