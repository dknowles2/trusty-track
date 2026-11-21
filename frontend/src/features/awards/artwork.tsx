/**
 * Original clipart for the ceremony slide and the certificate (#306).
 *
 * Drawn for this app, in this app's own palette — `--scouting-blue` and
 * `--cub-scouting-gold`, the same 12px radius the rest of the UI uses on
 * anything boxy — so there is no licence to track next to a committed binary.
 * Everything here is an inline `<svg>`, not a fetched or generated image: the
 * venue has no internet, same reasoning as the finish chime being two WebAudio
 * oscillators rather than an audio file.
 *
 * `ARTWORK_KEYS` is the whole vocabulary a key can name. `backend/domain/
 * awards.py`'s `default_artwork_key` produces three of them (`trophy`,
 * `medal`, `tortoise`) for a `SPEED` award's rule; `awardTemplates.ts` pairs
 * the rest with a ready-made `SPECIAL` award. A key this module does not
 * recognise — an old award, or one a newer build invented — renders nothing
 * rather than throwing, the same "print blank rather than crash" rule the
 * heat sheet follows for a deleted racer.
 *
 * `variant` is what makes the artwork legible on both of its two homes
 * (#400). The certificate and the Awards list sit on the app's ordinary
 * light background, where the every-shape's outline colour reads fine
 * against white. The ceremony slide (`AwardCeremony`) paints its
 * *background* dark, so every line/fill drawn in the same colour as that
 * background disappeared: the line colour and the page colour were the same
 * variable. `variant="dark"` swaps every one of those strokes and fills for
 * white, which is why `LINE` — not a second constant sprinkled through each
 * shape — is threaded through every shape function: missing one leaves a
 * component that still goes line-colour-on-dark in exactly the spot nobody
 * photographs until the ceremony runs for real. The fill colour is left
 * alone in both variants; it already has contrast against dark and against
 * white.
 *
 * `palette` is what makes the artwork surface-independent (#498's
 * groundwork). `AwardArtwork` is used from three different surfaces — the
 * Awards list and `AwardCeremony` (App/Display) and `Certificate.tsx`
 * (Printables) — and used to read `--scouting-blue` / `--cub-scouting-gold`
 * (the App surface's own tokens) as module constants regardless of which
 * surface was asking. Each of the three call sites now passes its own
 * surface's resolved line/fill colour instead; a caller that passes nothing
 * gets the App surface's own tokens, which is what every shape read before
 * this and is why the Awards list needed no change.
 */

import { ReactElement, ReactNode } from 'react';

const WHITE = '#ffffff';

/** The App surface's own tokens — the default for a caller that passes no
 *  `palette`, and the values every shape read before #498's groundwork. */
const DEFAULT_PALETTE: ArtworkPalette = {
  line: 'var(--scouting-blue, #003F87)',
  fill: 'var(--cub-scouting-gold, #FCD116)',
};

/** Which background this piece is drawn against. Defaults to 'light' — the
 *  certificate and the Awards list, every caller before the ceremony
 *  slide's dark background existed. */
type ArtworkVariant = 'light' | 'dark';

/** The two colours a shape needs: an outline/detail colour and a fill. Each
 *  surface passes its own resolved primary/accent (#498's groundwork) —
 *  never the App-level tokens read directly, which is what made a
 *  Printables theme with a different accent than the App theme still print
 *  a trophy in the App's gold. */
interface ArtworkPalette {
  line: string;
  fill: string;
}

interface ArtworkProps {
  /** Square, in CSS pixels. */
  size?: number;
  className?: string;
  variant?: ArtworkVariant;
  /** The caller's surface-scoped colours. Omitted defaults to the App
   *  surface's own tokens (`DEFAULT_PALETTE`) — today's behaviour. */
  palette?: ArtworkPalette;
}

