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
        <linearGradient id="ttGoldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={fill} stopOpacity="0.85" />
          <stop offset="35%" stopColor={fill} stopOpacity="1" />
          <stop offset="50%" stopColor="rgba(255, 255, 255, 0.45)" />
          <stop offset="70%" stopColor={fill} stopOpacity="1" />
          <stop offset="100%" stopColor={fill} stopOpacity="0.8" />
        </linearGradient>
      </defs>
      {children}
    </svg>
  );
}

function Trophy(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      <path
        d="M22 28 C 14 28, 10 38, 14 48 C 18 56, 26 58, 32 58"
        fill="none"
        stroke={LINE}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d="M78 28 C 86 28, 90 38, 86 48 C 82 56, 74 58, 68 58"
        fill="none"
        stroke={LINE}
        strokeWidth={3}
        strokeLinecap="round"
      />
      {/* Trophy Cup with Metallic Lacquer Gradient */}
      <path
        d="M28 22 L72 22 C72 44, 62 60, 50 64 C38 60, 28 44, 28 22 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <ellipse cx="50" cy="22" rx="22" ry="3.5" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2} />
      {/* Specular Glint Highlight on Cup */}
      <path
        d="M44 26 C44 38, 42 52, 48 58"
        stroke="rgba(255, 255, 255, 0.65)"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      {/* Center Star on Cup */}
      <polygon
        points="50,32 52,38 58,38 53,42 55,48 50,44 45,48 47,42 42,38 48,38"
        fill={LINE}
      />
      {/* Stem & Pedestal */}
      <rect x="46" y="64" width="8" height="8" fill={LINE} />
      <path d="M34 72 L66 72 L70 80 L30 80 Z" fill={LINE} />
      <rect x="24" y="80" width="52" height="7" rx="2" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2} />
      {/* Base Specular Glint */}
      <path d="M28 82 L72 82" stroke="rgba(255, 255, 255, 0.55)" strokeWidth={1.5} strokeLinecap="round" />
    </Frame>
  );
}

function Medal(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      <path
        d="M34 10L46 46L54 46L66 10L52 10L50 36L48 10Z"
        fill={LINE}
        stroke={LINE}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <path d="M38 10L48 40L44 40L34 10Z" fill={FILL} opacity={0.9} />
      <path d="M62 10L52 40L56 40L66 10Z" fill={FILL} opacity={0.9} />
      {/* Ribbon Fold Highlight */}
      <path d="M40 18 L46 42" stroke="rgba(255, 255, 255, 0.35)" strokeWidth={1.8} strokeLinecap="round" />
      <rect x="46" y="44" width="8" height="5" rx="2" fill="none" stroke={LINE} strokeWidth={2} />
      {/* Medallion Disc with Gradient */}
      <circle cx="50" cy="68" r="22" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2.5} />
      <circle cx="50" cy="68" r="17" fill="none" stroke={LINE} strokeWidth={1} strokeDasharray="2 2" />
      {/* Specular Medallion Glint */}
      <circle cx="43" cy="54" r="4.5" fill="rgba(255, 255, 255, 0.4)" />
      <polygon
        points="50,56 53,64 61,64 55,69 57,77 50,72 43,77 45,69 39,64 47,64"
        fill={LINE}
      />
    </Frame>
  );
}

