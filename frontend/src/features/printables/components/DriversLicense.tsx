import { getContrastColor } from '../../../utils/colors';
import type { PrintableRacingGroup, PrintableRace, PrintableRacer } from '../documents';
import PrintPhoto from './PrintPhoto';
import { useTerminology } from '../../../context/TerminologyContext';
import { formatDisplayName, type NameDisplay } from '../../core/displayName';

interface Props {
    racer: PrintableRacer;
    race: PrintableRace;
    racingGroup?: PrintableRacingGroup;
    /** How much of the racer's name this licence prints (#552). Defaults to
     * `'FULL'`, today's only behaviour. */
    nameDisplay?: NameDisplay | string;
}

/**
 * The keepsake. Business-card sized, laid out like a licence, and the car is
 * the subject rather than the scout — the car number is the largest thing on
 * it because that is what gets called out at the track.
 *
 * It is dressed as the thing it is named after: a security wash behind the
 * fields (`PrintSheet.css`), the number set in a plate, and a line along the
 * bottom for the driver's own signature. The signature line is blank by
 * design — nothing in the app holds a signature, and a scout signing their own
 * licence at the check-in table is the point of it.
 */
export default function DriversLicense({ racer, race, racingGroup, nameDisplay = 'FULL' }: Props) {
    const { vehicle } = useTerminology();
    return (
        <div className="print-card drivers-license">
            <div className="print-card-header">
                <span className="print-card-kind">Driver's Licence</span>
                <span className="print-card-race">{race.name}</span>
            </div>
            <div className="print-checker" />

            <div className="print-card-body">
                <PrintPhoto racer={racer} />

                <div className="drivers-license-fields">
                    <div className="print-card-name">
                        {formatDisplayName(nameDisplay, racer.first_name, racer.last_name)}
                    </div>

                    <div>
                        <div className="print-field-label">{vehicle}</div>
                        <div className="print-field-value">{racer.car_name || 'Unnamed'}</div>
                    </div>

                    {racingGroup && (
                        <span
                            className="print-racing-group-chip"
                            style={{
                                backgroundColor: racingGroup.color,
                                color: getContrastColor(racingGroup.color),
                                alignSelf: 'flex-start',
                            }}
                        >
                            {racingGroup.name}
                        </span>
                    )}
                </div>

                <div className="drivers-license-plate">
                    <div className="print-field-label">{vehicle} No.</div>
                    <div className="drivers-license-number">{racer.car_number || '—'}</div>
                </div>
            </div>

            <div className="drivers-license-signature">
                <span className="drivers-license-signature-label">Driver</span>
                <span className="drivers-license-signature-line" />
            </div>
        </div>
    );
}
