import { getContrastColor } from '../../../utils/colors';
import {
    formatEventDate,
    formatEventTime,
    type PrintableDen,
    type PrintableRace,
    type PrintableRacer,
} from '../documents';
import PrintPhoto from './PrintPhoto';

interface Props {
    racer: PrintableRacer;
    race: PrintableRace;
    den?: PrintableDen;
}

/**
 * The pass a scout wears. It answers "who is this and where do they need to
 * be", so the event details are on it and the results are not.
 */
export default function PitPass({ racer, race, den }: Props) {
    const date = formatEventDate(race.dateTime);
    const time = formatEventTime(race.dateTime);

    return (
        <div className="print-card pit-pass">
            <div className="print-card-header">
                <span className="print-card-kind">Pit Pass</span>
                <span className="print-card-race">{race.name}</span>
            </div>

            <div className="print-card-body">
                <PrintPhoto racer={racer} />

                <div className="print-card-name">
                    {racer.first_name} {racer.last_name}
                </div>

                {den && (
                    <span
                        className="print-den-chip"
                        style={{
                            backgroundColor: den.color,
                            color: getContrastColor(den.color),
                        }}
                    >
                        {den.name}
                    </span>
                )}

                <div className="pit-pass-car">
                    Car #{racer.car_number || '—'}
                    {racer.car_name ? ` · ${racer.car_name}` : ''}
                </div>

                <div className="pit-pass-footer">
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
    );
}
