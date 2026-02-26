import React from 'react';
import { getDeterministicColor, getInitials } from '../../../utils/avatarUtils';
import { getContrastColor } from '../../../utils/colors';

interface RacerAvatarProps {
    racer: {
        id: number;
        first_name: string;
        last_name: string;
        racer_image_url?: string;
    };
    size?: string;
    className?: string;
    style?: React.CSSProperties;
}

const RacerAvatar: React.FC<RacerAvatarProps> = ({ racer, size = '60px', className, style }) => {
    const { id, first_name, last_name, racer_image_url } = racer;

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

    const backgroundColor = getDeterministicColor(id);
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
