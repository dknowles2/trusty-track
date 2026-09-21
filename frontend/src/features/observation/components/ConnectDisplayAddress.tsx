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
 *
 * **Everything belonging to a block lives inside this component now**
 * ([#1292](https://github.com/dknowles2/trusty-track/issues/1292)). Two
 * blocks used to sit side by side with content rendered *outside* either
 * card — a picker above one, an empty-state line below it — so their tops,
 * address rows and bottoms all landed at different heights even though both
 * were "the same card". `footer` renders after the address row (or the
 * `notice`, below), pinned to the card's own bottom edge with
 * `margin-top: auto` (`.connect-display-card` is a `flex-direction: column`
 * column the whole height of its grid row — see `.connect-devices-row` in
 * `index.css`) — the camera block's "No cameras yet" line is this, not a
 * paragraph a caller renders next to the card. `notice` replaces the address
 * row outright, for the one case with no address to show at all (a race
 * with no track yet, #1293) — it still gets the same border, heading and
 * caption every other card gets, rather than a hand-built copy of just
 * those three things. `headingExtra` is an unused slot in the heading row,
 * reserved for #1300's `DocsLink` — nothing renders there today.
 *
 * The address row itself is two slots, left (the sentence, the address,
 * Copy) and right (a fixed 100×100 QR box, reserved even before the QR has
 * loaded so the layout cannot jump once it has) — `sentence` and `qrAlt`
 * let a caller whose address is not a screen (the camera block) say so
 * specifically, defaulting to today's wording.
 */

import { useState, type ReactNode } from 'react';
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
    /** Rendered in the heading row, after the heading text. Nothing passes
     * this today — it is a reserved slot for #1300's `DocsLink`, so that
     * feature does not need to touch this component's own layout when it
     * lands. */
    headingExtra?: ReactNode;
    /** Rendered after the address row (or the `notice`), inside the same
     * card, pinned to the card's bottom edge. The camera block's "No
     * cameras yet — scan the code above to connect one." line is this,
     * not a paragraph a caller renders next to the card (#1292). */
    footer?: ReactNode;
    /** Replaces the address row with this text, while keeping the same
     * card chrome (border, heading, caption, footer) — the "this race has
     * no track yet" case (#1293), which has no address to show at all. */
    notice?: string;
    /** What the address row's sentence says before the address itself.
     * Defaults to the screen wording; a caller whose address is not a
     * screen (the camera block) says so specifically. */
    sentence?: string;
    /** The QR image's `alt` text. Defaults to the screen wording, for the
     * same reason as `sentence`. */
    qrAlt?: string;
}

export default function ConnectDisplayAddress({
    raceId,
    path,
    heading,
    caption,
    testId = 'connect-screen-address',
    headingExtra,
    footer,
    notice,
    sentence = 'Open this address on a screen anywhere on this network to connect it:',
    qrAlt = "QR code that opens this race's live display",
}: ConnectDisplayAddressProps) {
    // A `notice` has no address to show, so there is nothing for this query
    // to feed — paused rather than fetched and discarded.
    const [result] = useQuery({ query: NETWORK_ADDRESSES_QUERY, pause: !!notice });
    const [copied, setCopied] = useState(false);
    const [qrFailed, setQrFailed] = useState(false);

    if (typeof window === 'undefined') return null;

    const networkAddresses = result.data?.networkAddresses ?? [];
    const mdnsHostname = result.data?.mdnsHostname ?? null;
    const resolvedPath = path ?? qrTargetPath('STANDINGS', raceId, { spectator: false });
    const { url, reachable } = notice
        ? { url: '', reachable: false }
        : shareUrl(window.location.origin, resolvedPath, networkAddresses, mdnsHostname);

    const handleCopy = async () => {
        const ok = await copyText(url);
        setCopied(ok);
        if (ok) {
            window.setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div data-testid={testId} className="connect-display-card">
            {(heading || headingExtra) && (
                <div className="connect-display-card-heading-row">
                    {heading && <h3 className="connect-display-card-heading">{heading}</h3>}
                    {headingExtra}
                </div>
            )}
            {caption && <p className="connect-display-card-caption">{caption}</p>}
            {notice ? (
                <p className="connect-display-card-notice">{notice}</p>
            ) : (
                <div className="connect-display-address-row">
                    <div className="connect-display-address-left">
                        <div className="connect-display-address-line">
                            <span style={{ color: 'var(--text-muted-color)' }}>
                                {sentence} <ShareableUrl url={url} />
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
                        </div>
                        {!reachable && (
                            <span role="alert" className="connect-display-warning">
                                <Icon path={mdiAlertOutline} size={0.8} />
                                Trusty Track could not find this machine's network address. Try typing
                                it into the other screen's browser to check before relying on it.
                            </span>
                        )}
                    </div>
                    {/* A fixed, reserved box — before the QR has loaded, on
                        the unreachable path, and once it has failed — so the
                        QR is always at the same place in every card
                        regardless of how long its own address happens to be
                        (#1292). */}
                    <div data-testid={`${testId}-qr-box`} className="connect-display-qr-box">
                        {reachable && !qrFailed && (
                            <img
                                key={url}
                                src={qrCodeSrc(raceId, url)}
                                alt={qrAlt}
                                width={100}
                                height={100}
                                style={{ border: '1px solid var(--border-color)', borderRadius: '8px' }}
                                onError={() => setQrFailed(true)}
                            />
                        )}
                        {reachable && qrFailed && (
                            <span className="connect-display-qr-unavailable">QR unavailable</span>
                        )}
                    </div>
                </div>
            )}
            {footer && <div className="connect-display-card-footer">{footer}</div>}
        </div>
    );
}
