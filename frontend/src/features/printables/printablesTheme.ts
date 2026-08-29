/**
 * The Printables theme root's own `data-theme` attribute and inline style
 * (#498) — one small pure helper rather than four copies of the same
 * `resolvePrintablesTheme` + cast, one per page that shares `PrintSheet.css`
 * (`Printables.tsx`, `Certificate.tsx`, `HeatSheet.tsx`, `ResultsSheet.tsx`).
 *
 * Each of those pages queries `initialConfig { printablesTheme }` itself —
 * there is no shared React wrapper component to put this in instead, and
 * four independent `<div className="printables-page">` roots is the shape
 * `CLAUDE.md` already documents for this feature.
 */

import type { CSSProperties } from 'react';
import { resolvePrintablesTheme } from '../../theming/applyTheme';
import type { SurfaceThemeSetting } from '../../theming/themes';

export interface PrintablesThemeRootProps {
  'data-theme': string;
  style: CSSProperties;
}

/** `printablesTheme` is `initialConfig.printablesTheme` off whichever query
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
