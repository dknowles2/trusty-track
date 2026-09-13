import { describe, expect, it } from 'vitest';
import {
  BEST_TIME,
  COUNTBACK,
  HEAD_TO_HEAD,
  RUN_OFF,
  SHARED,
  TIEBREAKER_OPTIONS,
  TOTAL_TIME,
  methodPhrase,
  resolutionNote,
  tiebreakerWontFire,
} from './tiebreakText';
import { CUMULATIVE_TIME, FASTEST_TIME, POINTS, TIMED } from './scoringStrategyText';

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

  it('names a run-off, deliberately outside TIEBREAKER_OPTIONS (#1017)', () => {
    // RUN_OFF is never a Race Settings policy (`.claude/rules/scoring.md`),
    // so it must not show up in the picker's own list...
    expect(TIEBREAKER_OPTIONS.map((o) => o.value)).not.toContain(RUN_OFF);
    // ...while still resolving to a phrase when a row was actually settled
    // by one.
    expect(methodPhrase(RUN_OFF)).toBe('a run-off');
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

  it('names a run-off for a row it settled (#1017)', () => {
    expect(resolutionNote(1, RUN_OFF)).toBe('1st, on a run-off');
    expect(resolutionNote(2, RUN_OFF)).toBe('2nd, on a run-off');
  });
});

describe('tiebreakerWontFire', () => {
  const NO_TIMER_REASON = 'Points scoring on a track with no timer never records a time to compare.';
  const BEST_TIME_TAUTOLOGY =
    "Fastest single run scoring already ranks cars by their best heat time — this can't break a tie it created.";
  const TOTAL_TIME_CUMULATIVE_TAUTOLOGY =
    "Cumulative time scoring already ranks cars by their total time — this can't break a tie it created.";
  const TOTAL_TIME_UNDER_TIMED =
    "Timed (average) divides every tied car's total by the same heat count, so a tie on the average is a tie on the total too.";

  // The full table (#1089): 5 methods x 4 scoring strategies x timer/no-timer
  // -> the exact reason, or null when the method might still fire. `'FAKE'`
  // stands in for "has a real timer" throughout; `tiebreakerWontFire` never
  // reads anything about a timer beyond whether it is `'NONE'`.
  const CASES: Array<[string, string, string | null, string | null]> = [
    // SHARED never resolves anything, so it is never flagged.
    [SHARED, TIMED, 'NONE', null],
    [SHARED, TIMED, 'FAKE', null],
    [SHARED, POINTS, 'NONE', null],
    [SHARED, POINTS, 'FAKE', null],
    [SHARED, CUMULATIVE_TIME, 'NONE', null],
    [SHARED, CUMULATIVE_TIME, 'FAKE', null],
    [SHARED, FASTEST_TIME, 'NONE', null],
    [SHARED, FASTEST_TIME, 'FAKE', null],

    // BEST_TIME ("fastest single heat"): tautological under FASTEST_TIME
    // scoring regardless of timer; needs a recorded time otherwise, so it
    // is flagged only for POINTS + NONE.
    [BEST_TIME, TIMED, 'NONE', null],
    [BEST_TIME, TIMED, 'FAKE', null],
    [BEST_TIME, POINTS, 'NONE', NO_TIMER_REASON],
    [BEST_TIME, POINTS, 'FAKE', null],
    [BEST_TIME, CUMULATIVE_TIME, 'NONE', null],
    [BEST_TIME, CUMULATIVE_TIME, 'FAKE', null],
    [BEST_TIME, FASTEST_TIME, 'NONE', BEST_TIME_TAUTOLOGY],
    [BEST_TIME, FASTEST_TIME, 'FAKE', BEST_TIME_TAUTOLOGY],

    // TOTAL_TIME ("lowest total time"): tautological under CUMULATIVE_TIME
    // scoring, and can never separate a tied average under TIMED — both
    // regardless of timer; needs a recorded time under POINTS + NONE.
    [TOTAL_TIME, TIMED, 'NONE', TOTAL_TIME_UNDER_TIMED],
    [TOTAL_TIME, TIMED, 'FAKE', TOTAL_TIME_UNDER_TIMED],
    [TOTAL_TIME, POINTS, 'NONE', NO_TIMER_REASON],
    [TOTAL_TIME, POINTS, 'FAKE', null],
    [TOTAL_TIME, CUMULATIVE_TIME, 'NONE', TOTAL_TIME_CUMULATIVE_TAUTOLOGY],
    [TOTAL_TIME, CUMULATIVE_TIME, 'FAKE', TOTAL_TIME_CUMULATIVE_TAUTOLOGY],
    [TOTAL_TIME, FASTEST_TIME, 'NONE', null],
    [TOTAL_TIME, FASTEST_TIME, 'FAKE', null],

    // COUNTBACK reads finishing places, which every scoring strategy
    // produces with or without a timer — never flagged.
    [COUNTBACK, TIMED, 'NONE', null],
    [COUNTBACK, TIMED, 'FAKE', null],
    [COUNTBACK, POINTS, 'NONE', null],
    [COUNTBACK, POINTS, 'FAKE', null],
    [COUNTBACK, CUMULATIVE_TIME, 'NONE', null],
    [COUNTBACK, CUMULATIVE_TIME, 'FAKE', null],
    [COUNTBACK, FASTEST_TIME, 'NONE', null],
    [COUNTBACK, FASTEST_TIME, 'FAKE', null],

    // HEAD_TO_HEAD's gap (the tied cars may never have shared a heat) is
    // data-dependent, not settings-dependent — a caveat in its own text,
    // never a won't-fire flag here.
    [HEAD_TO_HEAD, TIMED, 'NONE', null],
    [HEAD_TO_HEAD, TIMED, 'FAKE', null],
    [HEAD_TO_HEAD, POINTS, 'NONE', null],
    [HEAD_TO_HEAD, POINTS, 'FAKE', null],
    [HEAD_TO_HEAD, CUMULATIVE_TIME, 'NONE', null],
    [HEAD_TO_HEAD, CUMULATIVE_TIME, 'FAKE', null],
    [HEAD_TO_HEAD, FASTEST_TIME, 'NONE', null],
    [HEAD_TO_HEAD, FASTEST_TIME, 'FAKE', null],
  ];

  it.each(CASES)('%s under %s scoring with timer %s', (method, scoring, timer, expected) => {
    expect(tiebreakerWontFire(method, scoring, timer)).toBe(expected);
  });

  it('never flags a method it does not recognise', () => {
    expect(tiebreakerWontFire('COIN_FLIP', POINTS, 'NONE')).toBeNull();
  });

  it('treats a missing track as no timer information, not a pass', () => {
    expect(tiebreakerWontFire(BEST_TIME, POINTS, null)).toBeNull();
    expect(tiebreakerWontFire(BEST_TIME, POINTS, undefined)).toBeNull();
  });
});
