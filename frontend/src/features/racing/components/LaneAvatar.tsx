import React from 'react';
import RacerAvatar from '../../management/components/RacerAvatar';
import { isCarPhoto, pickLanePhoto, type LanePhotoPreference } from '../lanePhoto';

interface LaneAvatarProps {
    racer: {
        id: number;
        firstName: string;
        lastName: string;
        racerImageUrl?: string | null;
        carImageUrl?: string | null;
    };
    preference: LanePhotoPreference;
    size?: string;
    className?: string;
    style?: React.CSSProperties;
}

/**
 * Which picture a lane shows beside a racer during a heat (#1075).
 *
 * `RacerAvatar` only ever knew the portrait. This picks between that and the
 * car photo per the operator's own device preference (`../lanePhoto.ts`), and
 * both of `RaceExecution`'s panels — the current heat and On Deck — render
 * through here so the two stay in lockstep, the same "same kind of picture"
 * rule #608 established; the toggle only changes what that kind is.
 *
 * A car photo is a rectangle, not a face, so it is clipped to a rounded
 * square rather than the portrait's circle — the shape itself hints at what
 * is pictured before the eye has read the row.
 */
const LaneAvatar: React.FC<LaneAvatarProps> = ({ racer, preference, size = '60px', className, style }) => {
    const kind = pickLanePhoto(preference, {
        racerImageUrl: racer.racerImageUrl,
        carImageUrl: racer.carImageUrl,
    });

    if (isCarPhoto(kind)) {
        return (
            <img
                src={racer.carImageUrl ?? undefined}
                alt={`${racer.firstName} ${racer.lastName}`}
                className={className}
                style={{
                    width: size,
                    height: size,
                    borderRadius: '8px',
                    objectFit: 'cover',
                    ...style,
                }}
            />
        );
    }

    // `RacerAvatar` already carries the portrait-or-initials fallback; when
    // the picked kind is 'initials' the portrait url is withheld so it does
    // not re-derive 'portrait' on its own and disagree with `pickLanePhoto`.
    return (
        <RacerAvatar
            racer={{
                id: racer.id,
                first_name: racer.firstName,
                last_name: racer.lastName,
                racer_image_url: kind === 'portrait' ? racer.racerImageUrl : null,
            }}
            size={size}
            className={className}
            style={style}
        />
    );
};

export default LaneAvatar;
