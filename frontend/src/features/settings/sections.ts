/**
 * What the System Settings page is divided into, and what stops a save.
 *
 * The page had grown to one 600px column holding an organization name, two
 * PINs, every track's name, geometry, lanes-in-service, timer, remote start
 * and historical records, a backup panel and two links out. The documentation
 * had already started writing it as though it were sectioned — "Settings →
 * Access", "Settings → Tracks → Lanes in service", "Settings → Backup" — which
 * is the giveaway that the page owed the reader those sections.
 *
 * Pure, and tested on its own: this is the *rule* about the page, and the
 * doing is in `SystemSettings.tsx`. Same split as `raceFlow.ts`.
 */

import { DEFAULT_TERMINOLOGY } from './terminologyDefaults';

export type SectionId = 'general' | 'appearance' | 'access' | 'tracks' | 'advanced' | 'backup';

export interface Section {
  id: SectionId;
  /** What the nav calls it, and what the docs already call it. */
  label: string;
  /** One line under the heading, for a reader who is not sure they are here. */
  blurb: string;
}

/**
 * The sections in the order they are offered.
 *
 * Backup is last and is only offered once there is something to back up —
 * see `sectionsFor`.
 */
export const SECTIONS: readonly Section[] = [
  {
    id: 'general',
    label: 'General',
    blurb: 'Who you are, and what the race screens show.',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    blurb: 'How the screens, the wall display, and the printed pages look.',
  },
  {
    id: 'access',
    label: 'Access',
    blurb: 'Who on this network is allowed to change things.',
  },
  {
    id: 'tracks',
    label: 'Tracks',
    blurb: 'Each track, its lanes, and the timer at the end of it.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    blurb: "Not for a first look — troubleshooting controls, off by default.",
  },
  {
    id: 'backup',
    label: 'Backup',
    blurb: 'The whole event in one file, and putting it back.',
  },
];

/**
 * The sections that are part of the settings form, and so of one Save.
 *
 * Advanced is last among them, on purpose: unlike Backup, nothing it holds
 * is destructive (see `isFormSection`'s own note below), so there is no
 * reason to pull it out of the form the way Backup is pulled out — it is
 * ordinary form state, saved by the same "Save Settings" button as the
 * organization name. It sorts after Tracks and before Backup, which is
 * what "last" means for a field this ordinary: nothing not already offered
 * a section of its own is more advanced than this.
 */
export const FORM_SECTIONS: readonly SectionId[] = [
  'general',
  'appearance',
  'access',
  'tracks',
  'advanced',
];

export const isFormSection = (id: SectionId): boolean => FORM_SECTIONS.includes(id);

/**
 * The order the first-run wizard renders its sections in (#851).
 *
 * `FORM_SECTIONS` above is the sectioned settings page's own order, and that
 * page has a nav down the left — an operator jumps straight to whichever
 * section they want, so the order it is offered in barely matters. The
 * wizard has no nav (`sectionsFor(false)` is empty, on purpose — see below)
 * and renders every section in a row, so *its* order is the one thing a
 * first-timer actually has to scroll past.
 *
 * Two fields change anything before a heat runs: the organization's name
 * (General) and a track's lane count (Tracks). Both now come first. Access
 * (the operator/check-in PINs) is optional but still an operational
 * decision, so it stays ahead of Appearance, which is purely cosmetic — a
 * theme nobody picks is already a working default (`MATCH_APP` resolves to
 * Field Uniform) — and Advanced (Debugging Mode) stays last, as it is on the
 * sectioned page.
 *
 * Same five members as `FORM_SECTIONS`, reordered — nothing is added,
 * removed, or hidden. `SystemSettings.tsx` additionally collapses Appearance
 * behind a closed disclosure on the wizard only, so its twenty-three theme
 * swatches and live preview are still in the document (a first-timer can
 * still meet the setting) without competing with the track question for
 * attention.
 */
export const WIZARD_FORM_ORDER: readonly SectionId[] = ['general', 'tracks', 'access', 'appearance', 'advanced'];

/**
 * Which sections a nav should offer.
 *
 * On the first run this page is a setup wizard, and a wizard is not sectioned:
 * somebody who has never seen the app should meet every field once, in order,
 * rather than be asked to go looking for the two they have not filled in. So
 * an unconfigured install gets no nav at all — the caller renders the lot —
 * and that is also why Backup is absent there rather than merely empty:
 * offering to replace an install that does not exist yet is offering nothing.
 */
export function sectionsFor(isEditing: boolean): readonly Section[] {
  return isEditing ? SECTIONS : [];
}

/** A track, as far as validation cares. */
export interface TrackForValidation {
  name: string;
  laneCount: number;
  // The vehicle-to-real-life ratio scale speed is computed against (#610).
  // The input carries `min`/`step`, which catches a bad value while the
  // track's own card is on screen — this is the same "the browser cannot
  // point at a field it is not rendering" case `laneCount` already covers.
  scaleRatio: number;
  // Whether the ratio input is even on screen right now (#773). Unlike
  // `laneCount`, this field's own input is conditionally rendered — ticking
  // "Show scale speed" off hides it, and a value left over from before it
  // was hidden must not block Save with a message pointing at a field the
  // operator cannot see or fix from the section this switches to.
  showScaleSpeed: boolean;
}

export interface Problem {
  /** Where the operator has to go to fix it. */
  section: SectionId;
  message: string;
}

/**
 * The first thing wrong with the form, or null.
 *
 * The inputs still carry `required` and `min`, which is what catches a bad
 * value in the section on screen — the browser points straight at the field.
 * This exists for the value the browser *cannot* point at: with one section
 * rendered at a time, an empty organization name is not in the document while
 * somebody is editing a track, so nothing native would fire and the save would
 * go up missing a name. It names the offending track by number, which the form
 * never did even when everything was on screen at once (a saved track with no
 * length used to block the whole page with nothing on it saying which).
 */
export function firstProblem(
  organizationName: string,
  tracks: readonly TrackForValidation[],
  /**
   * The organization word for the example message — "Pack" by default. This
   * is deliberately the *form's own* current value, not a resolved
   * `useTerminology()` word: the organization name and the terminology
   * fields live in the same section, so an operator who just renamed "Pack"
   * to "Squad" and left the name blank should see the vocabulary they just
   * chose, not the one they replaced (#532).
   */
  orgWord: string = DEFAULT_TERMINOLOGY.organizationSingular,
): Problem | null {
  if (!organizationName.trim()) {
    return {
      section: 'general',
      message: `Your organization needs a name — for example ${orgWord} 123.`,
    };
  }
  if (tracks.length === 0) {
    return { section: 'tracks', message: 'At least one track is required.' };
  }
  for (const [index, track] of tracks.entries()) {
    if (!track.name.trim()) {
      return {
        section: 'tracks',
        message: `Track ${index + 1} needs a name.`,
      };
    }
    if (!Number.isInteger(track.laneCount) || track.laneCount < 1 || track.laneCount > 8) {
      return {
        section: 'tracks',
        message: `${track.name} needs between 1 and 8 lanes.`,
      };
    }
    if (track.showScaleSpeed && !(track.scaleRatio > 0)) {
      return {
        section: 'tracks',
        message: `${track.name} needs a scale ratio greater than zero.`,
      };
    }
  }
  return null;
}
