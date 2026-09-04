/**
 * The `QRCODE` view (#614): a large, high-contrast QR code a phone across the
 * room can scan, with the address printed underneath for anyone who cannot.
 *
 * Reuses #414's machinery end to end rather than building a second copy: the
 * backend renders the code (`services/printables.url_png`, shared through
 * `/api/printables/vote-qr/{raceId}.png` — see `backend/api/main.py` for why
 * that route's guard was widened rather than duplicated) and works out which
 * address a phone can actually reach (`networkAddresses`); `shareUrl` (pure,
 * now under `features/core/` since this is its second caller) substitutes a
 * LAN address for `localhost` the same way the Awards page's ballot share
 * step already does.
 *
 * `target` decides only the *path* — `qrCode.ts`'s `qrTargetPath` — never an
 * arbitrary URL: this is a closed choice between this race's own audience
 * display and its ballot, the same two pages the backend's own guard allows.
 */

import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiAlertOutline, mdiQrcode } from '@mdi/js';
import { shareUrl, qrCodeSrc } from '../../core/shareAddress';
import { qrTargetPath, resolveQrHeadline } from '../qrCode';
import type { QRTarget } from '../displayView';
import { NETWORK_ADDRESSES_QUERY } from '../graphql/queries';

interface Props {
    raceId: number;
    target: QRTarget;
    /** The race's own custom headline, null/empty for the derived default —
     * `race.qrHeadline` straight off the query. */
    headline?: string | null;
    /** Optional venue Wi-Fi guidance, shown under the address when set —
     * `race.qrWifiNote` straight off the query. */
    wifiNote?: string | null;
}

export default function QRCodeDisplayView({ raceId, target, headline, wifiNote }: Props) {
    const [result] = useQuery({ query: NETWORK_ADDRESSES_QUERY });
    const networkAddresses = result.data?.networkAddresses ?? [];

    // SSR has no `window`; every other full-screen view on this page has the
    // same guard for the same reason (this component is only ever mounted
    // client-side in practice, but the type is worth being honest about).
    if (typeof window === 'undefined') return null;

    const path = qrTargetPath(target, raceId);
    const { url, reachable } = shareUrl(window.location.origin, path, networkAddresses);
    const line = resolveQrHeadline(headline, target);

    return (
        <div
            data-testid="qrcode-view"
            style={{
                height: '100vh',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3vmin',
                padding: '4vmin',
                boxSizing: 'border-box',
                textAlign: 'center',
            }}
        >
            <h1
                style={{
                    margin: 0,
                    fontSize: '5.5vmin',
                    color: 'var(--display-text-color)',
                }}
            >
                {line}
            </h1>

            {reachable ? (
                <img
                    src={qrCodeSrc(raceId, url)}
                    alt={`QR code that opens ${url}`}
                    style={{
                        width: 'min(55vmin, 70vh)',
                        height: 'min(55vmin, 70vh)',
                        background: '#fff',
                        padding: '2vmin',
                        borderRadius: '1.5vmin',
                        boxShadow: '0 0.4vmin 1.5vmin rgba(0,0,0,0.2)',
                    }}
                />
            ) : (
                <div
                    role="alert"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '1vmin',
                        maxWidth: '70vmin',
                        color: 'var(--warning-color, #b45309)',
                    }}
                >
                    <Icon path={mdiAlertOutline} size={3} />
                    <span style={{ fontSize: '2.4vmin' }}>
                        Trusty Track could not find this machine&apos;s network address. Try
                        typing the address below into a phone&apos;s browser to check whether it
                        works from this venue&apos;s Wi-Fi.
                    </span>
                </div>
            )}

            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1vmin',
                    fontSize: '3.2vmin',
                    fontWeight: 'bold',
                    color: 'var(--display-text-color)',
                    wordBreak: 'break-all',
                }}
            >
                <Icon path={mdiQrcode} size={1.4} />
                {url}
            </div>

            {wifiNote && (
                <div
                    style={{
                        fontSize: '2.4vmin',
                        color: 'var(--display-text-muted-color)',
                    }}
                >
                    {wifiNote}
                </div>
            )}
        </div>
    );
}
