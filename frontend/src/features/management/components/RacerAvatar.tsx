import React from 'react';
import { getDeterministicColor, getInitials } from '../../../utils/avatarUtils';
import { getContrastColor } from '../../../utils/colors';

interface RacerAvatarProps {
    racer: {
        id: number;
        first_name: string;
        last_name: string;
        racer_image_url?: string | null;
    };
    size?: string;
    className?: string;
    style?: React.CSSProperties;
}

const RacerAvatar: React.FC<RacerAvatarProps> = ({ racer, size = '60px', className, style }) => {
    const { first_name, last_name, racer_image_url } = racer;

    if (racer_image_url) {
        return (
            <img
                src={racer_image_url}
                alt={`${first_name} ${last_name}`}
                className={className}
                style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    ...style
                }}
            />
        );
    }

    // Keyed on the name, not the id: an id depends on how many rows came
    // before it, so a rebuilt roster (or a docs run with one extra spec ahead
    // of it) recolored every avatar in the room. The name is the child.
    const backgroundColor = getDeterministicColor(`${first_name} ${last_name}`);
    const color = getContrastColor(backgroundColor);
    const initials = getInitials(first_name, last_name);

    return (
        <div
            className={className}
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                backgroundColor,
                color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: `calc(${size} * 0.4)`,
                fontWeight: 'bold',
                userSelect: 'none',
                ...style
            }}
            title={`${first_name} ${last_name}`.trim()}
        >
            {initials}
        </div>
    );
};

export default RacerAvatar;
