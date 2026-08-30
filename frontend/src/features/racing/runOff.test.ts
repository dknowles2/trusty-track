import { describe, expect, it } from 'vitest';
import { runOffAnnouncement } from './runOff';

describe('runOffAnnouncement', () => {
  it('names the ordinal place being decided', () => {
    expect(runOffAnnouncement(2)).toBe('Racing off for 2nd place');
    expect(runOffAnnouncement(1)).toBe('Racing off for 1st place');
    expect(runOffAnnouncement(11)).toBe('Racing off for 11th place');
  });

  it('says nothing for null or undefined — not a run-off, or nothing left to settle', () => {
    expect(runOffAnnouncement(null)).toBeNull();
    expect(runOffAnnouncement(undefined)).toBeNull();
  });
});