/** The one line/detail colour and one fill colour a shape uses, resolved
 *  from the caller's palette and its background. Every shape below reads
 *  `LINE`/`FILL`, never a palette or a module constant directly, so a
 *  background-aware or surface-aware palette cannot be half-applied.
 *
 *  `variant="dark"` prefers the *caller's own* palette.line over the
 *  hardcoded white (#498) — AwardCeremony passes `--display-text-color`,
 *  which is white in five of the seven themes but a warm off-white under
 *  Sawdust & Pine and Trail Colors. A caller that passes `variant="dark"`
 *  with no palette at all (nothing in this codebase does, but the type
 *  allows it) still gets the hardcoded white, so a background-aware caller
 *  never has to supply one just to avoid a colour that would not contrast
 *  against the App surface's own tokens. */
function resolvePalette(props: ArtworkProps): ArtworkPalette {
  const palette = props.palette ?? DEFAULT_PALETTE;
  const darkLine = props.palette ? props.palette.line : WHITE;
  return {
    line: props.variant === 'dark' ? darkLine : palette.line,
    fill: palette.fill,
  };
}

function Frame({
  size = 96,
  className,
  variant,
  palette,
  children,
}: ArtworkProps & { children: ReactNode }) {
  const { fill } = resolvePalette({ variant, palette });
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
      style={variant === 'dark' ? { filter: 'drop-shadow(0 0 10px rgba(252, 209, 22, 0.35))' } : undefined}
    >
      <defs>
        {/* Opaque metallic gold base so dark projector backgrounds never bleed through */}
        <linearGradient id="ttGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={fill} stopOpacity="1" />
          <stop offset="100%" stopColor={fill} stopOpacity="0.92" />
        </linearGradient>
      </defs>
      {children}
    </svg>
  );
}

function Trophy(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Left & right ear handles flowing cleanly into cup body */}
      <path
        d="M28 27 C 14 26, 10 39, 17 48 C 22 54, 30 55, 38 53"
        fill="none"
        stroke={LINE}
        strokeWidth={2.8}
        strokeLinecap="round"
      />
      <path
        d="M72 27 C 86 26, 90 39, 83 48 C 78 54, 70 55, 62 53"
        fill="none"
        stroke={LINE}
        strokeWidth={2.8}
        strokeLinecap="round"
      />
      {/* Knopped stem & stepped two-tier pedestal with engraving plaque */}
      <path
        d="M 45 62 L 55 62 L 57 73 L 43 73 Z"
        fill={FILL}
        stroke={LINE}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <rect x="43" y="65" width="14" height="4" rx="2" fill={FILL} stroke={LINE} strokeWidth={2} />
      <path
        d="M 33 73 L 67 73 L 71 79 L 29 79 Z"
        fill={LINE}
        stroke={LINE}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <rect x="23" y="79" width="54" height="9" rx="2.5" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2.6} />
      <path d="M 27 81.5 L 73 81.5" stroke="rgba(255, 255, 255, 0.45)" strokeWidth={1.2} strokeLinecap="round" />
      <rect x="35" y="81.5" width="30" height="4" rx="1" fill={LINE} />

      {/* Trophy cup body with left specular highlight & right-side depth crescent */}
      <path
        d="M28 22 L72 22 C72 44, 62 60, 50 64 C38 60, 28 44, 28 22 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.7}
        strokeLinejoin="round"
      />
      <path
        d="M 67 24 C 66 43, 59 56, 50 61 C 57 55, 62 42, 62 24 Z"
        fill="rgba(0, 0, 0, 0.16)"
      />
      <path
        d="M 33 27 C 33 38, 36 49, 42 55"
        stroke="rgba(255, 255, 255, 0.65)"
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
      />
      {/* Hollow 3D bowl rim */}
      <ellipse cx="50" cy="22" rx="22" ry="3.8" fill={FILL} stroke={LINE} strokeWidth={2.2} />
      <ellipse cx="50" cy="22" rx="18.5" ry="2" fill="rgba(0, 0, 0, 0.28)" />
      {/* Centered trigonometric 5-point star on cup */}
      <polygon
        points="50,32.5 52,38.2 58.1,38.4 53.2,42 55,47.9 50,44.4 45,47.9 46.8,42 41.9,38.4 48,38.2"
        fill={LINE}
      />
    </Frame>
  );
}

