import { getContrastColor } from '../../../utils/colors';
import {
    formatEventDate,
    formatEventTime,
    type PrintableRacingGroup,
    type PrintableRace,
    type PrintableRacer,
} from '../documents';
import { DerbyCar } from './PrintDecor';
import PrintPhoto from './PrintPhoto';
import { useTerminology } from '../../../context/TerminologyContext';

interface Props {
    racer: PrintableRacer;
    race: PrintableRace;
    racingGroup?: PrintableRacingGroup;
}

/**
 * The pass a scout wears. It answers "who is this and where do they need to
 * be", so the event details are on it and the results are not.
 *
 * The car number rides on the portrait as a roundel rather than sitting in the
 * line of text below it: the number is how a scout is called to the track, and
 * on a pass swinging from a lanyard it has to be readable from further away
 * than a name is.
 */
export default function PitPass({ racer, race, racingGroup }: Props) {
    const date = formatEventDate(race.dateTime);
    const time = formatEventTime(race.dateTime);
    const { vehicle } = useTerminology();

    return (
        <div className="print-card pit-pass">
            <div className="print-card-header">
                <span className="print-card-kind">Pit Pass</span>
                <span className="print-card-race">{race.name}</span>
            </div>
            <div className="print-checker" />

            <div className="print-card-body">
                <div className="pit-pass-portrait">
                    <PrintPhoto racer={racer} />
                    <span className="pit-pass-roundel">{racer.car_number || '—'}</span>
                </div>

                <div className="print-card-name">
                    {racer.first_name} {racer.last_name}
                </div>

                {racingGroup && (
                    <span
                        className="print-racing-group-chip"
                        style={{
                            backgroundColor: racingGroup.color,
                            color: getContrastColor(racingGroup.color),
                        }}
                    >
                        {racingGroup.name}
                    </span>
                )}

                <div className="pit-pass-car">
                    {vehicle} #{racer.car_number || '—'}
                    {racer.car_name ? ` · ${racer.car_name}` : ''}
                </div>

                <div className="pit-pass-footer">
                    <DerbyCar size={26} className="pit-pass-footer-car" />
                    <div>
                        {date && (
                            <div>
                                {date}
                                {time ? ` · ${time}` : ''}
                            </div>
                        )}
                        {race.location && <div>{race.location}</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
