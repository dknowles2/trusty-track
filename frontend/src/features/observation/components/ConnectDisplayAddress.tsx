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
 *
 * `qrTargetPath`'s `spectator` argument is required, not defaulted, and this
 * is the one caller that passes `false` ([#1182](https://github.com/dknowles2/trusty-track/issues/1182)):
 * scanning or typing this address is how an operator connects a new wall
 * display or check-in tablet on purpose, so it has to register — the
 * opposite of the audience-facing QR code (`QRCodeDisplayView.tsx`), which
 * passes `true`.
 *
 * `path` (#1254) lets a second caller point the identical address/Copy/QR
 * machinery somewhere other than this race's own Live page — `DisplaysPanel`'s
 * own "Connect a camera" block passes `cameraWindowUrl(raceId, trackId)`
 * rather than duplicating this component. `heading`/`caption` are optional
 * labels rendered above the address row, so two blocks sitting side by side
 * read as a pair rather than two identical, unlabelled boxes.
 */

import { useState } from 'react';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiAlertOutline, mdiCheck, mdiContentCopy } from '@mdi/js';
import { copyText } from '../../../utils/clipboard';
import ShareableUrl from '../../../components/ui/ShareableUrl';
import { shareUrl, qrCodeSrc } from '../../core/shareAddress';
import { qrTargetPath } from '../qrCode';
import { NETWORK_ADDRESSES_QUERY } from '../graphql/queries';

interface ConnectDisplayAddressProps {
    raceId: number;
    /** Overrides the default `STANDINGS` target — a no-origin path such as
     * `cameraWindowUrl(raceId, trackId)` builds. Defaults to today's Live
     * page, unchanged. */
    path?: string;
    /** An optional label above the address row, so two blocks sitting side
     * by side (#1254) read as a pair. */
    heading?: string;
    /** An optional line under the heading, saying what this address is for. */
    caption?: string;
    /** Defaults to the screen block's own id — a caller adding a second
     * block (the camera one) passes its own. */
    testId?: string;
}

export default function ConnectDisplayAddress({
    raceId,
    path,
    heading,
    caption,
    testId = 'connect-screen-address',
}: ConnectDisplayAddressProps) {
    const [result] = useQuery({ query: NETWORK_ADDRESSES_QUERY });
    const [copied, setCopied] = useState(false);
    const [qrFailed, setQrFailed] = useState(false);

    if (typeof window === 'undefined') return null;

    const networkAddresses = result.data?.networkAddresses ?? [];
    const mdnsHostname = result.data?.mdnsHostname ?? null;
    const resolvedPath = path ?? qrTargetPath('STANDINGS', raceId, { spectator: false });
    const { url, reachable } = shareUrl(
        window.location.origin,
        resolvedPath,
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
        <div data-testid={testId} style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.85rem 1rem' }}>
            {heading && <h3 style={{ margin: '0 0 0.3rem', fontSize: '1rem' }}>{heading}</h3>}
            {caption && (
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                    {caption}
                </p>
            )}
            <div
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '0.75rem',
                }}
            >
            <span style={{ color: 'var(--text-muted-color)' }}>
                Open this address on a screen anywhere on this network to connect it: <ShareableUrl url={url} />
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
            {reachable && !qrFailed && (
                <img
                    key={url}
                    src={qrCodeSrc(raceId, url)}
                    alt="QR code that opens this race's live display"
                    width={100}
                    height={100}
                    style={{ border: '1px solid var(--border-color)', borderRadius: '8px' }}
                    onError={() => setQrFailed(true)}
                />
            )}
            </div>
        </div>
    );
}
