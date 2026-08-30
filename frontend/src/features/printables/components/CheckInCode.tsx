import { barcodeSrc, type PrintableRace, type PrintableRacer } from '../documents';
import { useTerminology } from '../../../context/TerminologyContext';

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
 *
 * **Deliberately not abbreviated by the name-display setting (#552).** Every
 * other printable on this page prints a full name today, but this one is
 * scanned by the *check-in* desk to find the right child in a queue — the
 * same job `CheckInScanner.tsx`'s manual entry does — so it belongs with the
 * operator surfaces the setting leaves alone, not with the pit passes and
 * licences a scout carries around the venue.
 */
export default function CheckInCode({ racer, race }: Props) {
    const name = `${racer.first_name} ${racer.last_name}`.trim();
    const { vehicle } = useTerminology();

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
                <div className="check-in-code-number">{vehicle} #{racer.car_number || '—'}</div>
            </div>
        </div>
    );
}
