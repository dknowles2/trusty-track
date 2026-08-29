import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAppSurface,
  applyDisplaySurface,
  applyPrintablesSurface,
  applyTheme,
  resolveDisplayTheme,
  resolvePrintablesTheme,
  resolveSurfaceKey,
} from './applyTheme';
import { themeByKey } from './themes';

describe('applyTheme', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('sets data-theme and every token', () => {
    applyTheme(root, 'old-glory', { '--a': '1px', '--b': 'red' }, ['--a', '--b', '--c']);
    expect(root.dataset.theme).toBe('old-glory');
    expect(root.style.getPropertyValue('--a')).toBe('1px');
    expect(root.style.getPropertyValue('--b')).toBe('red');
  });

  it('clears a known token the new theme does not set, so nothing leaks between themes', () => {
    applyTheme(root, 'newsprint', { '--decor': 'black' }, ['--decor']);
    expect(root.style.getPropertyValue('--decor')).toBe('black');

    applyTheme(root, 'field-uniform', {}, ['--decor']);
    expect(root.style.getPropertyValue('--decor')).toBe('');
  });

  it('leaves a token outside knownNames alone', () => {
    root.style.setProperty('--unrelated', 'blue');
    applyTheme(root, 'field-uniform', {}, ['--decor']);
    expect(root.style.getPropertyValue('--unrelated')).toBe('blue');
  });

  it('applyAppSurface/applyDisplaySurface/applyPrintablesSurface each set data-theme', () => {
    const theme = themeByKey('trail-colors');
    applyAppSurface(root, 'trail-colors', theme.app);
    expect(root.dataset.theme).toBe('trail-colors');
    expect(root.style.getPropertyValue('--scouting-blue')).toBe('#2F6B3A');

    const displayRoot = document.createElement('div');
    applyDisplaySurface(displayRoot, 'trail-colors', theme.display);
    expect(displayRoot.style.getPropertyValue('--display-bg-color')).toBe('#0E1810');

    const printRoot = document.createElement('div');
    applyPrintablesSurface(printRoot, 'trail-colors', theme.printables);
    expect(printRoot.style.getPropertyValue('--print-primary-color')).toBe('#2F6B3A');
  });
});

describe('resolveSurfaceKey — "Match App theme"', () => {
  it('an explicit ThemeKey passes through untouched', () => {
    expect(resolveSurfaceKey('old-glory', 'clear-sight')).toBe('old-glory');
  });

  it('MATCH_APP resolves to the given App theme key', () => {
    expect(resolveSurfaceKey('MATCH_APP', 'clear-sight')).toBe('clear-sight');
  });

  it('MATCH_APP with no App key given falls back to Field Uniform', () => {
    expect(resolveSurfaceKey('MATCH_APP')).toBe('field-uniform');
  });
});

describe('resolveDisplayTheme / resolvePrintablesTheme', () => {
  it('MATCH_APP reproduces exactly today\'s shipped Display behavior by default', () => {
    const { key, theme } = resolveDisplayTheme('MATCH_APP');
    expect(key).toBe('field-uniform');
    expect(theme.tokens['--display-bg-color']).toBe('#0A0A0A');
  });

  it('does not copy the App theme\'s literal colors — it defers to that theme\'s own Display definition', () => {
    // Under the Lights' App surface is a mid-tone dark (#12161d); its
    // Display surface goes all the way to projector black (#0A0A0A) — a
    // different value, deliberately, per the spec.
    const { theme: appTheme } = { theme: themeByKey('under-the-lights').app };
    const { theme: displayTheme } = resolveDisplayTheme('MATCH_APP', 'under-the-lights');
    expect(displayTheme.tokens['--display-bg-color']).not.toBe(
      appTheme.tokens['--background-color'],
    );
    expect(displayTheme.tokens['--display-bg-color']).toBe('#0A0A0A');
  });

  it('an explicit setting ignores the App key entirely', () => {
    const { key, theme } = resolvePrintablesTheme('newsprint', 'old-glory');
    expect(key).toBe('newsprint');
    expect(theme.printBehavior).toBe('lightened');
  });
});