function Medal(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Overlapping folded V-ribbon straps with centered gold stripes */}
      <path d="M 70 10 L 55 10 L 47 45 L 57 45 Z" fill={LINE} stroke={LINE} strokeWidth={2.2} strokeLinejoin="round" />
      <path d="M 64.5 11.5 L 59.5 11.5 L 51 43.5 L 54.5 43.5 Z" fill={FILL} />
      {/* Cast overlap shadow on right strap */}
      <path d="M 48 34 L 54 45 L 47 45 Z" fill="rgba(0, 0, 0, 0.25)" />
      <path d="M 30 10 L 45 10 L 53 45 L 43 45 Z" fill={LINE} stroke={LINE} strokeWidth={2.2} strokeLinejoin="round" />
      <path d="M 35.5 11.5 L 40.5 11.5 L 49 43.5 L 45.5 43.5 Z" fill={FILL} />
      <path d="M 33 13 L 44 42" stroke="rgba(255, 255, 255, 0.3)" strokeWidth={1.5} strokeLinecap="round" />

      {/* Solid metallic jump-ring bail */}
      <rect x="44.5" y="42.5" width="11" height="6.5" rx="3" fill={FILL} stroke={LINE} strokeWidth={2.2} />

      {/* Medallion disc with beveled shading and inner reeding */}
      <circle cx="50" cy="68" r="22" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2.7} />
      <path
        d="M 65 52 A 21 21 0 0 1 35 84 A 19 19 0 0 0 65 52 Z"
        fill="rgba(0, 0, 0, 0.16)"
      />
      <path
        d="M 34 59 A 18 18 0 0 1 46 50"
        fill="none"
        stroke="rgba(255, 255, 255, 0.65)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx="50" cy="68" r="16.5" fill="none" stroke={LINE} strokeWidth={1.3} strokeDasharray="1.5 2.5" />
      <polygon
        points="50,57 52.6,64.4 60.5,64.6 54.2,69.4 56.5,76.9 50,72.4 43.5,76.9 45.8,69.4 39.5,64.6 47.4,64.4"
        fill={LINE}
      />
    </Frame>
  );
}

