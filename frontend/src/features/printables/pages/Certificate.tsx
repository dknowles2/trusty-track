/**
 * A certificate per award, on paper (#306).
 *
 * Companion to the award ceremony: that fills a projector for the room, this
 * is the thing a scout takes home. Its own page rather than a card in
 * `Printables` — that page is a grid of one card repeated and sized in
 * inches, and this is one full-page document per award, the same shape
 * problem the heat sheet had (`certificate.ts` is its sibling module, sharing
 * only the print stylesheet).
 */

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiArrowLeft, mdiPrinter } from '@mdi/js';

import AwardArtwork from '../../awards/artwork';
import { CornerFlourish, Rosette } from '../components/PrintDecor';
import { certificatesFor, type CertificateAward } from '../certificate';
import { formatEventDate } from '../documents';
import { GET_CERTIFICATES } from '../graphql/queries';
import '../PrintSheet.css';

export default function Certificate() {
    const { raceId } = useParams<{ raceId: string }>();
    const parsedRaceId = raceId ? parseInt(raceId) : 0;

    const [{ data, fetching, error }] = useQuery({
        query: GET_CERTIFICATES,
        variables: { raceId: parsedRaceId },
        pause: !parsedRaceId,
    });

    const race = data?.race;
    const eventDate = formatEventDate(race?.dateTime);

    const certificates = useMemo(
        () => (race ? certificatesFor(race, (race.awards ?? []) as CertificateAward[]) : []),
        [race],
    );

    if (fetching && !data) return <p style={{ padding: '2rem' }}>Loading…</p>;
    if (error) return <p style={{ padding: '2rem' }}>Could not load this race.</p>;
    if (!race) return <p style={{ padding: '2rem' }}>Race not found.</p>;

    return (
        <div className="printables-page">
            <div className="printables-controls no-print">
                <div>
                    <Link
                        to={`/race/${parsedRaceId}/awards`}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: 'var(--print-primary-color)',
                            fontSize: '0.85rem',
                            marginBottom: '0.5rem',
                        }}
                    >
                        <Icon path={mdiArrowLeft} size={0.7} /> Back to awards
                    </Link>
                    <h2 style={{ margin: 0 }}>Certificates</h2>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="printables-summary">
                        {certificates.length}{' '}
                        {certificates.length === 1 ? 'certificate' : 'certificates'} ·{' '}
                        {certificates.length} {certificates.length === 1 ? 'sheet' : 'sheets'} of
                        Letter
                    </span>
                    <button
                        className="primary-btn"
                        onClick={() => window.print()}
                        disabled={certificates.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        <Icon path={mdiPrinter} size={0.8} /> Print
                    </button>
                </div>
            </div>

            {certificates.length === 0 ? (
                <p className="no-print">
                    No awards to print yet. Add some on the Awards tab first.
                </p>
            ) : (
                <div className="certificates" data-testid="certificates">
                    {certificates.map((certificate) => (
                        <article
                            key={certificate.awardId}
                            className="certificate"
                            data-testid={`certificate-${certificate.awardId}`}
                        >
                            {/* Frame furniture: one flourish, rotated into the
                                other three corners by the stylesheet. The
                                background texture is in the stylesheet rather
                                than here — a drawing big enough to fill a page
                                is clip art, and this page already carries the
                                award's own artwork. None of this carries
                                `role="img"`: that selector is how a test tells
                                a certificate with award artwork from one
                                without. */}
                            <span className="certificate-corner certificate-corner-tl">
                                <CornerFlourish />
                            </span>
                            <span className="certificate-corner certificate-corner-tr">
                                <CornerFlourish />
                            </span>
                            <span className="certificate-corner certificate-corner-br">
                                <CornerFlourish />
                            </span>
                            <span className="certificate-corner certificate-corner-bl">
                                <CornerFlourish />
                            </span>
                            <p className="certificate-eyebrow">Certificate of Achievement</p>
                            <p className="certificate-race">
                                {certificate.raceName}
                                {eventDate ? ` · ${eventDate}` : ''}
                            </p>

                            {/* A plain certificate — no ready-made template, and no
                                SPEED rule to derive one from — draws no artwork at
                                all, which is also what every certificate for an
                                award saved before this feature existed prints. */}
                            {certificate.artworkKey && (
                                <div className="certificate-artwork">
                                    <AwardArtwork
                                        artworkKey={certificate.artworkKey}
                                        size={110}
                                        palette={{
                                            line: 'var(--print-primary-color, #003F87)',
                                            fill: 'var(--print-accent-color, #FCD116)',
                                        }}
                                    />
                                </div>
                            )}

                            <h1 className="certificate-award-name">{certificate.awardName}</h1>

                            <p className="certificate-presented-to">is presented to</p>
                            <p
                                className={
                                    certificate.recipientName
                                        ? 'certificate-recipient'
                                        : 'certificate-recipient certificate-recipient-blank'
                                }
                            >
                                {certificate.recipientName ?? 'placeholder'}
                            </p>

                            <div className="certificate-seal">
                                <Rosette size={86} />
                            </div>

                            {/* Blank on purpose, like the heat sheet's Result
                                column: nothing in the app holds who signed a
                                certificate, and the signing is what handing it
                                over is. */}
                            <div className="certificate-signatures">
                                <div className="certificate-signature">Race Director</div>
                                <div className="certificate-signature">Cubmaster</div>
                            </div>

                            <p className="certificate-date">{eventDate}</p>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}
