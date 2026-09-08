import { describe, it, expect } from 'vitest';
import { roleInfoFor } from './useRole';

/**
 * #892: the frontend's one place to turn the server's resolved role into UI
 * decisions. The values mirror `backend/api/auth.py`'s `Role` enum exactly —
 * see that module for what each role may actually *do*; this only decides
 * what `roleInfoFor`'s two derived flags say.
 */
describe('roleInfoFor', () => {
  it('reports a viewer as neither operator nor able to check in', () => {
    const info = roleInfoFor('VIEWER');
    expect(info).toEqual({ role: 'VIEWER', isOperator: false, canCheckIn: false });
  });

  it('reports check-in as able to check in but not operator', () => {
    const info = roleInfoFor('CHECKIN');
    expect(info).toEqual({ role: 'CHECKIN', isOperator: false, canCheckIn: true });
  });

  it('reports the operator as both', () => {
    const info = roleInfoFor('OPERATOR');
    expect(info).toEqual({ role: 'OPERATOR', isOperator: true, canCheckIn: true });
  });

  it('defaults to operator while the query has not answered yet', () => {
    // Matches what an install with no PIN set actually resolves to, and
    // avoids every control flashing disabled for the one render before the
    // first response lands — the same reasoning `Navigation.tsx`'s own
    // `isOperator !== false` default already follows.
    expect(roleInfoFor(undefined)).toEqual({
      role: 'OPERATOR',
      isOperator: true,
      canCheckIn: true,
    });
    expect(roleInfoFor(null)).toEqual({
      role: 'OPERATOR',
      isOperator: true,
      canCheckIn: true,
    });
  });
});
