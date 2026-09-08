import { useQuery } from 'urql';
import { INITIAL_CONFIG_QUERY } from '../graphql/queries';
import type { GetInitialConfigStatusQuery } from '../../../gql/operations';

/**
 * The caller's own role, for deciding what a screen *shows* (#892).
 *
 * Mirrors `backend/api/auth.py`'s three values. The server is still the only
 * place that decides what a role may *do* — `RolePolicyExtension` reads
 * `POLICY`, and this hook reads none of that table. It only reads the one
 * value `RolePolicyExtension` itself resolves the check against
 * (`InitialConfigStatus.role`, backed by `auth.resolve_role`), so there is
 * nothing here for a mutation's classification to drift from: a screen that
 * hides a control this hook says the caller cannot reach is reading the same
 * fact the server would refuse the mutation on, not a second opinion of it.
 *
 * What *can* go stale is a hand-picked mapping from a control to the role
 * level it needs — `RaceDetails.tsx`'s "Add Racer needs check-in-or-above",
 * say. That mapping lives at each call site, next to the control, the same
 * way `disabled`/`hidden` props always have; it is advisory, not the
 * enforcement. If a mapping is ever wrong, the worst case is a control shown
 * that the server then refuses — which is exactly what #892 asks the refusal
 * message itself to handle gracefully, not a hole in what is allowed.
 *
 * Reads `INITIAL_CONFIG_QUERY` — the same document `Navigation.tsx` already
 * queries for `isOperator` — so a second `useRole()` call elsewhere costs no
 * second round trip; urql's cache answers both from the one response.
 */
export interface RoleInfo {
  /** `VIEWER`, `CHECKIN` or `OPERATOR`. Defaults to `OPERATOR` while the
   * query is still in flight — the same default `Navigation.tsx` already
   * uses for `isOperator`, so a page does not flash every control as
   * disabled for the one render before the first response lands, and it
   * matches what an install with no PIN set actually resolves to. */
  role: 'VIEWER' | 'CHECKIN' | 'OPERATOR';
  /** Shorthand for `role === 'OPERATOR'`. */
  isOperator: boolean;
  /** Whether this caller may run a check-in-level mutation — `CHECKIN` or
   * `OPERATOR`, never `VIEWER`. Named for what it answers rather than for
   * the comparison behind it, the same reason `isOperator` is not spelled
   * `role === 'OPERATOR'` at every call site. */
  canCheckIn: boolean;
}

const ROLE_RANK: Record<RoleInfo['role'], number> = {
  VIEWER: 0,
  CHECKIN: 1,
  OPERATOR: 2,
};

/**
 * The derivation on its own, with no urql involved — exported so it can be
 * tested directly rather than through a mocked query result, the same split
 * `useRaceStateChanged.ts` uses for `shouldRefetch`.
 */
export function roleInfoFor(role: RoleInfo['role'] | undefined | null): RoleInfo {
  const resolved = role ?? 'OPERATOR';
  return {
    role: resolved,
    isOperator: resolved === 'OPERATOR',
    canCheckIn: ROLE_RANK[resolved] >= ROLE_RANK.CHECKIN,
  };
}

export function useRole(): RoleInfo {
  const [{ data }] = useQuery<GetInitialConfigStatusQuery>({
    query: INITIAL_CONFIG_QUERY,
  });
  return roleInfoFor(data?.initialConfig?.role);
}