function Tortoise(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Rear Back Foot */}
      <path d="M 23 60 C 20 67, 22 72, 27 74 C 31 74, 33 69, 33 62" fill={LINE} />
      {/* Front Far Foot */}
      <path d="M 64 60 C 66 66, 68 71, 73 73 C 77 73, 78 68, 77 62" fill={LINE} />
      {/* Perky Tail pointing up */}
      <path d="M 18 56 C 11 50, 11 44, 15 44 C 18 48, 19 53, 21 57 Z" fill={FILL} stroke={LINE} strokeWidth={2.5} strokeLinejoin="round" />
      {/* Main Shell Carapace Dome with Metallic Lacquer Gradient */}
      <path d="M 17 62 C 16 33, 73 31, 75 62 C 60 64, 30 64, 17 62 Z" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2.8} strokeLinejoin="round" />
      {/* Shell Specular Highlight Arc */}
      <path d="M 40 44 C 47 38, 57 38, 64 44" stroke="rgba(255, 255, 255, 0.6)" strokeWidth={1.8} strokeLinecap="round" fill="none" />
      {/* Shell Rim trim */}
      <path d="M 16 62 C 30 65, 62 65, 76 62" fill="none" stroke={LINE} strokeWidth={2.5} strokeLinecap="round" />
      {/* Scute Plates Pattern */}
      <path d="M 37 44 L 53 44 L 59 52 L 53 61 L 37 61 L 31 52 Z" fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
      <path d="M 45 44 L 45 35 M 53 44 L 63 38 M 59 52 L 72 54 M 53 61 L 56 63 M 37 61 L 34 63 M 31 52 L 19 53 M 37 44 L 27 38" fill="none" stroke={LINE} strokeWidth={1.8} strokeLinecap="round" />
      {/* Near Rear Foot */}
      <path d="M 27 63 C 27 71, 29 76, 35 76 C 41 76, 42 70, 40 63 Z" fill={FILL} stroke={LINE} strokeWidth={2.5} strokeLinejoin="round" />
      {/* Near Front Foot */}
      <path d="M 57 63 C 58 71, 61 76, 68 76 C 73 76, 75 70, 72 63 Z" fill={FILL} stroke={LINE} strokeWidth={2.5} strokeLinejoin="round" />
      {/* Cute toenail details */}
      <circle cx="32" cy="74" r="1.2" fill={LINE} />
      <circle cx="36" cy="74" r="1.2" fill={LINE} />
      <circle cx="64" cy="74" r="1.2" fill={LINE} />
      <circle cx="68" cy="74" r="1.2" fill={LINE} />
      {/* Eager, Happy Raised Neck & Head */}
      <path d="M 68 56 C 73 49, 76 43, 83 39 C 91 35, 95 40, 94 46 C 92 53, 86 58, 76 60 C 72 61, 70 61, 68 59" fill={FILL} stroke={LINE} strokeWidth={2.5} strokeLinejoin="round" />
      {/* Big happy upturned smile */}
      <path d="M 85 47 Q 89 51 93 45" fill="none" stroke={LINE} strokeWidth={2} strokeLinecap="round" />
      {/* Happy open eye & eyebrow */}
      <circle cx="85" cy="41" r="2.2" fill={LINE} />
      <path d="M 82 37 Q 86 34 90 38" fill="none" stroke={LINE} strokeWidth={1.8} strokeLinecap="round" />
    </Frame>
  );
}

