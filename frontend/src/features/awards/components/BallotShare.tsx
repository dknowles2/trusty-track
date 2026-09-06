/**
 * The "share this with phones in the room" step on the Awards page (#414).
 *
 * `window.location.origin` names the machine running Trusty Track from its
 * own point of view — `localhost` on the documented setup — which is not an
 * address a phone on the venue wifi can open. `features/core/shareAddress.ts`
 * (pure, shared with the QR code display view — #614) works out what to show
 * instead from the backend's own `networkAddresses`; this component is only
 * the fetch, the copy button and the QR code around it.
 */

import { useState } from 'react';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiAlertOutline, mdiCheck, mdiContentCopy, mdiOpenInNew, mdiQrcode } from '@mdi/js';
import { copyText } from '../../../utils/clipboard';
import { NETWORK_ADDRESSES_QUERY } from '../graphql/queries';
import { shareUrl, qrCodeSrc } from '../../core/shareAddress';
import { qrCodeWindowUrl } from '../../observation/displayIdentity';

interface BallotShareProps {
  raceId: number;
}

export default function BallotShare({ raceId }: BallotShareProps) {
  const [result] = useQuery({ query: NETWORK_ADDRESSES_QUERY });
  const [copied, setCopied] = useState(false);

  if (typeof window === 'undefined') return null;

  const networkAddresses = result.data?.networkAddresses ?? [];
  const mdnsHostname = result.data?.mdnsHostname ?? null;
  const { url, reachable } = shareUrl(
    window.location.origin,
    `/race/${raceId}/vote`,
    networkAddresses,
    mdnsHostname,
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
          src={qrCodeSrc(raceId, url)}
          alt="QR code that opens the voting page"
          width={120}
          height={120}
          style={{ border: '1px solid var(--border-color)', borderRadius: '8px' }}
        />
      )}
      {/* The full-screen answer to this whole panel (#614): rather than
          holding a laptop up, project the same code on a gym-wall screen.
          Opens a fresh display window already pointed at the QR code view —
          the URL fallback `displayView.ts` gives an unassigned screen — so
          there is nothing to configure from the operator's list first. */}
      <button
        type="button"
        className="secondary-btn"
        onClick={() =>
          window.open(qrCodeWindowUrl(raceId, 'VOTE'), '_blank', 'noopener')
        }
        style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
      >
        <Icon path={mdiQrcode} size={0.7} />
        Project QR code
        <Icon path={mdiOpenInNew} size={0.6} />
      </button>
    </div>
  );
}
