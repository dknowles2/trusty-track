import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIN_HEADER, clearPin, pinHeaders, readPin, withPin, writePin } from './pin';

describe('the PIN this device holds', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('sends no header at all when there is none', () => {
    // A display on the wall. It must reach the server as a viewer, not as a
    // caller sending an empty credential.
    expect(pinHeaders()).toEqual({});
  });

  it('sends the header once a PIN is stored', () => {
    writePin('1234');
    expect(pinHeaders()).toEqual({ [PIN_HEADER]: '1234' });
  });

  it('survives a reload, because the socket needs one', () => {
    writePin('1234');
    expect(readPin()).toBe('1234');
  });

  it('forgets on demand', () => {
    writePin('1234');
    clearPin();
    expect(readPin()).toBeNull();
    expect(pinHeaders()).toEqual({});
  });

  it('leaves the socket URL alone when there is no PIN', () => {
    expect(withPin('ws://pi.local/api/graphql')).toBe('ws://pi.local/api/graphql');
  });

  it('puts the PIN in the socket URL, which cannot carry headers', () => {
    // The asymmetry with `pinHeaders` is deliberate: a browser has no API for
    // setting headers on a WebSocket handshake.
    writePin('1234');
    expect(withPin('ws://pi.local/api/graphql')).toBe('ws://pi.local/api/graphql?pin=1234');
  });

  it('appends rather than replacing an existing query string', () => {
    writePin('1234');
    expect(withPin('ws://pi.local/api/graphql?x=1')).toBe(
      'ws://pi.local/api/graphql?x=1&pin=1234',
    );
  });

  it('escapes the PIN', () => {
    writePin('12&34');
    expect(withPin('ws://pi.local/g')).toBe('ws://pi.local/g?pin=12%2634');
  });

  it('degrades to a viewer where storage refuses', () => {
    // Some browser configurations throw on access. A screen that cannot read a
    // PIN must render as a viewer, never fail to render.
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(readPin()).toBeNull();
      expect(pinHeaders()).toEqual({});
      expect(withPin('ws://pi.local/g')).toBe('ws://pi.local/g');
    } finally {
      getItem.mockRestore();
    }
  });

  it('does not throw when storage refuses a write', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(() => writePin('1234')).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});
