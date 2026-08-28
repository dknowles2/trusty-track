/**
 * Ready-made superlative awards (#306).
 *
 * A pack that has never run one of these does not know what the usual list
 * is, and a volunteer setting up the night before should be able to tick a
 * box rather than invent a name. Presented as a picker alongside the free-text
 * field in `AwardForm`, not instead of it — choosing one just fills the name
 * and artwork key of an ordinary `SPECIAL` award, which stays editable
 * afterwards exactly like a hand-typed one.
 *
 * This is the *offer*, not the whole vocabulary: `artworkKey` values a
 * `SPEED` award can carry (`trophy`, `medal`, `tortoise`) live in
 * `backend/domain/awards.py`'s `default_artwork_key`, computed from the rule
 * rather than picked here. `artwork.tsx` is the one map from every key —
 * these and those — to a picture.
 *
 * Pure: no React, so the list and its pairing with a key are testable without
 * rendering a form.
 */

export interface AwardTemplate {
  /** Stable across reorderings of the list — used as the picker's key. */
  id: string;
  /** What the picker offers, and what gets written into the name field. */
  name: string;
  /** A one-line reminder of what the award is for, next to its name. */
  blurb: string;
  artworkKey: string;
}

/**
 * The usual superlatives. Named ones from the issue that started this,
 * roughly in the order a pack tends to announce them — the paint and design
 * awards first, spirit and judges' choice last.
 */
export const AWARD_TEMPLATES: readonly AwardTemplate[] = [
  {
    id: 'best-paint',
    name: 'Best Paint',
    blurb: 'The finish itself — colour, gloss, how clean the lines are.',
    artworkKey: 'paintbrush',
  },
  {
    id: 'best-use-of-colour',
    name: 'Best Use of Colour',
    blurb: 'A bold or unusual colour scheme, done well.',
    artworkKey: 'palette',
  },
  {
    id: 'most-original',
    name: 'Most Original',
    blurb: "A design nobody else's car has.",
    artworkKey: 'sparkle-star',
  },
  {
    id: 'most-aerodynamic',
    name: 'Most Aerodynamic',
    blurb: 'Looks built to cut the air, whether or not it actually is.',
    artworkKey: 'wing',
  },
  {
    id: 'most-patriotic',
    name: 'Most Patriotic',
    blurb: 'Stars, stripes, or the colours of the flag.',
    artworkKey: 'flag-star',
  },
  {
    id: 'best-scout-spirit',
    name: 'Best Scout Spirit',
    blurb: 'For a scout, not just a car — attitude, sportsmanship, effort.',
    artworkKey: 'compass-star',
  },
  {
    id: 'judges-choice',
    name: "Judges' Choice",
    blurb: 'A catch-all for whatever caught the judges’ eye.',
    artworkKey: 'gavel',
  },
];

/** Find a template by id, for seeding the form from a picker selection. */
export function templateById(id: string): AwardTemplate | undefined {
  return AWARD_TEMPLATES.find((template) => template.id === id);
}
