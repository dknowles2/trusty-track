import { getContrastColor } from '../../../utils/colors';
import { barcodeSrc, type PrintableRacingGroup, type PrintableRace, type PrintableRacer } from '../documents';
import { useTerminology } from '../../../context/TerminologyContext';
import { formatDisplayName, type NameDisplay } from '../../core/displayName';

interface Props {
    racer: PrintableRacer;
    race: PrintableRace;
    racingGroup?: PrintableRacingGroup;
    /** How much of the racer's name this label prints (#552). Defaults to
     * `'FULL'`, today's only behaviour for a caller that has not resolved
     * the setting — a label on the underside of a car is read by a pit
     * wrangler matching it to a roster, not by a stranger off the street,
     * but it is public in the same sense a printed pit pass is, so it
     * follows the same rule rather than being a second exception. */
    nameDisplay?: NameDisplay | string;
    /**
     * The issue's "print before check-in" option (#617). Impound labels are
     * often run off before the scale opens, so the weight line prints blank
     * — `"____ oz"` — regardless of what `racer.car_weight` holds, rather
     * than this being a second, near-identical component. A racer with no
     * recorded weight already prints blank without this flag; the flag is
     * for printing an *un-weighed-looking* label even for a racer check-in
     * has already weighed, e.g. reprinting the whole batch before the
     * scale has finished the queue. Defaults to `false` — the ordinary
     * case is printing after check-in, when there is a weight to show.
     */
    printBeforeCheckIn?: boolean;
}

/** Two decimal places, with the trailing unit — `weightVerdict`'s own
 * convention for "not weighed" (absent or `0`) applies here too, and the
 * print-before-check-in flag forces the same blank regardless of what is
 * on file. A blank line rather than an empty string: this is a label
 * headed for a car or a box, and a hand can still write the number on. */
function weightLine(carWeight: number | null | undefined, printBeforeCheckIn: boolean): string {
    if (printBeforeCheckIn || carWeight == null || carWeight <= 0) return '____ oz';
    return `${carWeight.toFixed(2)} oz`;
}

/**
 * The impound label (#617). Not a keepsake — it is affixed to the underside
 * of a car or an impound box so a pit wrangler can find car #24 among fifty
 * near-identical wedges without flipping cars over or touching the axles —
 * so unlike the pit pass or the driver's licence it carries no photo and no
 * event branding beyond the header every card on this page already has.
 *
 * The car number is the loudest thing on it, sized to be read across a pit
 * table rather than close up like a licence plate's. Den, name and weight
 * are secondary — legible, not eye-catching — and the QR code is the same
 * check-in code every other printable draws from, so a pit wrangler with a
 * phone can confirm a car without reading anything at all.
 */
export default function CarSticker({ racer, race, racingGroup, nameDisplay = 'FULL', printBeforeCheckIn = false }: Props) {
    const { vehicle } = useTerminology();
    const name = formatDisplayName(nameDisplay, racer.first_name, racer.last_name);

    return (
        <div className="print-card car-sticker">
            <div className="print-card-header">
                <span className="print-card-kind">{vehicle} Label</span>
                <span className="print-card-race">{race.name}</span>
            </div>

            <div className="print-card-body">
                <div className="car-sticker-number-block">
                    <span className="car-sticker-number">{racer.car_number || '—'}</span>
                </div>

                <div className="car-sticker-fields">
                    <div className="print-card-name car-sticker-name">{name}</div>

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

                    <div className="car-sticker-weight">
                        <span className="print-field-label">Weight</span>
                        <span className="print-field-value">
                            {weightLine(racer.car_weight, printBeforeCheckIn)}
                        </span>
                    </div>
                </div>

                <img
                    className="print-qr car-sticker-qr"
                    src={barcodeSrc(racer.id)}
                    alt={`Check-in code for ${name}`}
                />
            </div>
        </div>
    );
}
