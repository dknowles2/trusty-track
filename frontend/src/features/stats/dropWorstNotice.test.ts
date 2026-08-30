import { describe, expect, it } from 'vitest';
import { dropWorstNotice } from './dropWorstNotice';

describe('dropWorstNotice', () => {
  it('says nothing when the setting is off', () => {
    expect(dropWorstNotice(0, false)).toBeNull();
  });

  it('says nothing when it actually applied', () => {
    expect(dropWorstNotice(1, true)).toBeNull();
  });

  it('explains why nothing was dropped when it is on but did not apply', () => {
    const notice = dropWorstNotice(1, false);
    expect(notice).toContain('Drop the worst 1 run is on');
    expect(notice).toContain('at least 2 each');
    expect(notice).toContain('Nothing was dropped');
  });

  it('pluralises "runs" for more than one', () => {
    expect(dropWorstNotice(2, false)).toContain('worst 2 runs is on');
    expect(dropWorstNotice(2, false)).toContain('at least 3 each');
  });
});