function Tortoise(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Far back & front feet */}
      <path d="M 21 62 C 18 70, 20 76, 26 78 C 31 78, 33 72, 33 64" fill={LINE} />
      <path d="M 64 62 C 66 69, 68 75, 74 77 C 79 77, 80 71, 78 64" fill={LINE} />
      {/* Raised eager neck & head tucked cleanly behind front shell rim */}
      <path
        d="M 67 60 C 72 52, 75 43, 83 37 C 92 32, 97 38, 95 45 C 93 53, 86 60, 75 62 C 71 63, 68 62, 67 60 Z"
        fill={FILL}
        stroke={LINE}
        strokeWidth={2.7}
        strokeLinejoin="round"
      />
      {/* Perky tail */}
      <path
        d="M 16 57 C 9 50, 9 43, 14 43 C 17 47, 18 53, 20 58 Z"
        fill={FILL}
        stroke={LINE}
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
      {/* Main carapace dome */}
      <path
        d="M 14 61 C 13 28, 74 26, 76 61 C 59 63, 28 63, 14 61 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.8}
        strokeLinejoin="round"
      />
      {/* Lower-right shell shading & upper-left specular highlight */}
      <path
        d="M 62 34 C 71 40, 74 50, 74 60 C 62 62, 46 62, 34 61 C 52 59, 64 50, 62 34 Z"
        fill="rgba(0, 0, 0, 0.16)"
      />
      <path
        d="M 24 44 C 31 35, 45 32, 57 35"
        stroke="rgba(255, 255, 255, 0.6)"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      {/* Scute plates terminating cleanly above the flared rim */}
      <path d="M 36 43 L 53 43 L 60 51 L 53 59 L 36 59 L 29 51 Z" fill="none" stroke={LINE} strokeWidth={1.8} strokeLinejoin="round" />
      <path
        d="M 44.5 43 L 44.5 34 M 53 43 L 61 37 M 60 51 L 73 53 M 53 59 L 55 61 M 36 59 L 34 61 M 29 51 L 16 53 M 36 43 L 27 37"
        fill="none"
        stroke={LINE}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      {/* Flared bottom carapace lip */}
      <path
        d="M 12 61 C 28 65, 62 65, 78 61 C 78 65, 74 66, 70 66 C 55 68, 33 68, 19 66 C 14 66, 12 64, 12 61 Z"
        fill={FILL}
        stroke={LINE}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      {/* Near rear & front feet */}
      <path d="M 25 65 C 25 74, 28 80, 35 80 C 41 80, 43 73, 40 65 Z" fill={FILL} stroke={LINE} strokeWidth={2.6} strokeLinejoin="round" />
      <path d="M 56 65 C 57 74, 60 80, 68 80 C 74 80, 76 73, 73 65 Z" fill={FILL} stroke={LINE} strokeWidth={2.6} strokeLinejoin="round" />
      <circle cx="31" cy="77.5" r="1.3" fill={LINE} />
      <circle cx="36" cy="77.5" r="1.3" fill={LINE} />
      <circle cx="64" cy="77.5" r="1.3" fill={LINE} />
      <circle cx="69" cy="77.5" r="1.3" fill={LINE} />
      {/* Happy smile, eye with specular glint, and brow */}
      <path d="M 85 46 Q 90 50 94 44" fill="none" stroke={LINE} strokeWidth={2} strokeLinecap="round" />
      <circle cx="85.5" cy="39.5" r="2.4" fill={LINE} />
      <circle cx="86.2" cy="38.8" r="0.8" fill="rgba(255, 255, 255, 0.85)" />
      <path d="M 82 35 Q 86 32 90 36" fill="none" stroke={LINE} strokeWidth={1.8} strokeLinecap="round" />
    </Frame>
  );
}

function Paintbrush(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      <g transform="translate(50, 50) rotate(42) translate(-50, -50)">
        {/* Bolder ergonomic wooden handle */}
        <path
          d="M 47.5 7 C 49 4.5, 51 4.5, 52.5 7 L 56 26 C 56.5 33, 55.5 41, 55 47 L 45 47 C 44.5 41, 43.5 33, 44 26 Z"
          fill="#8a5a2b"
          stroke={LINE}
          strokeWidth={2.6}
          strokeLinejoin="round"
        />
        <line x1="48" y1="10" x2="47.5" y2="43" stroke="rgba(255, 255, 255, 0.45)" strokeWidth={1.8} strokeLinecap="round" />
        {/* Metallic ferrule with bold legible crimp ridges */}
        <rect x="44.2" y="47" width="11.6" height="13" rx="1" fill={LINE} stroke={LINE} strokeWidth={1.6} />
        <line x1="44.2" y1="51.2" x2="55.8" y2="51.2" stroke={FILL} strokeWidth={1.8} />
        <line x1="44.2" y1="55.8" x2="55.8" y2="55.8" stroke={FILL} strokeWidth={1.8} />
        {/* Graceful S-curved artist sable bristle head */}
        <path
          d="M 44.5 60 C 40 65, 41 75, 50 86 C 56.5 78, 59.5 67, 55.5 60 Z"
          fill="url(#ttGoldGrad)"
          stroke={LINE}
          strokeWidth={2.6}
          strokeLinejoin="round"
        />
        {/* High-contrast crimson dipped paint tip */}
        <path
          d="M 44.2 74 C 46 78.5, 48.2 83, 50 86 C 52.5 82.5, 54.5 78, 55.8 73.5 C 52 75.5, 47.5 75.5, 44.2 74 Z"
          fill="var(--error, #d32f2f)"
          stroke={LINE}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        <line x1="47.5" y1="62.5" x2="48.5" y2="73" stroke={LINE} strokeWidth={1.5} strokeLinecap="round" />
        <line x1="52.5" y1="62.5" x2="51.5" y2="73" stroke={LINE} strokeWidth={1.5} strokeLinecap="round" />
        <path d="M 45.5 64 C 44 69, 45 75, 48.5 81" stroke="rgba(255, 255, 255, 0.7)" strokeWidth={1.6} strokeLinecap="round" fill="none" />
        {/* Bold falling paint droplet */}
        <path
          d="M 50 88.5 C 47.5 92, 47.5 95.5, 50 96.5 C 52.5 95.5, 52.5 92, 50 88.5 Z"
          fill="var(--error, #d32f2f)"
          stroke={LINE}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        <circle cx="49.2" cy="93.2" r="0.9" fill="rgba(255, 255, 255, 0.85)" />
      </g>
    </Frame>
  );
}

