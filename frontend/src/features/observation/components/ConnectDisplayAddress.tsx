/**
 * "Here is the address, type it into that screen" — Race Control's own
 * Displays panel, not only the Awards page's ballot share step
 * ([#723](https://github.com/dknowles2/trusty-track/issues/723)).
 *
 * Setting up a wall display or a check-in tablet is the *first* thing an
 * operator does with a shareable address; the ballot's share step
 * ([#414](https://github.com/dknowles2/trusty-track/issues/414)) was the
 * second. This is that same address, the same Copy button, the same QR
 * code — `features/core/shareAddress.ts`'s `shareUrl` is the one place the
 * substitution happens, and `mdnsHostname` (#723) is what lets it show a
 * name that survives a DHCP lease change instead of an IP that does not.
 *
 * The QR code opens this race's own Live view (`STANDINGS`, `qrCode.ts`'s
 * default target) — a tablet with a camera but no comfortable way to type a
 * URL can scan it directly rather than being handed an address to key in by
 * hand, the same shape a phone joining the ballot already uses.
 */

import { useState } from 'react';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiAlertOutline, mdiCheck, mdiContentCopy } from '@mdi/js';
import { copyText } from '../../../utils/clipboard';
import { shareUrl, qrCodeSrc } from '../../core/shareAddress';
import { qrTargetPath } from '../qrCode';
import { NETWORK_ADDRESSES_QUERY } from '../graphql/queries';

export default function ConnectDisplayAddress({ raceId }: { raceId: number }) {
    const [result] = useQuery({ query: NETWORK_ADDRESSES_QUERY });
    const [copied, setCopied] = useState(false);

    if (typeof window === 'undefined') return null;

    const networkAddresses = result.data?.networkAddresses ?? [];
    const mdnsHostname = result.data?.mdnsHostname ?? null;
    const { url, reachable } = shareUrl(
        window.location.origin,
        qrTargetPath('STANDINGS', raceId),
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
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '0.75rem',
            }}
        >
            <span style={{ color: 'var(--text-muted-color)', wordBreak: 'break-all' }}>
                Open this address on a screen anywhere on this network to connect it: {url}
            </span>
            <button
                type="button"
                className="secondary-btn"
                onClick={handleCopy}
                aria-label={copied ? 'Copied' : 'Copy the address'}
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
                    Trusty Track could not find this machine's network address. Try typing it
                    into the other screen's browser to check before relying on it.
                </span>
            )}
            {reachable && (
                <img
                    src={qrCodeSrc(raceId, url)}
                    alt="QR code that opens this race's live display"
                    width={100}
                    height={100}
                    style={{ border: '1px solid var(--border-color)', borderRadius: '8px' }}
                />
            )}
        </div>
    );
}
