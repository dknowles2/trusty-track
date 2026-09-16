import { useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { useNarrowViewport } from '../../features/core/hooks/useNarrowViewport';

/**
 * A control's helper sentence, collapsed to a disclosure on a phone
 * (#1154). `RaceForm.tsx` and `SystemSettings.tsx` carry a paragraph of
 * muted prose under nearly every control — right for a desktop, where it
 * sits beside a wide input, and a column of 11px text an operator scrolls
 * through on a phone to reach the field they actually came for.
 *
 * **Desktop (`>= 600px`, the same breakpoint `useNarrowViewport` already
 * uses elsewhere): unchanged.** With no `summary`, this renders exactly the
 * `<p>`/`<small>` it replaces — same tag (`as`), same inline `style` — so
 * the desktop docs screenshots do not drift by a pixel.
 *
 * **Narrow, with no `summary`: closed by default, an ⓘ toggle in its
 * place.** The sentence itself is not lost — it is still in the document,
 * under the same `id` a caller can point an `aria-describedby` at whether
 * or not it is expanded — only hidden until the operator asks for it.
 *
 * **`summary`: a short line that stays visible at every width, not only
 * narrow.** The one exception is the Lock race box, whose full explanation
 * is worth condensing everywhere, not just on a phone — see
 * `.claude/rules/auth-and-demo.md`'s "Locking a race" for what the one-line
 * version has to keep true.
 *
 * **`forceOpen`: the first-run wizard.** It shows every field at once and
 * is exactly the reader this prose was written for — never collapse there,
 * regardless of viewport width.
 */
export interface FieldHelpProps {
  /** The full helper text — what the old inline `<p>`/`<small>` held. */
  children: ReactNode;
  /**
   * Stable id for the text, kept whether it is inline (desktop, no
   * `summary`) or collapsed — so a control's own `aria-describedby` always
   * resolves to something, expanded or not.
   */
  id: string;
  /** The element the old helper text used — `<p>` or `<small>`. */
  as?: ElementType;
  /** The old helper text's own inline style, reproduced verbatim. */
  style?: CSSProperties;
  className?: string;
  /** A short line that stays visible even while the rest is collapsed, at
   * every width. Omit for the ordinary case. */
  summary?: ReactNode;
  /** The wizard: always expanded, no toggle, regardless of width. */
  forceOpen?: boolean;
  /** The toggle button's accessible name. */
  toggleLabel?: string;
}

export default function FieldHelp({
  children,
  id,
  as: Tag = 'p',
  style,
  className,
  summary,
  forceOpen = false,
  toggleLabel = 'More about this',
}: FieldHelpProps) {
  const narrow = useNarrowViewport();
  const [open, setOpen] = useState(false);

  // Collapsible either because a `summary` asks for it at every width, or
  // because the viewport is narrow and there is no `summary` to keep
  // visible on its own. `forceOpen` (the wizard) always wins.
  const collapsible = !forceOpen && (summary !== undefined || narrow);

  // With no `summary`, an uncollapsed render must be the *exact* old
  // markup — no wrapping span around `children` — so the desktop docs
  // screenshots do not drift. A `summary` is only ever used alongside a
  // collapsible render in practice (the Lock race box, always collapsible),
  // so it gets its own element to stay addressable either way.
  if (!collapsible) {
    return (
      <Tag id={id} style={style} className={className}>
        {summary != null ? (
          <>
            <span className="field-help-summary">{summary}</span>{' '}
          </>
        ) : null}
        {children}
      </Tag>
    );
  }

  return (
    <Tag style={style} className={className}>
      {summary != null ? (
        <>
          <span className="field-help-summary">{summary}</span>{' '}
        </>
      ) : null}
      <button
        type="button"
        className="field-help-toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={toggleLabel}
        data-testid={`field-help-toggle-${id}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">&#9432;</span>
      </button>
      <span id={id} className="field-help-detail" hidden={!open}>
        {children}
      </span>
    </Tag>
  );
}
