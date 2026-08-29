/**
 * WCAG 2 contrast ratio between two `#rrggbb` colors.
 *
 * Exists so `themes.test.ts` can *check* the "Hard constraints" checklist
 * item — body text >= 4.5:1, large display text >= 3:1 — against the
 * literal token values above, rather than trusting the spec's own
 * hand-measured (and explicitly approximate, "~") numbers to still be true
 * after somebody edits a hex value later. Not used at runtime: no theme
 * picks a color *from* a contrast computation, it only ever verifies one
 * that was already chosen.
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** >= 1, and 21 is the theoretical maximum (pure black on pure white). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}
