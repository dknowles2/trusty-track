import { Icon } from '@mdi/react';
import { mdiHelpCircleOutline } from '@mdi/js';
import { docsHref, docsTitle, type DocsKey } from '../../docs/docsLink';

interface DocsLinkProps {
  /** Which docs page/section this opens — see `docs/docsLinks.json`. */
  docsKey: DocsKey;
  /**
   * Visible text instead of the `?` icon — "Learn more →", the `FieldHelp`
   * form (#1194). Omit for the icon-only form used in a page header.
   */
  label?: string;
  className?: string;
}

/**
 * One `?`/"Learn more" affordance, opening the docs page that explains the
 * screen it sits on — the one door #1194 asks for, rather than an ad-hoc
 * anchor per component. Always a new tab: this is a way *out* of the app,
 * to a page the app does not control and cannot promise is reachable on a
 * venue with no internet (see `docsLink.ts`'s own doc comment).
 */
export default function DocsLink({ docsKey, label, className }: DocsLinkProps) {
  const title = docsTitle(docsKey);
  // `.docs-link--icon` carries the muted colour and no-underline treatment —
  // scoped to the icon-only form (a page header's `?`). The labelled form
  // ("Learn more →" in `FieldHelp`, and the Hardware Timer guide links this
  // replaced) is meant to read as an ordinary link, so it gets no colour
  // override here and falls through to the page's own anchor styling, the
  // same as the plain `<a>` it replaced.
  const classes = ['docs-link', label == null ? 'docs-link--icon' : null, className]
    .filter(Boolean)
    .join(' ');
  return (
    <a
      href={docsHref(docsKey)}
      target="_blank"
      rel="noopener noreferrer"
      className={classes}
      aria-label={`Help: ${title}`}
      title={title}
      data-testid="docs-link"
      data-docs-key={docsKey}
    >
      {label ?? <Icon path={mdiHelpCircleOutline} size={0.8} />}
    </a>
  );
}