function Palette(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      <g transform="rotate(-12 50 50)">
        {/* Authentic French kidney palette contour with transparent cutout thumbhole */}
        <path
          d="M 50 15 C 23 15, 11 28, 11 50 C 11 71, 24 85, 46 85 C 58 85, 66 79, 72 79 C 77 79, 83 84, 87 74 C 91 65, 90 42, 78 26 C 68 17, 58 15, 50 15 Z M 72 54 C 75.2 54, 77.8 57, 77.8 62 C 77.8 67, 75.2 70, 72 70 C 68.8 70, 66.2 67, 66.2 62 C 66.2 57, 68.8 54, 72 54 Z"
          fill="url(#ttGoldGrad)"
          stroke={LINE}
          strokeWidth={2.8}
          strokeLinejoin="round"
          fillRule="evenodd"
        />
        {/* Lower wood rim shadow & inner thumbhole bevel */}
        <path
          d="M 21 71 C 29 79, 41 82, 53 80 C 62 79, 70 75, 76 75"
          fill="none"
          stroke="rgba(0, 0, 0, 0.16)"
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        <path
          d="M 74 55 A 5.5 7.5 0 0 0 67.5 67"
          fill="none"
          stroke="rgba(0, 0, 0, 0.24)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        {/* Upper rim specular highlight */}
        <path d="M 32 21 C 48 21, 70 27, 78 39" stroke="rgba(255, 255, 255, 0.55)" strokeWidth={2} strokeLinecap="round" fill="none" />
        {/* 5 bold distinct paint dollops with subtle drop shadow & specular pinpoints */}
        <circle cx="27.5" cy="38" r="5.5" fill="rgba(0, 0, 0, 0.2)" />
        <path d="M 27 31 C 22.5 31, 20.5 35.5, 23.5 40 C 27 43.5, 32.5 42.5, 32.5 37 C 32.5 33.5, 30.5 31, 27 31 Z" fill={LINE} />
        <circle cx="26.5" cy="34.5" r="1.4" fill="rgba(255, 255, 255, 0.85)" />

        <circle cx="43.5" cy="28" r="5.5" fill="rgba(0, 0, 0, 0.2)" />
        <path d="M 43 21 C 38.5 21, 36.5 25.5, 39.5 30 C 43 33.5, 48.5 32.5, 48.5 27 C 48.5 23.5, 46.5 21, 43 21 Z" fill="var(--error, #d32f2f)" />
        <circle cx="42.5" cy="24.5" r="1.4" fill="rgba(255, 255, 255, 0.85)" />

        <circle cx="61.5" cy="29" r="5.5" fill="rgba(0, 0, 0, 0.2)" />
        <path d="M 61 22 C 56.5 22, 54.5 26.5, 57.5 31 C 61 34.5, 66.5 33.5, 66.5 28 C 66.5 24.5, 64.5 22, 61 22 Z" fill="var(--success-color, #2e7d32)" />
        <circle cx="60.5" cy="25.5" r="1.4" fill="rgba(255, 255, 255, 0.85)" />

        <circle cx="75.5" cy="40" r="5.5" fill="rgba(0, 0, 0, 0.2)" />
        <path d="M 75 33 C 70.5 33, 68.5 37.5, 71.5 42 C 75 45.5, 80.5 44.5, 80.5 39 C 80.5 35.5, 78.5 33, 75 33 Z" fill="#8a5a2b" />
        <circle cx="74.5" cy="36.5" r="1.4" fill="rgba(255, 255, 255, 0.85)" />

        <circle cx="27.5" cy="60" r="5.5" fill="rgba(0, 0, 0, 0.2)" />
        <path d="M 27 53 C 22.5 53, 20.5 57.5, 23.5 62 C 27 65.5, 32.5 64.5, 32.5 59 C 32.5 55.5, 30.5 53, 27 53 Z" fill="#6fbcff" />
        <circle cx="26.5" cy="56.5" r="1.4" fill="rgba(255, 255, 255, 0.85)" />
      </g>
    </Frame>
  );
}

