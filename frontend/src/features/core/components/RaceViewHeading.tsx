import type { ReactNode } from 'react';
import DocsLink from '../../../components/ui/DocsLink';
import type { DocsKey } from '../../../docs/docsLink';
import LockedBadge from './LockedBadge';
import { useNarrowViewport } from '../hooks/useNarrowViewport';

interface RaceViewHeadingProps {
  /** The view's own name — "Race Control", "Standings" — except Roster,
   * which shows the race's own name instead (#949's reasoning: the page
   * reads as the race's hub). A content choice the caller makes, not a
   * second heading style. */
  title: ReactNode;
  /** Which docs page this view explains (#1194). Every race view has one;
   * omit only for a page with nothing to link (there is none among the
   * six today). */
  docsKey?: DocsKey;
  /** Whether to show the Locked badge (#585) — every race view shows it
   * the same way now, where before only Roster and Control did. */
  locked?: boolean;
  /** The view's own controls — Roster's Edit race pill, Control's tab
   * strip and Edit race pill, and so on. Rendered outside the `<h1>` but
   * inside the heading row, and the one thing that stays visible on a
   * phone once the title/badge/docs link are hidden. */
  actions?: ReactNode;
  testId?: string;
  /**
   * Whether this page's own overflow menu already carries a "Learn more"
   * (or similarly worded) entry for `docsKey` under 768px — Roster's
   * `roster-more-menu`, Control's `race-control-overflow` and Awards'
   * `awards-more-menu` all do. When true, the component does not also
   * render a bare `?` icon at the row's right on a phone, since the page's
   * own overflow already offers a way to it. Standings, Stats and Displays
   * have no overflow of their own, so this defaults to false there and the
   * icon stays visible in the row (#1297).
   */
  docsInOverflow?: boolean;
}

/**
 * The one heading every race view (Roster, Control, Standings, Awards,
 * Stats, Displays) renders (#1296, #1297). Before this, the six had four
 * different treatments — a different element, a different font size, a
 * missing heading on Stats, an `h2` on Standings that was really a section
 * heading — and the help `?` icon sat in three different places (after the
 * title, after the action buttons, or alone with no heading nearby).
 *
 * The order inside the `<h1>` — title, then the Locked badge, then the
 * docs link — is #1297's own rule, and it is what keeps the six from
 * drifting apart again: there is exactly one place a page can put any of
 * the three, this component's own render.
 *
 * ≤768px, the `<h1>` (title, badge, docs link) is hidden entirely —
 * `useNarrowViewport(768)`, not a `@media` rule, because which *elements*
 * exist changes at this breakpoint, not just how they are styled
 * (`.claude/rules/frontend-screens.md`'s #1148 paragraph). The mobile nav's
 * own race pill already names the race and the bottom tab bar already
 * names the view, so repeating either here is chrome a phone has no room
 * for. `actions` stays visible regardless of width — it is the view's own
 * controls, not orientation chrome.
 */
export default function RaceViewHeading({
  title,
  docsKey,
  locked = false,
  actions,
  testId,
  docsInOverflow = false,
}: RaceViewHeadingProps) {
  const narrow = useNarrowViewport(768);
  const showBareDocsLink = narrow && !!docsKey && !docsInOverflow;

  // On a phone, a page whose "Edit race" (or equivalent) moves entirely
  // into its own toolbar overflow — Roster is the one today — passes no
  // `actions` and has its docs link covered by `docsInOverflow`, so there
  // is nothing left for this row to hold. Rendering the wrapper anyway
  // would still cost its own `margin-bottom` (`.race-view-heading-row` in
  // `index.css`) as pure dead space above whatever the page renders next —
  // reproduced by `mobileChrome.spec.ts`'s own roster-density assertion,
  // which measured the row's height even though nothing in it painted.
  if (narrow && !actions && !showBareDocsLink) return null;

  return (
    <div
      className="race-view-heading-row"
      data-testid={testId}
      style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}
    >
      {!narrow && (
        <h1 className="race-view-heading">
          {title}
          {locked && <LockedBadge />}
          {docsKey && <DocsLink docsKey={docsKey} />}
        </h1>
      )}
      {(actions || showBareDocsLink) && (
        <div
          // `flex: 1` rather than `marginLeft: 'auto'`: most pages pass a
          // button or two here, which this still pushes flush right via
          // `justifyContent: 'flex-end'` — but Control's own tab strip is
          // itself `flex: 1` inside this slot, and a flex child's own
          // flex-grow only has free space to consume when its *parent* is
          // the one growing to fill the row (see `RaceControl.tsx`'s own
          // comment on `actions`). A bare pushed-right button and a
          // strip that fills the middle of the row are the same layout
          // once the wrapper itself is allowed to grow.
          style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0, justifyContent: 'flex-end' }}
        >
          {actions}
          {showBareDocsLink && <DocsLink docsKey={docsKey!} />}
        </div>
      )}
    </div>
  );
}
