/**
 * The "share this with phones in the room" step on the Awards page (#414).
 *
 * `window.location.origin` names the machine running Trusty Track from its
 * own point of view — `localhost` on the documented setup — which is not an
 * address a phone on the venue wifi can open. `shareAddress.ts` (pure) works
 * out what to show instead from the backend's own `networkAddresses`; this
 * component is only the fetch, the copy button and the QR code around it.
 */

import { useState } from 'react';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiAlertOutline, mdiCheck, mdiContentCopy } from '@mdi/js';
import { copyText } from '../../../utils/clipboard';
import { NETWORK_ADDRESSES_QUERY } from '../graphql/queries';
import { shareUrl, voteQrSrc } from '../shareAddress';

interface BallotShareProps {
  raceId: number;
}

export default function BallotShare({ raceId }: BallotShareProps) {
  const [result] = useQuery({ query: NETWORK_ADDRESSES_QUERY });
  const [copied, setCopied] = useState(false);

  if (typeof window === 'undefined') return null;

  const networkAddresses = result.data?.networkAddresses ?? [];
  const { url, reachable } = shareUrl(
    window.location.origin,
    `/race/${raceId}/vote`,
    networkAddresses,
  );

  const handleCopy = async () => {
    const ok = await copyText(url);
    setCopied(ok);
    if (ok) {
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.75rem',
      }}
    >
      <span style={{ color: 'var(--text-muted-color)', wordBreak: 'break-all' }}>
        Share this address for people to vote from their phones: {url}
      </span>
      <button
        type="button"
        className="secondary-btn"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy the voting address'}
        style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.7} />
        {copied ? 'Copied' : 'Copy'}
      </button>
      {!reachable && (
        <span
          role="alert"
          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--warning-color)' }}
        >
          <Icon path={mdiAlertOutline} size={0.8} />
          Trusty Track could not find this machine's network address. A phone
          on the venue wifi may not be able to open this address — try typing
          it into a phone's browser to check before relying on it.
        </span>
      )}
      {reachable && (
        <img
          src={voteQrSrc(raceId, url)}
          alt="QR code that opens the voting page"
          width={120}
          height={120}
          style={{ border: '1px solid var(--border-color)', borderRadius: '8px' }}
        />
      )}
    </div>
  );
}
