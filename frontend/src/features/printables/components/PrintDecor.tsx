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
 * certificate's first draft did with `DerbyCar`. The certificate's background
 * is a gradient texture instead; see `.certificate` in the stylesheet.
 */

interface DecorProps {
    /** Square, in CSS pixels. */
    size?: number;
    className?: string;
}

const BLUE = 'var(--print-primary-color, #003F87)';
const GOLD = 'var(--print-accent-color, #FCD116)';

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
export function DerbyCar({ size = 24, className, color = BLUE }: DecorProps & { color?: string }) {
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
