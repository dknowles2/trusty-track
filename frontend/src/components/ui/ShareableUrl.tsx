/**
 * A URL rendered inside a sentence of ordinary prose (#1151).
 *
 * `ConnectDisplayAddress.tsx` and `BallotShare.tsx` both used to put
 * `wordBreak: 'break-all'` on the span holding the *whole* sentence, not
 * just the address, so the prose itself broke mid-word on a narrow screen
 * ("fro / m their phones"). `overflow-wrap: anywhere` breaks a long token
 * only when it has to — an ordinary word never needs it, so scoping the
 * property to just the `<code>` holding the address fixes the sentence
 * without giving up the wrap the URL itself still needs.
 */
export default function ShareableUrl({ url }: { url: string }) {
  return <code style={{ overflowWrap: 'anywhere' }}>{url}</code>;
}
