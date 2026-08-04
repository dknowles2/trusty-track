import { getDeterministicColor, getInitials } from '../../../utils/avatarUtils';
import { getContrastColor } from '../../../utils/colors';
import type { PrintableRacer } from '../documents';

/**
 * A racer's photo on a card, or their initials if check-in has not taken one.
 *
 * Not `RacerAvatar`: that sizes itself from a prop in pixels, and everything
 * here is sized in inches by the stylesheet so the card measures the same on
 * screen as on paper. The fallback matters more here than on screen — passes
 * get printed before check-in, which is exactly when photos are missing.
 */
export default function PrintPhoto({ racer }: { racer: PrintableRacer }) {
    const name = `${racer.first_name} ${racer.last_name}`.trim();

    if (racer.racer_image_url) {
        return <img className="print-photo" src={racer.racer_image_url} alt={name} />;
    }

    const background = getDeterministicColor(racer.id);
    return (
        <div
            className="print-photo-placeholder"
            style={{ backgroundColor: background, color: getContrastColor(background) }}
        >
            {getInitials(racer.first_name, racer.last_name)}
        </div>
    );
}
