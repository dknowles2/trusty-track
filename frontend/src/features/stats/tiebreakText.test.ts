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
    "Cumulative time scoring already adds up the same heats this does — this can't break a tie it created.";

  // The full table (#1089, corrected on review — see the two pinned
  // counterexamples below): 5 methods x 4 scoring strategies x
  // timer/no-timer x drop-worst-runs on/off -> the exact reason, or null
  // when the method might still fire. `'FAKE'` stands in for "has a real
  // timer" throughout; `tiebreakerWontFire` never reads anything about a
  // timer beyond whether it is `'NONE'`. `dropWorstRuns` only changes the
  // answer for TOTAL_TIME x CUMULATIVE_TIME, so every other row uses `0`.
  const CASES: Array<[string, string, string | null, number, string | null]> = [
    // SHARED never resolves anything, so it is never flagged.
    [SHARED, TIMED, 'NONE', 0, null],
    [SHARED, TIMED, 'FAKE', 0, null],
    [SHARED, POINTS, 'NONE', 0, null],
    [SHARED, POINTS, 'FAKE', 0, null],
    [SHARED, CUMULATIVE_TIME, 'NONE', 0, null],
    [SHARED, CUMULATIVE_TIME, 'FAKE', 0, null],
    [SHARED, FASTEST_TIME, 'NONE', 0, null],
    [SHARED, FASTEST_TIME, 'FAKE', 0, null],

    // BEST_TIME ("fastest single heat"): tautological under FASTEST_TIME
    // scoring regardless of timer *or* drop_worst_runs — dropping the
    // worst (highest) values can never remove a minimum, so the tautology
    // survives a drop where TOTAL_TIME's (below) does not. Needs a
    // recorded time otherwise, so it is flagged only for POINTS + NONE.
    [BEST_TIME, TIMED, 'NONE', 0, null],
    [BEST_TIME, TIMED, 'FAKE', 0, null],
    [BEST_TIME, POINTS, 'NONE', 0, NO_TIMER_REASON],
    [BEST_TIME, POINTS, 'FAKE', 0, null],
    [BEST_TIME, CUMULATIVE_TIME, 'NONE', 0, null],
    [BEST_TIME, CUMULATIVE_TIME, 'FAKE', 0, null],
    [BEST_TIME, FASTEST_TIME, 'NONE', 0, BEST_TIME_TAUTOLOGY],
    [BEST_TIME, FASTEST_TIME, 'FAKE', 0, BEST_TIME_TAUTOLOGY],
    [BEST_TIME, FASTEST_TIME, 'NONE', 1, BEST_TIME_TAUTOLOGY],
    [BEST_TIME, FASTEST_TIME, 'FAKE', 1, BEST_TIME_TAUTOLOGY],

    // TOTAL_TIME ("lowest total time"): NEVER flagged under TIMED — a
    // disrupted round (a lane outage, #171; a latecomer, #172) is *kept*
    // under TIMED rather than dropped (`.claude/rules/scoring.md`,
    // `counts_a_disrupted_round`), so two tied racers can have run a
    // different number of heats and still average the same, while their
    // raw totals differ ([4, 6] and [5, 5, 5] both average 5.0, but total
    // 10 and 15). Flagged under CUMULATIVE_TIME only when nothing is being
    // dropped (see the pinned counterexample below for why a drop breaks
    // it). Needs a recorded time under POINTS + NONE, same as BEST_TIME.
    [TOTAL_TIME, TIMED, 'NONE', 0, null],
    [TOTAL_TIME, TIMED, 'FAKE', 0, null],
    [TOTAL_TIME, TIMED, 'NONE', 1, null],
    [TOTAL_TIME, TIMED, 'FAKE', 1, null],
    [TOTAL_TIME, POINTS, 'NONE', 0, NO_TIMER_REASON],
    [TOTAL_TIME, POINTS, 'FAKE', 0, null],
    [TOTAL_TIME, CUMULATIVE_TIME, 'NONE', 0, TOTAL_TIME_CUMULATIVE_TAUTOLOGY],
    [TOTAL_TIME, CUMULATIVE_TIME, 'FAKE', 0, TOTAL_TIME_CUMULATIVE_TAUTOLOGY],
    [TOTAL_TIME, CUMULATIVE_TIME, 'NONE', 1, null],
    [TOTAL_TIME, CUMULATIVE_TIME, 'FAKE', 1, null],
    [TOTAL_TIME, FASTEST_TIME, 'NONE', 0, null],
    [TOTAL_TIME, FASTEST_TIME, 'FAKE', 0, null],

    // COUNTBACK reads finishing places, which every scoring strategy
    // produces with or without a timer — never flagged.
    [COUNTBACK, TIMED, 'NONE', 0, null],
    [COUNTBACK, TIMED, 'FAKE', 0, null],
    [COUNTBACK, POINTS, 'NONE', 0, null],
    [COUNTBACK, POINTS, 'FAKE', 0, null],
    [COUNTBACK, CUMULATIVE_TIME, 'NONE', 0, null],
    [COUNTBACK, CUMULATIVE_TIME, 'FAKE', 0, null],
    [COUNTBACK, FASTEST_TIME, 'NONE', 0, null],
    [COUNTBACK, FASTEST_TIME, 'FAKE', 0, null],

    // HEAD_TO_HEAD's gap (the tied cars may never have shared a heat) is
    // data-dependent, not settings-dependent — a caveat in its own text,
    // never a won't-fire flag here.
    [HEAD_TO_HEAD, TIMED, 'NONE', 0, null],
    [HEAD_TO_HEAD, TIMED, 'FAKE', 0, null],
    [HEAD_TO_HEAD, POINTS, 'NONE', 0, null],
    [HEAD_TO_HEAD, POINTS, 'FAKE', 0, null],
    [HEAD_TO_HEAD, CUMULATIVE_TIME, 'NONE', 0, null],
    [HEAD_TO_HEAD, CUMULATIVE_TIME, 'FAKE', 0, null],
    [HEAD_TO_HEAD, FASTEST_TIME, 'NONE', 0, null],
    [HEAD_TO_HEAD, FASTEST_TIME, 'FAKE', 0, null],
  ];

  it.each(CASES)('%s under %s scoring with timer %s, dropWorstRuns %i', (method, scoring, timer, dropWorstRuns, expected) => {
    expect(tiebreakerWontFire(method, scoring, timer, dropWorstRuns)).toBe(expected);
  });

  // Pinned so the table above cannot be "simplified" back to the two
  // overclaims a review caught: both are reproducible directly against
  // `backend/domain/scoring.py` / `backend/domain/tiebreak.py`.
  it('does not flag TOTAL_TIME under TIMED even though every tied car averages the same — a disrupted round can leave them on different heat counts', () => {
    // heats [4, 6] -> TIMED average 5.0, raw total 10
    // heats [5, 5, 5] -> TIMED average 5.0, raw total 15
    // Same average (so they tie under TIMED), different total (so
    // TOTAL_TIME actually separates them) — the opposite of a won't-fire.
    expect(tiebreakerWontFire(TOTAL_TIME, TIMED, 'FAKE', 0)).toBeNull();
  });

  it('does not flag TOTAL_TIME under CUMULATIVE_TIME once a worst run is dropped', () => {
    // [2, 3, 100] with dropWorstRuns=1 -> CUMULATIVE_TIME drops the 100,
    // scores 5.0; raw (undropped) total 105.
    // [1, 4, 50] with dropWorstRuns=1 -> CUMULATIVE_TIME drops the 50,
    // scores 5.0; raw (undropped) total 55.
    // Identical post-drop CUMULATIVE_TIME score, different raw totals —
    // TOTAL_TIME (which sums the undropped list) still separates them.
    expect(tiebreakerWontFire(TOTAL_TIME, CUMULATIVE_TIME, 'FAKE', 1)).toBeNull();
  });

  it('never flags a method it does not recognise', () => {
    expect(tiebreakerWontFire('COIN_FLIP', POINTS, 'NONE', 0)).toBeNull();
  });

  it('treats a missing track as no timer information, not a pass', () => {
    expect(tiebreakerWontFire(BEST_TIME, POINTS, null)).toBeNull();
    expect(tiebreakerWontFire(BEST_TIME, POINTS, undefined)).toBeNull();
  });
});