function SparkleStar(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Crisp concave astroid quad-point star */}
      <path
        d="M 50 10 C 48 36, 36 48, 20 50 C 36 52, 48 64, 50 90 C 52 64, 64 52, 80 50 C 64 48, 52 36, 50 10 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.7}
        strokeLinejoin="round"
      />
      {/* 3D faceted jewel bevels (top-left lit, bottom-right shaded) */}
      <path d="M 50 13 C 48 37, 37 48, 23 50 L 50 50 Z" fill="rgba(255, 255, 255, 0.45)" />
      <path d="M 50 87 C 52 63, 63 52, 77 50 L 50 50 Z" fill="rgba(0, 0, 0, 0.16)" />
      <path d="M 50 14 L 50 86 M 24 50 L 76 50" stroke={LINE} strokeWidth={1.3} opacity={0.35} />
      {/* Secondary companion sparkle (top right) */}
      <path
        d="M 79 14 C 78 24, 74 28, 66 29 C 74 30, 78 34, 79 44 C 80 34, 84 30, 92 29 C 84 28, 80 24, 79 14 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* Tertiary companion sparkle (bottom left) */}
      <path
        d="M 21 67 C 20 74, 17 77, 11 78 C 17 79, 20 82, 21 89 C 22 82, 25 79, 31 78 C 25 77, 22 74, 21 67 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Frame>
  );
}

function Wing(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Smooth 4-flight-feather aerodynamic wing silhouette */}
      <path
        d="M 12 68 C 20 48, 38 28, 68 21 C 80 18, 88 19, 89 23 C 89 27, 81 32, 72 36 C 81 35, 86 37, 85 41 C 84 45, 76 48, 67 51 C 74 51, 78 53, 76 57 C 74 61, 66 63, 56 65 C 42 69, 25 72, 12 68 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.7}
        strokeLinejoin="round"
      />
      {/* Subtle overlap shadow strips beneath flight feathers */}
      <path d="M 33 50 C 48 41, 61 38, 72 36 L 67 39 C 56 41, 44 45, 33 50 Z" fill="rgba(0, 0, 0, 0.15)" />
      <path d="M 28 58 C 43 51, 56 49, 67 51 L 62 54 C 51 53, 40 55, 28 58 Z" fill="rgba(0, 0, 0, 0.15)" />
      {/* Layered upper shoulder covert highlight */}
      <path
        d="M 15 66 C 22 47, 38 30, 64 24 C 55 34, 43 46, 26 59 Z"
        fill="rgba(255, 255, 255, 0.42)"
      />
      {/* Interior feather & covert vane lines */}
      <path
        d="M 24 60 C 40 47, 54 37, 65 25 M 33 50 C 47 42, 61 38, 72 36 M 28 58 C 43 52, 56 49, 67 51 M 24 65 C 36 61, 47 60, 58 64"
        fill="none"
        stroke={LINE}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Frame>
  );
}

