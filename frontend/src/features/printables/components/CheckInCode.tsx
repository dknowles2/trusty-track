import { barcodeSrc, type PrintableRace, type PrintableRacer } from '../documents';

interface Props {
    racer: PrintableRacer;
    race: PrintableRace;
}

/**
 * The code a check-in operator scans. Cut up and handed out, or left on the
 * sheet and scanned off it as scouts arrive — which is why the name is under
 * every code rather than only on the cut line.
 *
 * The brackets around the code are the only instruction the card has room for:
 * they are the shape a scanner's own viewfinder draws, so somebody holding a
 * phone over the sheet knows where to point it without a line of text saying
 * so.
 */
export default function CheckInCode({ racer, race }: Props) {
    const name = `${racer.first_name} ${racer.last_name}`.trim();

    return (
        <div className="print-card check-in-code">
            <div className="print-card-header">
                <span className="print-card-kind">Check-in</span>
                <span className="print-card-race">{race.name}</span>
            </div>
            <div className="print-checker" />

            <div className="print-card-body">
                <div className="check-in-code-frame">
                    <img
                        className="print-qr"
                        src={barcodeSrc(racer.id)}
                        alt={`Check-in code for ${name}`}
                    />
                </div>
                <div className="print-card-name">{name}</div>
                <div className="check-in-code-number">Car #{racer.car_number || '—'}</div>
            </div>
        </div>
    );
}
