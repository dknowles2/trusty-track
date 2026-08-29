import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyStoredAppTheme, readAppTheme, writeAppTheme } from './appTheme';

describe('appTheme — this device\'s App theme (localStorage)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('defaults to Field Uniform when nothing has ever been chosen', () => {
    expect(readAppTheme()).toBe('field-uniform');
  });

  it('round-trips a chosen theme', () => {
    writeAppTheme('old-glory');
    expect(readAppTheme()).toBe('old-glory');
  });

  it('falls back to the default for a key from a build that no longer ships it', () => {
    window.localStorage.setItem('trustytrack.appTheme', 'a-theme-from-the-future');
    expect(readAppTheme()).toBe('field-uniform');
  });

  it('is a device-local key, matching the PIN/chime convention', () => {
    writeAppTheme('clear-sight');
    expect(window.localStorage.getItem('trustytrack.appTheme')).toBe('clear-sight');
  });

  describe('applyStoredAppTheme — "before first paint"', () => {
    it('applies the stored theme to the given root synchronously', () => {
      writeAppTheme('trail-colors');
      const root = document.createElement('div');
      applyStoredAppTheme(root);
      expect(root.dataset.theme).toBe('trail-colors');
      expect(root.style.getPropertyValue('--scouting-blue')).toBe('#2F6B3A');
    });

    it('applies Field Uniform when nothing is stored, matching today\'s shipped colors', () => {
      const root = document.createElement('div');
      applyStoredAppTheme(root);
      expect(root.dataset.theme).toBe('field-uniform');
      expect(root.style.getPropertyValue('--scouting-blue')).toBe('#003F87');
    });

    it('defaults to document.body', () => {
      writeAppTheme('newsprint');
      applyStoredAppTheme();
      expect(document.body.dataset.theme).toBe('newsprint');
      // Clean up: the shared jsdom document persists between tests in this
      // file's own module, but not across files — still, leave it as we
      // found it.
      document.body.removeAttribute('data-theme');
      document.body.style.cssText = '';
    });
  });
});
