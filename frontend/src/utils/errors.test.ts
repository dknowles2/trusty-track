import { describe, expect, it } from 'vitest';
import { CombinedError } from 'urql';
import { NETWORK_ERROR_TEXT, errorText } from './errors';

const FALLBACK = 'The thing could not be done.';

describe('errorText', () => {
  it('passes the backend\'s own message through without the "[GraphQL]" prefix', () => {
    const error = new CombinedError({
      graphQLErrors: ['Cannot delete round: it has heats with results.'],
    });
    // The raw message is what alerts used to show — pinned here so a revert
    // to `.message` fails visibly.
    expect(error.message).toContain('[GraphQL]');
    expect(errorText(error, FALLBACK)).toBe(
      'Cannot delete round: it has heats with results.',
    );
  });

  it('turns a connection failure into one plain sentence', () => {
    const error = new CombinedError({
      networkError: new TypeError('Failed to fetch'),
    });
    expect(errorText(error, FALLBACK)).toBe(NETWORK_ERROR_TEXT);
  });

  it('recognises each browser\'s wording for a fetch that never connected', () => {
    for (const wording of [
      'Failed to fetch', // Chrome
      'Load failed', // Safari
      'NetworkError when attempting to fetch resource.', // Firefox
    ]) {
      expect(errorText(new TypeError(wording), FALLBACK)).toBe(
        NETWORK_ERROR_TEXT,
      );
    }
  });

  it('keeps a plain Error message we authored ourselves', () => {
    const error = new Error(
      'Only the operator can download a backup. Enter the operator PIN first.',
    );
    expect(errorText(error, FALLBACK)).toBe(error.message);
  });

  it('falls back to the caller\'s wording when there is nothing better', () => {
    expect(errorText(undefined, FALLBACK)).toBe(FALLBACK);
    expect(errorText(null, FALLBACK)).toBe(FALLBACK);
    expect(errorText(new Error(''), FALLBACK)).toBe(FALLBACK);
    expect(errorText({}, FALLBACK)).toBe(FALLBACK);
    expect(errorText('a string somebody threw', FALLBACK)).toBe(FALLBACK);
  });
});
