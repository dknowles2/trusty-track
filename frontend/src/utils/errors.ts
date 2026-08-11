/**
 * Turning an error into a sentence a volunteer can act on.
 *
 * Alerts used to show whatever `.message` held. For a urql `CombinedError`
 * that reads `[GraphQL] Cannot delete round: …` or `[Network] Failed to
 * fetch` — the prefix is jargon and the network half means nothing to a
 * non-technical reader. The backend's own messages are written for the
 * operator, so those pass through unwrapped; a connection failure becomes one
 * plain sentence; anything else falls back to the caller's wording.
 *
 * Use this everywhere an error reaches a person. Showing a raw `.message` is
 * how "[Network] Failed to fetch" ends up on a projector.
 */

export const NETWORK_ERROR_TEXT =
  'Trusty Track could not be reached. Check the network connection and try again.';

/** The shape urql's CombinedError takes, without importing urql here. */
interface CombinedErrorLike {
  graphQLErrors?: { message: string }[];
  networkError?: unknown;
}

/**
 * A fetch that never reached the server rejects with the browser's own
 * wording — "Failed to fetch" (Chrome), "Load failed" (Safari), "NetworkError
 * when attempting to fetch resource" (Firefox). None of it tells a volunteer
 * anything, so all of it becomes the one network sentence.
 */
const BROWSER_NETWORK_MESSAGES = /failed to fetch|load failed|networkerror/i;

export function errorText(error: unknown, fallback: string): string {
  if (!error) return fallback;

  const combined = error as CombinedErrorLike;
  if (combined.networkError) return NETWORK_ERROR_TEXT;

  const backendMessage = combined.graphQLErrors?.[0]?.message;
  if (backendMessage) return backendMessage;

  if (error instanceof Error && error.message) {
    if (BROWSER_NETWORK_MESSAGES.test(error.message)) return NETWORK_ERROR_TEXT;
    return error.message;
  }

  return fallback;
}
