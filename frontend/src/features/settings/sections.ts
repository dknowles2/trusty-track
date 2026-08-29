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

export type SectionId = 'general' | 'appearance' | 'access' | 'tracks' | 'backup';

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
    id: 'backup',
    label: 'Backup',
    blurb: 'The whole event in one file, and putting it back.',
  },
];

/** The sections that are part of the settings form, and so of one Save. */
export const FORM_SECTIONS: readonly SectionId[] = ['general', 'appearance', 'access', 'tracks'];

export const isFormSection = (id: SectionId): boolean => FORM_SECTIONS.includes(id);

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
  groupName: string,
  tracks: readonly TrackForValidation[],
): Problem | null {
  if (!groupName.trim()) {
    return {
      section: 'general',
      message: 'Your organization needs a name — for example Pack 123.',
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
  }
  return null;
}
