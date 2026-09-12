import { PIN_HEADER } from './pin';

/**
 * Ask the server what role a *candidate* PIN would resolve to, before it is
 * stored anywhere (#993).
 *
 * A raw `fetch`, not the urql client. The client's fetch exchange always
 * attaches whatever PIN this device already holds (`pinHeaders()` reads
 * `localStorage`), so there is no way to ask it about a PIN that has not been
 * written yet without writing it first — which is the bug this exists to fix.
 * Its normalized cache is also keyed on the document and variables alone, not
 * the header, so running `INITIAL_CONFIG_QUERY` through it with a guessed PIN
 * would overwrite the cached `role` for the device's *real* credential with
 * whatever the guess resolves to, on a hit or a miss. Bypassing the client
 * entirely is what makes this a pure question with nothing left over
 * afterwards.
 *
 * `initialConfig` is an ordinary query — the PIN header is read by
 * `get_graphql_context` regardless of operation type, and `role` is resolved
 * from it with no write anywhere on the way (`auth.resolve_role`,
 * `auth.role_for`). Nothing here is a mutation, so `RolePolicyExtension`
 * never enters into it and a `VIEWER` — which is what an unverified guess
 * always is until this answers — may ask it freely.
 */
export async function verifyPin(
  pin: string,
): Promise<'VIEWER' | 'CHECKIN' | 'OPERATOR'> {
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [PIN_HEADER]: pin,
    },
    body: JSON.stringify({ query: 'query VerifyPin { initialConfig { role } }' }),
  });
  if (!response.ok) {
    throw new Error('Could not reach the server to check that PIN.');
  }
  const body = await response.json();
  const role = body?.data?.initialConfig?.role;
  if (role === 'VIEWER' || role === 'CHECKIN' || role === 'OPERATOR') {
    return role;
  }
  throw new Error('Could not reach the server to check that PIN.');
}
