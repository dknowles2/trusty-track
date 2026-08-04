import { getContrastColor } from '../../../utils/colors';
import type { PrintableDen, PrintableRace, PrintableRacer } from '../documents';
import PrintPhoto from './PrintPhoto';

interface Props {
    racer: PrintableRacer;
    race: PrintableRace;
    den?: PrintableDen;
}

/**
 * The keepsake. Business-card sized, laid out like a licence, and the car is
 * the subject rather than the scout — the car number is the largest thing on
 * it because that is what gets called out at the track.
 */
export default function DriversLicense({ racer, race, den }: Props) {
    return (
        <div className="print-card drivers-license">
            <div className="print-card-header">
                <span className="print-card-kind">Driver's Licence</span>
                <span className="print-card-race">{race.name}</span>
            </div>

            <div className="print-card-body">
                <PrintPhoto racer={racer} />

                <div className="drivers-license-fields">
                    <div className="print-card-name">
                        {racer.first_name} {racer.last_name}
                    </div>

                    <div>
                        <div className="print-field-label">Car</div>
                        <div className="print-field-value">{racer.car_name || 'Unnamed'}</div>
                    </div>

                    {den && (
                        <span
                            className="print-den-chip"
                            style={{
                                backgroundColor: den.color,
                                color: getContrastColor(den.color),
                                alignSelf: 'flex-start',
                            }}
                        >
                            {den.name}
                        </span>
                    )}
                </div>

                <div style={{ textAlign: 'center' }}>
                    <div className="print-field-label">Car No.</div>
                    <div className="drivers-license-number">{racer.car_number || '—'}</div>
                </div>
            </div>
        </div>
    );
}
