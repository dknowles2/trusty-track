/**
 * The list of a sectioned form's sections, down the left.
 *
 * Down the left rather than across the top because there is already a
 * navigation row across the top, and this project has retired a second one
 * once already — Standings and Stats appeared twice, two rows apart, and the
 * same page had two names. A column beside the content cannot be mistaken for
 * the app's own navigation.
 *
 * Written for System Settings and generic over the section id since #587,
 * when the race form was sectioned the same way: one nav component, one
 * stylesheet, so the two forms cannot drift apart in how a section is
 * chosen. Anything that goes *somewhere else* — the settings page's two
 * links out — is passed as children and rendered at the foot, separated
 * from the sections, so a link cannot be mistaken for one.
 */

import type { ReactNode } from 'react';

interface NavSection<Id extends string> {
  id: Id;
  label: string;
}

interface Props<Id extends string> {
  sections: readonly NavSection<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
  /** What a screen reader calls the list. */
  label?: string;
  /** Prefix for the nav's and each button's test id: `<prefix>` and `<prefix>-<id>`. */
  testIdPrefix?: string;
  /** Links out, at the foot. */
  children?: ReactNode;
}

export default function SettingsNav<Id extends string>({
  sections,
  current,
  onSelect,
  label = 'Settings sections',
  testIdPrefix = 'settings-nav',
  children,
}: Props<Id>) {
  return (
    <nav className="settings-nav" aria-label={label} data-testid={testIdPrefix}>
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          data-testid={`${testIdPrefix}-${section.id}`}
          aria-current={section.id === current ? 'page' : undefined}
          onClick={() => onSelect(section.id)}
        >
          {section.label}
        </button>
      ))}
      {children && <div className="settings-nav-links">{children}</div>}
    </nav>
  );
}
