/**
 * Matching a lane's colour on screen to the colour painted on the track
 * (#611, stage 3).
 *
 * Mirrors `backend/domain/lane_colors.py` — the two must not disagree about
 * what a preset contains or how a lane's colour is looked up, the same
 * reasoning `DEFAULT_SCALE_RATIO` in `SystemSettings.tsx` already carries for
 * `domain.scale_speed.DEFAULT_SCALE` (#610). If that module changes, this
 * one needs the matching edit.
 *
 * `Track.laneColors` is indexed by the track's own lane number, one-based —
 * never the timer's. See the backend module's docstring for why
 * `reverseLanes` does not enter into this at all: `HeatLane.lane` already
 * holds the track's own number, the one that matches the paint, and a
 * second translation here would un-cross what `TimerManager` correctly
 * crosses once at the wire boundary.
 */

export interface LaneColorPreset {
  name: string;
  hex: string;
}

/** The standard BSA four-lane colour order: red, white, blue, yellow. */
export const STANDARD_4_LANE_COLORS: readonly LaneColorPreset[] = [
  { name: 'Red', hex: '#E53935' },
  { name: 'White', hex: '#FAFAFA' },
  { name: 'Blue', hex: '#1E88E5' },
  { name: 'Yellow', hex: '#FDD835' },
];

/** The standard six-lane extension: the four above, plus green and orange. */
export const STANDARD_6_LANE_COLORS: readonly LaneColorPreset[] = [
  ...STANDARD_4_LANE_COLORS,
  { name: 'Green', hex: '#43A047' },
  { name: 'Orange', hex: '#FB8C00' },
];

const PRESETS_BY_LANE_COUNT: Readonly<Record<number, readonly LaneColorPreset[]>> = {
  4: STANDARD_4_LANE_COLORS,
  6: STANDARD_6_LANE_COLORS,
};

/**
 * The standard colour scheme for a track of this many lanes, if any.
 *
 * An exact match is returned whole; failing that, the smallest preset with
 * enough colours is truncated — a 3-lane track gets red/white/blue rather
 * than no preset at all. More than six lanes gets `null`: inventing a
 * seventh "standard" colour is not this module's call, and the operator is
 * always free to pick lanes by hand instead.
 */
export function presetForLaneCount(laneCount: number): readonly LaneColorPreset[] | null {
  const exact = PRESETS_BY_LANE_COUNT[laneCount];
  if (exact) return exact;
  if (laneCount < 1) return null;
  const sizes = Object.keys(PRESETS_BY_LANE_COUNT).map(Number).sort((a, b) => a - b);
  for (const size of sizes) {
    if (size >= laneCount) return PRESETS_BY_LANE_COUNT[size].slice(0, laneCount);
  }
  return null;
}

/** A preset's colours as the plain hex array `Track.laneColors` stores. */
export function presetColors(laneCount: number): string[] {
  const preset = presetForLaneCount(laneCount);
  return preset ? preset.map((c) => c.hex) : [];
}

/**
 * The configured colour for one lane (1-based), or `null`.
 *
 * `null` covers a lane below 1, past the end of `colors`, or holding a
 * blank string — every case that is not a real configured colour. A
 * renderer reading `null` falls back to the plain numbered badge every
 * track has always shown.
 */
export function colorForLane(colors: readonly string[], lane: number): string | null {
  if (lane < 1) return null;
  const value = colors[lane - 1];
  return value || null;
}

/**
 * Set one lane's colour (1-based), extending the array with blanks as
 * needed so an earlier lane's absence does not shift a later one's index.
 */
export function setLaneColor(
  colors: readonly string[],
  lane: number,
  hex: string,
): string[] {
  const next = [...colors];
  while (next.length < lane) next.push('');
  next[lane - 1] = hex;
  return next;
}

/** The preset name for a hex value, if it matches one exactly — for a label
 * beside the swatch, since a colour alone fails anyone who cannot
 * distinguish the hues involved (the same reasoning the backend's
 * `LaneColor` carries a name alongside its hex). `null` for a custom colour,
 * which has no name to offer beyond "Custom". */
export function presetNameForColor(hex: string): string | null {
  const match = STANDARD_6_LANE_COLORS.find(
    (c) => c.hex.toLowerCase() === hex.toLowerCase(),
  );
  return match?.name ?? null;
}
