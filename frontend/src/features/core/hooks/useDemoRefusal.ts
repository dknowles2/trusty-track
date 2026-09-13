import { useQuery } from 'urql';
import { INITIAL_CONFIG_QUERY } from '../graphql/queries';
import type { GetInitialConfigStatusQuery } from '../../../gql/operations';

/**
 * Which mutations `DemoPolicyExtension` refuses on this instance (#1092,
 * #1095) — `demo_policy.REFUSED_MUTATIONS` itself, sorted, and empty off the
 * demo. The one source of truth for a control that wants to disable itself
 * *before* the click rather than show the server's refusal only after —
 * mirrors `useRole()`'s own reasoning for `RolePolicyExtension`'s table:
 * read from the server here, never kept as a second hand-written list on the
 * client that is free to drift from `demo_policy.py`'s (#48's rule).
 *
 * Reads `INITIAL_CONFIG_QUERY`, the same document `useRole()`/`Navigation.tsx`
 * already query, so a second call here costs no second round trip.
 */
export function useDemoRefusedMutations(): readonly string[] {
  const [{ data }] = useQuery<GetInitialConfigStatusQuery>({
    query: INITIAL_CONFIG_QUERY,
  });
  return data?.initialConfig?.demoRefusedMutations ?? [];
}

/** Whether `mutationName` is one of the mutations the demo refuses. */
export function useIsRefusedOnDemo(mutationName: string): boolean {
  return useDemoRefusedMutations().includes(mutationName);
}

/** The message every disabled-on-the-demo photo control shares (#1095). */
export const PHOTOS_REFUSED_ON_DEMO_MESSAGE = "Photos can't be uploaded on the demo";