function Paintbrush(props: ArtworkProps) {
  const { line: LINE, fill: FILL } = resolvePalette(props);
  return (
    <Frame {...props}>
      <g transform="translate(50, 50) rotate(45) translate(-50, -50)">
        {/* Wooden Handle with straight central axis and ergonomic profile */}
        <path
          d="M 48 10 C 49 8, 51 8, 52 10 L 54 26 C 54.5 32, 53.5 42, 53.2 48 L 46.8 48 C 46.5 42, 45.5 32, 46 26 Z"
          fill="#8a5a2b"
          stroke={LINE}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {/* Cylindrical Handle highlight reflection */}
        <line x1="50" y1="12" x2="50" y2="44" stroke="rgba(255, 255, 255, 0.45)" strokeWidth={1.5} strokeLinecap="round" />
        {/* Metallic Ferrule */}
        <rect x="46" y="48" width="8" height="14" rx="0.5" fill={LINE} />
        {/* Ferrule Crimp Bands */}
        <line x1="46" y1="52" x2="54" y2="52" stroke={FILL} strokeWidth={1} />
        <line x1="46" y1="56" x2="54" y2="56" stroke={FILL} strokeWidth={1} />
        {/* Bristle Head with Gold Gradient */}
        <path
          d="M 46 62 C 43 66, 44 74, 50 84 C 56 74, 57 66, 54 62 Z"
          fill="url(#ttGoldGrad)"
          stroke={LINE}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
        {/* Bristle Hair Split Lines */}
        <line x1="48" y1="64" x2="49" y2="76" stroke={LINE} strokeWidth={1.3} strokeLinecap="round" />
        <line x1="52" y1="64" x2="51" y2="76" stroke={LINE} strokeWidth={1.3} strokeLinecap="round" />
        {/* Specular Bristle Glint */}
        <path d="M 48 66 C 47 70, 48 76, 50 82" stroke="rgba(255, 255, 255, 0.7)" strokeWidth={1.5} strokeLinecap="round" fill="none" />
        {/* Wet Paint Dipped Tip */}
        <path
          d="M 46.5 74 C 47.5 77, 49 82, 50 84 C 51 82, 52.5 77, 53.5 74 C 51.5 75.5, 48.5 75.5, 46.5 74 Z"
          fill={LINE}
        />
        {/* Paint Droplet with Glint */}
        <path d="M 49 89 C 48 91, 48 93, 50 94 C 52 93, 52 91, 51 89 Z" fill={LINE} />
        <circle cx="49.5" cy="91.5" r="0.8" fill="rgba(255, 255, 255, 0.8)" />
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
          d="M 50 16 C 24 16, 12 28, 12 50 C 12 70, 24 84, 46 84 C 58 84, 66 78, 72 78 C 77 78, 83 83, 87 74 C 91 65, 90 42, 78 26 C 68 18, 58 16, 50 16 Z M 72 54 C 75 54, 77.5 57, 77.5 62 C 77.5 67, 75 70, 72 70 C 69 70, 66.5 67, 66.5 62 C 66.5 57, 69 54, 72 54 Z"
          fill="url(#ttGoldGrad)"
          stroke={LINE}
          strokeWidth={2.8}
          strokeLinejoin="round"
          fillRule="evenodd"
        />
        {/* Edge Bevel Specular Highlight */}
        <path d="M 32 22 C 48 22, 70 28, 78 40" stroke="rgba(255, 255, 255, 0.55)" strokeWidth={2} strokeLinecap="round" fill="none" />
        {/* Viscous teardrop paint dollops with specular pinpoints */}
        <path d="M 28 32 C 24 32, 22 36, 25 40 C 28 43, 33 42, 33 37 C 33 34, 31 32, 28 32 Z" fill={LINE} />
        <circle cx="28" cy="35" r="1.2" fill="rgba(255, 255, 255, 0.85)" />
        <path d="M 43 23 C 39 23, 37 27, 40 31 C 43 34, 48 33, 48 28 C 48 25, 46 23, 43 23 Z" fill="var(--error, #d32f2f)" />
        <circle cx="43" cy="26" r="1.2" fill="rgba(255, 255, 255, 0.85)" />
        <path d="M 61 24 C 57 24, 55 28, 58 32 C 61 35, 66 34, 66 29 C 66 26, 64 24, 61 24 Z" fill="var(--success-color, #2e7d32)" />
        <circle cx="61" cy="27" r="1.2" fill="rgba(255, 255, 255, 0.85)" />
        <path d="M 75 35 C 71 35, 69 39, 72 43 C 75 46, 80 45, 80 40 C 80 37, 78 35, 75 35 Z" fill="#8a5a2b" />
        <circle cx="75" cy="38" r="1.2" fill="rgba(255, 255, 255, 0.85)" />
        <path d="M 28 53 C 24 53, 22 57, 25 61 C 28 64, 33 63, 33 58 C 33 55, 31 53, 28 53 Z" fill={LINE} opacity={0.8} />
        <circle cx="28" cy="56" r="1.2" fill="rgba(255, 255, 255, 0.85)" />
        {/* Central paint mixing swirl */}
        <path d="M 44 54 Q 52 61 58 53 Q 61 46 54 45" fill="none" stroke={LINE} strokeWidth={1.3} strokeDasharray="2 3" opacity={0.5} strokeLinecap="round" />
      </g>
    </Frame>
  );
}

function SparkleStar(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Quad-Point Star (MDI StarFourPoints Geometry) with Gold Sheen */}
      <path
        d="M 50 10 Q 50 34 26 50 Q 50 66 50 90 Q 50 66 74 50 Q 50 34 50 10 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
      {/* Facet Spine Lines */}
      <path d="M 50 14 L 50 86" stroke={LINE} strokeWidth={1.5} opacity={0.35} />
      <path d="M 28 50 L 72 50" stroke={LINE} strokeWidth={1.5} opacity={0.35} />
      {/* Luminous Specular Center Core */}
      <circle cx="50" cy="50" r="4.5" fill="rgba(255, 255, 255, 0.9)" />
      {/* Secondary Companion Sparkle (Top Right) */}
      <path
        d="M 80 18 Q 80 26 72 30 Q 80 34 80 42 Q 80 34 88 30 Q 80 26 80 18 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <circle cx="80" cy="30" r="1.5" fill="rgba(255, 255, 255, 0.9)" />
      {/* Tertiary Companion Sparkle (Bottom Left) */}
      <path
        d="M 20 68 Q 20 74 14 77 Q 20 80 20 86 Q 20 80 26 77 Q 20 74 20 68 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle cx="20" cy="77" r="1.2" fill="rgba(255, 255, 255, 0.9)" />
    </Frame>
  );
}

function Wing(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      <path
        d="M14 66C22 52 38 32 64 24C78 20 86 21 88 23C86 27 78 32 72 36C80 34 86 36 86 38C82 43 74 47 68 50C74 49 78 51 78 53C74 58 66 61 58 64C44 69 28 72 14 66Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.8}
        strokeLinejoin="round"
      />
      {/* Specular Wing Arc */}
      <path d="M22 62 C34 48, 54 30, 80 23" stroke="rgba(255, 255, 255, 0.45)" strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <path
        d="M36 50C48 42 62 38 72 36M32 58C44 52 56 48 68 50M28 65C38 60 48 58 58 64"
        fill="none"
        stroke={LINE}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Frame>
  );
}

