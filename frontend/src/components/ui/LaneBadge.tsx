import React from 'react';
import { presetNameForColor } from '../../features/settings/laneColors';

/**
 * A lane number, paired with its configured colour dot when the track has
 * one (#611, stage 4).
 *
 * Real derby tracks are usually painted or taped a different colour per
 * lane, and the wranglers, staging crew and announcer call cars by it —
 * "put car #12 in the blue lane". `Track.laneColors` (`domain/lane_colors.py`
 * on the backend, `features/settings/laneColors.ts` here) is how an operator
 * tells the app what those colours are; this is the one place that turns a
 * configured colour into something on screen, so every surface that shows a
 * lane number says the colour the same way rather than growing its own copy.
 *
 * **Rendered as a dot, never a background fill** — the rule #611 states at
 * every stage of the issue and repeats in the stage-4 handover. A filled
 * cell fights whichever of the seven themes is active and can wreck a
 * theme's own contrast guarantee: Clear Sight exists specifically for
 * legibility, and Under the Lights is a dark surface where a saturated fill
 * behind light text is exactly the trap "Themes" in `CLAUDE.md` warns about.
 * A dot sits *beside* the text instead, so no theme token's own contrast
 * promise is ever at stake.
 *
 * **The colour is never the only distinguishing mark.** The lane *number* is
 * always rendered too, in `children` — a mono printer (see "Printables" in
 * `CLAUDE.md`) renders every hue as a similar grey, and part of the audience
 * in a gym cannot tell the hues apart at all. The dot itself pairs with a
 * name where one is known (`presetNameForColor`, mirroring `LaneColor`
 * carrying a `name` alongside its `hex` on the backend — see
 * `domain/lane_colors.py`), surfaced as a `title` for anyone hovering or
 * using assistive technology, not as the only way to read the colour.
 *
 * Renders nothing but its children when `color` is absent — a lane with no
 * configured colour, or a track that has never opened the picker, looks
 * exactly as it always has. That covers a non-dense lane set too: a lane
 * past the end of `Track.laneColors`, or one dropped by an outage, simply
 * never receives a `color` from a caller reading through `colorForLane`.
 */
export interface LaneBadgeProps {
  /** This lane's configured colour (a hex string), or `null`/`undefined`
   * when none is set. Look this up with `colorForLane` from
   * `features/settings/laneColors` — this component does not do the lookup
   * itself, since a caller may already have the whole `laneColors` array in
   * scope for several lanes at once. */
  color?: string | null;
  /** The lane number/label text — "Lane 3", "L3", or just the plain
   * heading a surface already renders. Kept as `children` rather than a
   * `lane: number` prop so every call site keeps its own existing wording
   * (some say "Lane", some abbreviate, some are inside a larger string)
   * without this component inventing a fourth phrasing. */
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export default function LaneBadge({ color, children, className, style }: LaneBadgeProps) {
  const name = color ? presetNameForColor(color) : null;
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em', ...style }}
    >
      {color && (
        <span
          className="lane-badge-dot"
          title={name ? `${name} lane` : undefined}
          aria-hidden={name ? undefined : true}
          style={{
            display: 'inline-block',
            width: '0.7em',
            height: '0.7em',
            minWidth: '9px',
            minHeight: '9px',
            borderRadius: '50%',
            background: color,
            // A two-tone ring rather than one solid border: a single dark
            // border vanishes against a dark theme's own dark surfaces and
            // a single light one vanishes against a light one (the same
            // "gap ring" trick the pit pass's gold roundel and portrait
            // ring use against a gold avatar background — see
            // "Printables" in CLAUDE.md). Neutral greys rather than a
            // theme token: this dot has to read the same on paper, on a
            // projector and on the operator's own screen, and none of
            // those share one contrast-safe token for "outline against
            // anything".
            boxShadow: '0 0 0 1px rgba(255,255,255,0.65), 0 0 0 2px rgba(0,0,0,0.35)',
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}
