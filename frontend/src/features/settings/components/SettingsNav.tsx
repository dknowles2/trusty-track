/**
 * The list of settings sections, down the left.
 *
 * Down the left rather than across the top because there is already a
 * navigation row across the top, and this project has retired a second one
 * once already — Standings and Stats appeared twice, two rows apart, and the
 * same page had two names. A column beside the content cannot be mistaken for
 * the app's own navigation.
 *
 * The two links at the foot go somewhere else, and are separated from the
 * sections for that reason. They are here rather than buried at the bottom of
 * a section because the documentation sends people to them by this route —
 * "Settings → Check the timer connection", "Settings → See what has happened".
 */

import { Link } from 'react-router-dom';
import type { Section, SectionId } from '../sections';

interface Props {
  sections: readonly Section[];
  current: SectionId;
  onSelect: (id: SectionId) => void;
}

export default function SettingsNav({ sections, current, onSelect }: Props) {
  return (
    <nav className="settings-nav" aria-label="Settings sections" data-testid="settings-nav">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          data-testid={`settings-nav-${section.id}`}
          aria-current={section.id === current ? 'page' : undefined}
          onClick={() => onSelect(section.id)}
        >
          {section.label}
        </button>
      ))}
      <div className="settings-nav-links">
        <Link to="/timer-check">Check the timer connection &rarr;</Link>
        {/* The activity log (#219) spans every race and answers a question
            nobody asks until something has already gone wrong, which is why it
            sits with the diagnostics rather than in the race navigation. */}
        <Link to="/activity">See what has happened &rarr;</Link>
      </div>
    </nav>
  );
}