function FlagStar(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      <rect x="30" y="14" width="6" height="70" fill={LINE} />
      <path d="M36 18h34l-8 12 8 12H36z" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={2.5} />
      <line x1="38" y1="20" x2="64" y2="20" stroke="rgba(255, 255, 255, 0.55)" strokeWidth={1.5} strokeLinecap="round" />
      <path
        d="M53 24l2.4 5 5.4.6-4 3.7 1.1 5.4L53 36l-4.9 2.7L49.2 33l-4-3.7 5.4-.6z"
        fill={LINE}
      />
    </Frame>
  );
}

function CompassStar(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Calibrated Dial Rings (MDI CompassRose Structure) */}
      <circle cx="50" cy="50" r="38" fill="none" stroke={LINE} strokeWidth={2.4} />
      <circle cx="50" cy="50" r="34" fill="none" stroke={LINE} strokeWidth={1.2} strokeDasharray="2 4" />
      {/* Secondary Ordinal Points (NE, SE, SW, NW) */}
      <polygon points="50,50 68,32 50,44" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.2} />
      <polygon points="50,50 68,32 56,50" fill={LINE} stroke={LINE} strokeWidth={1.2} />
      <polygon points="50,50 68,68 56,50" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.2} />
      <polygon points="50,50 68,68 50,56" fill={LINE} stroke={LINE} strokeWidth={1.2} />
      <polygon points="50,50 32,68 50,56" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.2} />
      <polygon points="50,50 32,68 44,50" fill={LINE} stroke={LINE} strokeWidth={1.2} />
      <polygon points="50,50 32,32 44,50" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.2} />
      <polygon points="50,50 32,32 50,44" fill={LINE} stroke={LINE} strokeWidth={1.2} />
      {/* Primary Cardinal Points (N, E, S, W) - 3D Faceted */}
      <polygon points="50,50 50,14 43,50" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.8} />
      <polygon points="50,50 50,14 57,50" fill={LINE} stroke={LINE} strokeWidth={1.8} />
      <polygon points="50,50 86,50 50,43" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.8} />
      <polygon points="50,50 86,50 50,57" fill={LINE} stroke={LINE} strokeWidth={1.8} />
      <polygon points="50,50 50,86 57,50" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.8} />
      <polygon points="50,50 50,86 43,50" fill={LINE} stroke={LINE} strokeWidth={1.8} />
      <polygon points="50,50 14,50 50,57" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.8} />
      <polygon points="50,50 14,50 50,43" fill={LINE} stroke={LINE} strokeWidth={1.8} />
      {/* Center Pivot Pin */}
      <circle cx="50" cy="50" r="4.5" fill="url(#ttGoldGrad)" stroke={LINE} strokeWidth={1.8} />
      <circle cx="48.5" cy="48.5" r="1.2" fill="rgba(255, 255, 255, 0.9)" />
    </Frame>
  );
}

function Gavel(props: ArtworkProps) {
  const { line: LINE } = resolvePalette(props);
  return (
    <Frame {...props}>
      {/* Sound Block Plinth (MDI Gavel Base Structure with 3D Bevel) */}
      <path
        d="M 24 82 C 24 76, 28 74, 34 74 L 66 74 C 72 74, 76 76, 76 82 L 80 88 L 20 88 Z"
        fill="url(#ttGoldGrad)"
        stroke={LINE}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <path d="M 28 82 L 72 82" stroke={LINE} strokeWidth={1.5} />
      {/* Gavel Handle */}
      <path
        d="M 22 75 L 53 44 L 59 50 L 28 81 C 25 84, 20 81, 19 78 C 18 75, 20 73, 22 75 Z"
        fill="#8a5a2b"
        stroke={LINE}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <line x1="26" y1="73" x2="52" y2="47" stroke="rgba(255, 255, 255, 0.5)" strokeWidth={1.2} strokeLinecap="round" />
      {/* Gavel Head (MDI Gavel Head Structure) */}
      <g transform="translate(62, 34) rotate(45)">
        <rect
          x="-24"
          y="-12"
          width="48"
          height="24"
          rx="4"
          fill="url(#ttGoldGrad)"
          stroke={LINE}
          strokeWidth={2.4}
        />
        <rect x="-10" y="-12" width="20" height="24" fill={LINE} />
        <path
          d="M -20 -7 L 20 -7"
          stroke="rgba(255, 255, 255, 0.7)"
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </g>
      {/* Dynamic Impact Sparks */}
      <path
        d="M 72 68 L 78 64 M 64 66 L 68 60 M 76 74 L 83 72"
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
