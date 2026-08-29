import type { CSSProperties } from 'react';
import { describe, expect, it } from 'vitest';
import { printablesThemeRootProps } from './printablesTheme';

const styleValue = (style: CSSProperties, name: string): unknown =>
  (style as Record<string, unknown>)[name];

describe('printablesThemeRootProps', () => {
  it('undefined (still loading) resolves to Field Uniform, unchanged from today', () => {
    const props = printablesThemeRootProps(undefined);
    expect(props['data-theme']).toBe('field-uniform');
    expect(styleValue(props.style, '--print-primary-color')).toBe('#003F87');
  });

  it('MATCH_APP resolves to Field Uniform (no App theme is knowable outside the settings preview)', () => {
    const props = printablesThemeRootProps('MATCH_APP');
    expect(props['data-theme']).toBe('field-uniform');
  });

  it('an explicit theme resolves to its own printables definition', () => {
    const props = printablesThemeRootProps('newsprint');
    expect(props['data-theme']).toBe('newsprint');
    expect(styleValue(props.style, '--print-decor-strength')).toBe('0.12');
  });

  it('an unrecognised value falls back to Field Uniform rather than throwing', () => {
    const props = printablesThemeRootProps('a-theme-from-the-future');
    expect(props['data-theme']).toBe('field-uniform');
  });
});
