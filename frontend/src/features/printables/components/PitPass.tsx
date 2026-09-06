import { getContrastColor } from '../../../utils/colors';
import {
    type PrintableRacingGroup,
    type PrintableRace,
    type PrintableRacer,
} from '../documents';
import { DerbyCarIllustration } from './PrintDecor';
import PrintPhoto from './PrintPhoto';
import { formatDisplayName, type NameDisplay } from '../../core/displayName';

interface Props {
    racer: PrintableRacer;
    race: PrintableRace;
    racingGroup?: PrintableRacingGroup;
    /** How much of the racer's name this pass prints (#552). Defaults to
     * `'FULL'`, today's only behaviour, for a caller that has not resolved
     * the setting. The photograph is unaffected — pit passes are handed to
     * a checked-in scout, not read by a stranger off a wall. */
    nameDisplay?: NameDisplay | string;
}

/**
 * The pass a scout wears, redesigned to match the official vertical lanyard badge.
 */
export default function PitPass({ racer, race, racingGroup, nameDisplay = 'FULL' }: Props) {
    const eventYear = race.dateTime ? new Date(race.dateTime).getFullYear() : '2026';
    const carNumber = racer.car_number != null ? String(racer.car_number) : '';
    const raceSubtitle = race.location ? `${race.name} / ${race.location}` : race.name;
    const formattedName = formatDisplayName(nameDisplay, racer.first_name, racer.last_name);

    return (
        <div className="print-card pit-pass" data-testid={`pit-pass-${racer.id}`}>
            <div className="pit-pass-top">
                <div className="pit-pass-portrait-wrap">
                    <div className="pit-pass-portrait">
                        <PrintPhoto racer={racer} />
                    </div>
                </div>

                <div className="pit-pass-titles">
                    <div className="pit-pass-racer-title">RACER</div>
                    <div className="pit-pass-subtitle">PIT PASS</div>
                </div>

                <div className="pit-pass-name-bar-wrap">
                    <div className="pit-pass-name-bar">
                        <span className="print-card-name">{formattedName}</span>
                        {racingGroup && (
                            <span
                                className="pit-pass-group-chip"
                                style={{
                                    backgroundColor: racingGroup.color,
                                    color: getContrastColor(racingGroup.color),
                                }}
                            >
                                {racingGroup.name}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="pit-pass-middle">
                <div className="pit-pass-car-col">
                    <DerbyCarIllustration width={116} height={50} number={carNumber} />
                </div>
                <div className="pit-pass-checker-col" aria-hidden="true" />
            </div>

            <div className="pit-pass-footer-split">
                <div className="pit-pass-footer-left">
                    <span className="pit-pass-race-location">{raceSubtitle}</span>
                </div>
                <div className="pit-pass-footer-right">
                    <span className="pit-pass-year">{eventYear}</span>
                </div>
            </div>
        </div>
    );
}
