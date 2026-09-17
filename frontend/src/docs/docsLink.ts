import docsLinks from './docsLinks.json';

/**
 * One way to link into the docs, from an app-side key rather than a
 * hand-written URL sprinkled per component (#1194).
 *
 * `docsLinks.json` is the map — pure data, so a page rename or a heading
 * rename changes one line rather than every place the app happened to link
 * to it. Each entry names a docs page's path (no leading/trailing slash, no
 * `/docs/` prefix — see `docsLink.test.ts`'s own guard on the shape) and,
 * where a link points at one section of a longer page rather than the top,
 * the heading's own id. `backend/tests/test_landing_page_links.py`'s
 * `test_every_ui_docs_link_lands_on_a_page_and_heading` is what proves every
 * entry here actually resolves — a renamed page or heading fails the build
 * there, not silently here.
 *
 * The docs are not bundled with the app (Option 1 of #1194 — see the issue
 * for why: the docs live on Cloudflare Pages, and bundling them would add
 * roughly the whole screenshot set to every release artefact and Pi image
 * for a venue-offline case that is not what this issue asks for). A link
 * therefore always opens `trusty-track.com`, and on a venue with no
 * internet the browser says so — the affordance still tells the operator
 * where to look once they are back online.
 */
export const DOCS_BASE = 'https://trusty-track.com/docs/';

export type DocsKey = keyof typeof docsLinks;

function entryFor(key: DocsKey): { path: string; anchor?: string; title: string } {
  return (docsLinks as Record<string, { path: string; anchor?: string; title: string }>)[key];
}

/** The full URL a `DocsKey` opens — always the same base, a trailing slash
 * before any `#anchor`, exactly as mkdocs itself serves the page. */
export function docsHref(key: DocsKey): string {
  const entry = entryFor(key);
  const base = `${DOCS_BASE}${entry.path}/`;
  return entry.anchor ? `${base}#${entry.anchor}` : base;
}

/** The docs page's own title — the accessible name for a link that renders
 * only an icon, so a screen reader says what it opens rather than "help". */
export function docsTitle(key: DocsKey): string {
  return entryFor(key).title;
}
