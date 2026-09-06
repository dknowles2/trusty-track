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
import { DerbyCarIllustration, PinewoodDerbySeal } from '../components/PrintDecor';
import { certificatesFor, signerTitleForOrg, type CertificateAward } from '../certificate';
import { formatEventDate } from '../documents';
import { GET_CERTIFICATES } from '../graphql/queries';
import { printablesThemeRootProps } from '../printablesTheme';
import { useTerminology } from '../../../context/TerminologyContext';
import '../PrintSheet.css';

export default function Certificate() {
    const { raceId } = useParams<{ raceId: string }>();
    const parsedRaceId = raceId ? parseInt(raceId) : 0;

    const [{ data, fetching, error }] = useQuery({
        query: GET_CERTIFICATES,
        variables: { raceId: parsedRaceId },
        pause: !parsedRaceId,
    });

    const { org } = useTerminology();
    const signerTitle = signerTitleForOrg(org);

    const race = data?.race;
    const eventDate = formatEventDate(race?.dateTime);
    const eventYear = race?.dateTime ? new Date(race.dateTime).getFullYear() : '2026';
    const packNumberMatch = race?.name?.match(/\b\d+\b/);
    const defaultNumber = packNumberMatch ? packNumberMatch[0] : '73';
    const packLocation = race ? (race.location ? `${race.name} | ${race.location}` : race.name) : '';

    const certificates = useMemo(
        () =>
            race
                ? certificatesFor(
                      race,
                      (race.awards ?? []) as CertificateAward[],
                      race.resolvedNameDisplay ?? 'FULL',
                  )
                : [],
        [race],
    );

    if (fetching && !data) return <p style={{ padding: '2rem' }}>Loading…</p>;
    if (error) return <p style={{ padding: '2rem' }}>Could not load this race.</p>;
    if (!race) return <p style={{ padding: '2rem' }}>Race not found.</p>;

    return (
        <div className="printables-page" {...printablesThemeRootProps(data?.initialConfig?.printablesTheme)}>
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
                            <div className="certificate-main">
                                <header className="certificate-header-bar">
                                    <div className="certificate-official-tag">OFFICIAL</div>
                                    <div className="certificate-champion-title">CHAMPION</div>
                                </header>

                                <div className="certificate-body">
                                    <p className="certificate-intro">THIS CERTIFICATE OF</p>

                                    <div className="certificate-award-row">
                                        {certificate.artworkKey && (
                                            <div className="certificate-artwork">
                                                <AwardArtwork
                                                    artworkKey={certificate.artworkKey}
                                                    size={44}
                                                    palette={{
                                                        line: 'var(--print-primary-color, #003F87)',
                                                        fill: 'var(--print-accent-color, #FCD116)',
                                                    }}
                                                />
                                            </div>
                                        )}
                                        <div className="certificate-award-name-wrap">
                                            <h1 className="certificate-award-name">{certificate.awardName}</h1>
                                        </div>
                                    </div>

                                    <p className="certificate-presented-to">IS AWARDED TO</p>

                                    <div className="certificate-recipient-row">
                                        <p
                                            className={
                                                certificate.recipientName
                                                    ? 'certificate-recipient'
                                                    : 'certificate-recipient certificate-recipient-blank'
                                            }
                                        >
                                            {certificate.recipientName ?? 'placeholder'}
                                        </p>
                                    </div>
                                </div>

                                <div className="certificate-lower">
                                    <div className="certificate-date-block">
                                        <span className="certificate-date-val">{eventDate || '\u00A0'}</span>
                                        <div className="certificate-sign-line" />
                                        <span className="certificate-sign-label">Date</span>
                                    </div>

                                    <div className="certificate-car-center">
                                        <DerbyCarIllustration
                                            width={310}
                                            height={138}
                                            number={defaultNumber}
                                        />
                                    </div>

                                    <div className="certificate-signature-block">
                                        <span className="certificate-signature-val">{'\u00A0'}</span>
                                        <div className="certificate-sign-line" />
                                        <span className="certificate-sign-label">{signerTitle}</span>
                                    </div>
                                </div>

                                <footer className="certificate-footer-bar">
                                    <div className="certificate-seal-badge">
                                        <PinewoodDerbySeal size={134} year={eventYear} />
                                    </div>
                                    <div className="certificate-pack-location">
                                        {packLocation}
                                    </div>
                                </footer>
                            </div>

                            <div className="certificate-checker-strip" aria-hidden="true" />
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}
