import { describe, expect, it } from 'vitest';
import {
  BEST_TIME,
  COUNTBACK,
  HEAD_TO_HEAD,
  SHARED,
  TIEBREAKER_OPTIONS,
  TOTAL_TIME,
  methodPhrase,
  resolutionNote,
  tiebreakerWontFire,
} from './tiebreakText';

describe('TIEBREAKER_OPTIONS', () => {
  it('offers all five methods, SHARED first', () => {
    expect(TIEBREAKER_OPTIONS.map((o) => o.value)).toEqual([
      SHARED,
      BEST_TIME,
      TOTAL_TIME,
      COUNTBACK,
      HEAD_TO_HEAD,
    ]);
  });

  it('gives every option a description', () => {
    // #304: always visible, not hidden until an option is selected.
    for (const option of TIEBREAKER_OPTIONS) {
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  it('flags only the two time-reading methods', () => {
    const needTime = TIEBREAKER_OPTIONS.filter((o) => o.needsTime).map((o) => o.value);
    expect(needTime).toEqual([BEST_TIME, TOTAL_TIME]);
  });
});

describe('methodPhrase', () => {
  it('describes a resolving method', () => {
    expect(methodPhrase(BEST_TIME)).toBe('fastest single heat');
    expect(methodPhrase(HEAD_TO_HEAD)).toBe('head-to-head');
  });

  it('has no phrase for SHARED, which never resolves anything', () => {
    expect(methodPhrase(SHARED)).toBeNull();
  });

  it('has no phrase for a method it does not recognise', () => {
    expect(methodPhrase('COIN_FLIP')).toBeNull();
  });
});

describe('resolutionNote', () => {
  it('names the rank and the method for a resolved row', () => {
    expect(resolutionNote(2, BEST_TIME)).toBe('2nd, on fastest single heat');
  });

  it('is null for a row the chain never touched', () => {
    expect(resolutionNote(1, null)).toBeNull();
    expect(resolutionNote(1, undefined)).toBeNull();
  });
});

describe('tiebreakerWontFire', () => {
  it('flags BEST_TIME and TOTAL_TIME on a POINTS race with no timer', () => {
    expect(tiebreakerWontFire(BEST_TIME, 'POINTS', 'NONE')).toBe(true);
    expect(tiebreakerWontFire(TOTAL_TIME, 'POINTS', 'NONE')).toBe(true);
  });

  it('does not flag them under TIMED, which always types a time by hand', () => {
    expect(tiebreakerWontFire(BEST_TIME, 'TIMED', 'NONE')).toBe(false);
  });

  it('does not flag them with a real timer', () => {
    expect(tiebreakerWontFire(BEST_TIME, 'POINTS', 'FAKE')).toBe(false);
    expect(tiebreakerWontFire(BEST_TIME, 'POINTS', 'AUTO_DETECT_BACKEND')).toBe(false);
  });

  it('never flags methods that do not read times', () => {
    expect(tiebreakerWontFire(COUNTBACK, 'POINTS', 'NONE')).toBe(false);
    expect(tiebreakerWontFire(HEAD_TO_HEAD, 'POINTS', 'NONE')).toBe(false);
    expect(tiebreakerWontFire(SHARED, 'POINTS', 'NONE')).toBe(false);
  });

  it('treats a missing track as no timer information, not a pass', () => {
    expect(tiebreakerWontFire(BEST_TIME, 'POINTS', null)).toBe(false);
    expect(tiebreakerWontFire(BEST_TIME, 'POINTS', undefined)).toBe(false);
  });
});