function FlagStar(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Gently waving S-curve swallowtail pennant */}
      <path
        d="M 29 20 C 44 16, 58 24, 77 20 L 68 33 L 77 46 C 58 50, 44 42, 29 46 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.7}
        strokeLinejoin="round"
      />
      {/* Subtle crest highlight & wave trough fold shadow */}
      <path d="M 32 22 C 39 20, 46 21, 51 22.5 L 51 43.5 C 46 42, 39 42, 32 44 Z" fill="rgba(255, 255, 255, 0.42)" />
      <path d="M 52 22.5 C 58 23.5, 64 23, 69 22 L 66 33 L 69 44 C 64 45, 58 45, 52 43.5 Z" fill="rgba(0, 0, 0, 0.16)" />
      {/* Optically centered 5-point star inside pennant body */}
      <polygon
        points="49,24.5 51.1,30.4 57.3,30.6 52.4,34.4 54.1,40.3 49,36.8 43.9,40.3 45.6,34.4 40.7,30.6 46.9,30.4"
        fill={LINE}
      />
      {/* Sleek rounded flagpole topped with a gold finial */}
      <rect x="25.5" y="18" width="5" height="68" rx="2.5" fill={LINE} />
      <circle cx="28" cy="14.5" r="4.5" fill={FILL} stroke={LINE} strokeWidth={2.4} />
      <circle cx="26.8" cy="13.2" r="1.1" fill="rgba(255, 255, 255, 0.75)" />
    </Frame>
  );
}

function CompassStar(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Double-bezel dial ring with 8 crisp trigonometric degree ticks */}
      <circle cx="50" cy="50" r="39" fill="none" stroke={LINE} strokeWidth={2.6} />
      <circle cx="50" cy="50" r="35" fill="none" stroke={LINE} strokeWidth={1.2} />
      <path
        d="M 50 11 L 50 14.5 M 89 50 L 85.5 50 M 50 89 L 50 85.5 M 11 50 L 14.5 50 M 77.6 22.4 L 75 25 M 77.6 77.6 L 75 75 M 22.4 77.6 L 25 75 M 22.4 22.4 L 25 25"
        stroke={LINE}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      {/* Secondary ordinal points (NE, SE, SW, NW) */}
      <polygon points="50,50 67,33 50,45.5" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points="50,50 67,33 54.5,50" fill={LINE} stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points="50,50 67,67 54.5,50" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points="50,50 67,67 50,54.5" fill={LINE} stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points="50,50 33,67 50,54.5" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points="50,50 33,67 45.5,50" fill={LINE} stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points="50,50 33,33 45.5,50" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points="50,50 33,33 50,45.5" fill={LINE} stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" />
      {/* Primary cardinal points (N, E, S, W) - 3D faceted */}
      <polygon points="50,50 50,15 43,50" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
      <polygon points="50,50 50,15 57,50" fill={LINE} stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
      <polygon points="50,50 85,50 50,43" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
      <polygon points="50,50 85,50 50,57" fill={LINE} stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
      <polygon points="50,50 50,85 57,50" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
      <polygon points="50,50 50,85 43,50" fill={LINE} stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
      <polygon points="50,50 15,50 50,57" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
      <polygon points="50,50 15,50 50,43" fill={LINE} stroke={LINE} strokeWidth={1.7} strokeLinejoin="round" />
      {/* Beveled center pivot cap */}
      <circle cx="50" cy="50" r="5" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2} />
      <circle cx="48.5" cy="48.5" r="1.3" fill="rgba(255, 255, 255, 0.85)" />
    </Frame>
  );
}

