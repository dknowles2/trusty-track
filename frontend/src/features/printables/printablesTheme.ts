/**
 * The Printables theme root's own `data-theme` attribute and inline style
 * (#498) — one small pure helper rather than four copies of the same
 * `resolvePrintablesTheme` + cast, one per page that shares `PrintSheet.css`
 * (`Printables.tsx`, `Certificate.tsx`, `HeatSheet.tsx`, `ResultsSheet.tsx`).
 *
 * Each of those pages queries `race { resolvedPrintablesTheme }` itself —
 * there is no shared React wrapper component to put this in instead, and
 * four independent `<div className="printables-page">` roots is the shape
 * `CLAUDE.md` already documents for this feature. `resolvedPrintablesTheme`
 * (#1081) is a race's own override layered over the install-wide setting
 * (`domain.theme.resolve_theme_setting`, server-side) — this file used to
 * read `initialConfig.printablesTheme` instead, the install-only value,
 * before a race could have an opinion of its own.
 */

import type { CSSProperties } from 'react';
import { resolvePrintablesTheme } from '../../theming/applyTheme';
import type { SurfaceThemeSetting } from '../../theming/themes';

export interface PrintablesThemeRootProps {
  'data-theme': string;
  style: CSSProperties;
}

/** `printablesTheme` is `race.resolvedPrintablesTheme` off whichever query
 *  the page already runs — `undefined` while it is still loading resolves
 *  to `'MATCH_APP'`, which is Field Uniform's own definition, the same
 *  no-visible-change default every other unresolved query already falls
 *  back to on this page. */
export function printablesThemeRootProps(
  printablesTheme: string | undefined,
): PrintablesThemeRootProps {
  const setting = (printablesTheme as SurfaceThemeSetting | undefined) ?? 'MATCH_APP';
  const { key, theme } = resolvePrintablesTheme(setting);
  return {
    'data-theme': key,
    style: theme.tokens as CSSProperties,
  };
}
