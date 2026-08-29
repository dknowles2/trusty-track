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
 * light background, where the every-shape's outline colour — `--scouting-
 * blue` — reads fine against white. The ceremony slide (`AwardCeremony`)
 * paints its *background* in that same navy, so every blue line and blue
 * fill drawn against it disappeared: the line colour and the page colour
 * were the same variable. `variant="dark"` swaps every one of those blue
 * strokes and fills for white, which is why `LINE` — not a second constant
 * sprinkled through each shape — is threaded through every shape function:
 * missing one leaves a component that still goes blue-on-navy in exactly the
 * spot nobody photographs until the ceremony runs for real. Gold is left
 * alone in both variants; it already has contrast against navy and against
 * white.
 */

import { ReactElement, ReactNode } from 'react';

const BLUE = 'var(--scouting-blue, #003F87)';
const GOLD = 'var(--cub-scouting-gold, #FCD116)';
const WHITE = '#ffffff';

/** Which background this piece is drawn against. Defaults to 'light' — the
 *  certificate and the Awards list, every caller before the ceremony
 *  slide's navy background existed. */
type ArtworkVariant = 'light' | 'dark';

interface ArtworkProps {
  /** Square, in CSS pixels. */
  size?: number;
  className?: string;
  variant?: ArtworkVariant;
}

/** The one line/detail colour a shape uses in place of `--scouting-blue`,
 *  chosen from its background. Every shape below reads `LINE`, never `BLUE`
 *  directly, so a background-aware palette cannot be half-applied. */
function lineColor(variant: ArtworkVariant | undefined): string {
  return variant === 'dark' ? WHITE : BLUE;
}

function Frame({
  size = 96,
  className,
  children,
}: ArtworkProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Trophy(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <path
        d="M30 18h40v14a20 20 0 0 1-40 0z"
        fill={GOLD}
        stroke={LINE}
        strokeWidth={3}
      />
      <path
        d="M30 22h-9a9 9 0 0 0 9 14M70 22h9a9 9 0 0 1-9 14"
        fill="none"
        stroke={LINE}
        strokeWidth={3}
      />
      <rect x="46" y="50" width="8" height="16" fill={LINE} />
      <rect x="34" y="66" width="32" height="8" rx="3" fill={LINE} />
      <rect x="26" y="74" width="48" height="8" rx="3" fill={GOLD} stroke={LINE} strokeWidth={2} />
    </Frame>
  );
}

function Medal(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <path d="M38 8 L50 46 L62 8" fill="none" stroke={LINE} strokeWidth={10} />
      <circle cx="50" cy="66" r="24" fill={GOLD} stroke={LINE} strokeWidth={3} />
      <path d="M50 52 L57 62 L50 80 L43 62 Z" fill={LINE} />
    </Frame>
  );
}

function Tortoise(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <ellipse cx="50" cy="55" rx="30" ry="22" fill={GOLD} stroke={LINE} strokeWidth={3} />
      <path
        d="M50 33v44M28 43l44 24M72 43 28 67"
        stroke={LINE}
        strokeWidth={2}
        opacity={0.6}
      />
      <circle cx="80" cy="46" r="9" fill={GOLD} stroke={LINE} strokeWidth={3} />
      <circle cx="26" cy="72" r="7" fill={GOLD} stroke={LINE} strokeWidth={3} />
      <circle cx="70" cy="76" r="7" fill={GOLD} stroke={LINE} strokeWidth={3} />
      <circle cx="30" cy="34" r="7" fill={GOLD} stroke={LINE} strokeWidth={3} />
    </Frame>
  );
}

function Paintbrush(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <rect
        x="42"
        y="14"
        width="16"
        height="14"
        rx="3"
        fill={LINE}
        transform="rotate(45 50 21)"
      />
      <rect
        x="46"
        y="26"
        width="8"
        height="34"
        fill="#8a5a2b"
        transform="rotate(45 50 43)"
      />
      <path
        d="M62 56c8 8 8 20-2 26-8 5-18 1-18-8 0-6 4-9 9-9-3-6 3-15 11-9z"
        fill={GOLD}
        stroke={LINE}
        strokeWidth={3}
      />
    </Frame>
  );
}

function Palette(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <path
        d="M50 14c-22 0-36 14-36 30 0 12 8 18 16 18 4 0 4-4 2-7-3-4 1-8 6-8h4c14 0 26-11 26-24 0-6-8-9-18-9z"
        fill={GOLD}
        stroke={LINE}
        strokeWidth={3}
      />
      <circle cx="38" cy="30" r="4" fill={LINE} />
      <circle cx="52" cy="24" r="4" fill="var(--error, #d32f2f)" />
      <circle cx="64" cy="32" r="4" fill="#2e7d32" />
      <circle cx="30" cy="44" r="4" fill={LINE} />
    </Frame>
  );
}

function SparkleStar(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <path
        d="M50 12c2 14 6 18 20 20-14 2-18 6-20 20-2-14-6-18-20-20 14-2 18-6 20-20z"
        fill={GOLD}
        stroke={LINE}
        strokeWidth={3}
      />
      <path d="M78 62c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9z" fill={GOLD} />
      <path d="M22 66c1 5 2 6 7 7-5 1-6 2-7 7-1-5-2-6-7-7 5-1 6-2 7-7z" fill={GOLD} />
    </Frame>
  );
}

function Wing(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <path
        d="M14 62c18-2 30-10 40-32 4 20-2 34-16 42 10-2 18-8 24-18 4 16-4 28-20 32-14 3-26-4-32-16 4 0 3-4 4-8z"
        fill={GOLD}
        stroke={LINE}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <path
        d="M26 56c10-2 18-8 24-22M32 66c8-2 15-7 20-16"
        fill="none"
        stroke={LINE}
        strokeWidth={2}
        opacity={0.6}
      />
    </Frame>
  );
}

function FlagStar(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <rect x="30" y="14" width="6" height="70" fill={LINE} />
      <path d="M36 18h34l-8 12 8 12H36z" fill={GOLD} stroke={LINE} strokeWidth={3} />
      <path
        d="M53 24l2.4 5 5.4.6-4 3.7 1.1 5.4L53 36l-4.9 2.7L49.2 33l-4-3.7 5.4-.6z"
        fill={LINE}
      />
    </Frame>
  );
}

function CompassStar(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <circle cx="50" cy="50" r="34" fill="none" stroke={LINE} strokeWidth={4} />
      <path d="M50 20 L58 50 L50 80 L42 50 Z" fill={GOLD} stroke={LINE} strokeWidth={2} />
      <path d="M20 50 L50 42 L80 50 L50 58 Z" fill={LINE} opacity={0.85} />
      <circle cx="50" cy="50" r="5" fill={LINE} />
    </Frame>
  );
}

function Gavel(props: ArtworkProps) {
  const LINE = lineColor(props.variant);
  return (
    <Frame {...props}>
      <rect
        x="46"
        y="18"
        width="30"
        height="16"
        rx="3"
        fill={LINE}
        transform="rotate(45 61 26)"
      />
      <rect
        x="52"
        y="36"
        width="12"
        height="10"
        fill={LINE}
        transform="rotate(45 58 41)"
      />
      <rect
        x="20"
        y="52"
        width="46"
        height="9"
        rx="3"
        fill="#8a5a2b"
        transform="rotate(-30 43 56)"
      />
      <rect x="18" y="76" width="40" height="8" rx="3" fill={GOLD} stroke={LINE} strokeWidth={2} />
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
 * `variant="dark"` is for the ceremony slide's navy background (#400); every
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