function Gavel(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Two-tier stepped sound block plinth */}
      <path
        d="M 27 81 C 27 76, 31 74, 36 74 L 64 74 C 69 74, 73 76, 73 81 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <rect x="20" y="81" width="60" height="7" rx="2" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2.5} />
      <path d="M 24 85.5 L 76 85.5" stroke="rgba(0, 0, 0, 0.18)" strokeWidth={1.8} strokeLinecap="round" />

      {/* Gavel handle lifted cleanly clear of sound block */}
      <path
        d="M 18 63 L 51 34 L 57 40 L 24 69 C 21 71.5, 16.5 69.5, 15.5 66.5 C 14.8 64, 16.5 62, 18 63 Z"
        fill="#8a5a2b"
        stroke={LINE}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <line x1="21.5" y1="62.5" x2="49.5" y2="38" stroke="rgba(255, 255, 255, 0.5)" strokeWidth={1.4} strokeLinecap="round" />

      {/* Sculpted gavel head with chamfered end caps and raised collar band */}
      <g transform="translate(61, 30) rotate(42)">
        <rect
          x="-23"
          y="-11.5"
          width="46"
          height="23"
          rx="4.5"
          fill="url(#ttGoldGrad)"
          stroke={LINE}
          strokeWidth={2.6}
        />
        {/* Bottom-cylinder depth shadow */}
        <path d="M -20 5.5 L 20 5.5" stroke="rgba(0, 0, 0, 0.18)" strokeWidth={4} strokeLinecap="round" />
        {/* Raised center metallic collar band */}
        <rect x="-10" y="-12.5" width="20" height="25" rx="1.5" fill={LINE} />
        <line x1="-7" y1="-11" x2="-7" y2="11" stroke={FILL} strokeWidth={1.2} />
        <line x1="7" y1="-11" x2="7" y2="11" stroke={FILL} strokeWidth={1.2} />
        {/* Top-cylinder specular highlights on gold caps */}
        <path d="M -19 -6.5 L -12 -6.5 M 12 -6.5 L 19 -6.5" stroke="rgba(255, 255, 255, 0.7)" strokeWidth={1.8} strokeLinecap="round" />
      </g>

      {/* Clean impact sparks in the striking gap */}
      <path
        d="M 65 65 L 68 58 M 72 67 L 78 62 M 75 72 L 82 70"
        stroke={LINE}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Frame>
  );
}

const ARTWORK: Record<string, (props: ArtworkProps) => ReactElement> = {
  trophy: Trophy,
  medal: Medal,
  tortoise: Tortoise,
  paintbrush: Paintbrush,
  palette: Palette,
  'sparkle-star': SparkleStar,
  wing: Wing,
  'flag-star': FlagStar,
  'compass-star': CompassStar,
  gavel: Gavel,
};

/** Every artwork key this build can draw. Exported for the picker and tests. */
// eslint-disable-next-line react-refresh/only-export-components
export const ARTWORK_KEYS: readonly string[] = Object.keys(ARTWORK);

/** Whether a key has a picture — used to decide "plain certificate" vs not. */
// eslint-disable-next-line react-refresh/only-export-components
export function hasArtwork(key: string | null | undefined): key is string {
  return !!key && key in ARTWORK;
}

/**
 * The artwork for one key, or nothing.
 *
 * Null rather than a placeholder box: a plain certificate with no picture is
 * the ordinary state for an award with no template and no `SPEED` rule to
 * derive one from, and a broken-image square would read as an error.
 *
 * `variant="dark"` is for the ceremony slide's dark background (#400); every
 * other caller — the certificate, the Awards list — leaves it at the
 * default `"light"`.
 */
export default function AwardArtwork({
  artworkKey,
  ...props
}: ArtworkProps & { artworkKey: string | null | undefined }) {
  const Component = artworkKey ? ARTWORK[artworkKey] : undefined;
  if (!Component) return null;
  return <Component {...props} />;
}
