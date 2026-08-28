/**
 * The four-line block every mutation call site was repeating (issue #436).
 *
 * `if (response.error) { showToast(errorText(response.error, '<msg>'), 'error');
 * return; }` appeared ten times across Awards, VotingBallot, TrackLanes and
 * TrackRecords — and `RaceControl.tsx`'s try/catch variant lost the alert half
 * in one of its seven copies, a bug filed separately. A helper does not just
 * shorten each call site; it makes "forgot the alert" unrepresentable, which
 * is how that bug class actually ends rather than being re-found one copy at
 * a time.
 *
 * Colocated with `AlertContext` because it is `useAlert()` plus `errorText`
 * and nothing else — it has no opinion about GraphQL beyond "a urql mutation
 * result carries an optional `error`".
 */

import { useAlert } from './AlertContext';
import { errorText } from '../utils/errors';

/** The part of urql's `OperationResult` this needs — `error` to check,
 * `data` for the caller to read on success. Written by hand rather than
 * imported from urql so a caller's own typed `data`/`error` shape (whatever
 * codegen or a hand-written mutation returns) is accepted as-is. */
interface MutationResponse<Data> {
  data?: Data;
  error?: unknown;
}

/** A urql `useMutation` executor: `(variables) => Promise<result>`. The
 * generated `UseMutationExecute` also takes an optional `context` second
 * argument, which this is still assignable from — nothing here needs it. */
type MutationExecute<Variables, Data> = (
  variables: Variables,
) => Promise<MutationResponse<Data>>;

/**
 * Runs a urql mutation and shows the standard error toast on failure.
 *
 * Returns the mutation's response on success, so a caller reads `.data` off
 * it exactly as before. Returns `undefined` after already having shown the
 * toast when the mutation errored — callers branch on that (`if (!response)
 * return;`) instead of re-checking `response.error` themselves, which is what
 * kept the toast and the check from ever coming apart.
 */
export function useRunMutation() {
  const { showToast } = useAlert();

  return async function runMutation<Variables, Data>(
    execute: MutationExecute<Variables, Data>,
    variables: Variables,
    fallbackMessage: string,
  ): Promise<MutationResponse<Data> | undefined> {
    const response = await execute(variables);
    if (response.error) {
      showToast(errorText(response.error, fallbackMessage), 'error');
      return undefined;
    }
    return response;
  };
}
