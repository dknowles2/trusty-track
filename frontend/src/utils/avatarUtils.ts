import { COMMON_COLORS } from './colors';

/**
 * Generates a deterministic color based on a numeric ID or string.
 * Ensures the same ID always returns the same color.
 * 
 * @param idOrString A number (ID) or string (e.g. name) to seed the color selection
 * @returns A hex color string from COMMON_COLORS
 */
export const getDeterministicColor = (idOrString: number | string): string => {
    let hash = 0;
    
    if (typeof idOrString === 'number') {
        hash = idOrString;
    } else {
        // Simple string hashing
        for (let i = 0; i < idOrString.length; i++) {
            hash = idOrString.charCodeAt(i) + ((hash << 5) - hash);
        }
    }
    
    // Ensure positive index
    const index = Math.abs(hash) % COMMON_COLORS.length;
    return COMMON_COLORS[index];
};

/**
 * Extracts initials from first and last name.
 * 
 * @param firstName 
 * @param lastName 
 * @returns Strings like "JD" or "J"
 */
export const getInitials = (firstName: string, lastName?: string): string => {
    const firstInitial = firstName ? firstName.charAt(0).toUpperCase() : '';
    const lastInitial = lastName ? lastName.charAt(0).toUpperCase() : '';
    
    return `${firstInitial}${lastInitial}`;
};
