/**
 * Common colors used across the application, particularly for Dens and Avatars.
 */
export const COMMON_COLORS = [
    '#003F87', // Scouting Blue
    '#FCD116', // Cub Scout Gold
    '#D32F2F', // Red
    '#388E3C', // Green
    '#F57C00', // Orange
    '#7B1FA2', // Purple
    '#795548', // Brown
    '#212121', // Black
    '#009688', // Teal
];

/**
 * Calculates the best contrast text color (black or white) for a given background color.
 * Uses the YIQ formula for perception-based contrast.
 * 
 * @param hexColor The background color in hex format (e.g. #RRGGBB)
 * @returns 'black' or 'white'
 */
export const getContrastColor = (hexColor: string): 'black' | 'white' => {
    // Remove hash if present
    const hex = hexColor.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // Calculate YIQ ratio
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // Return black for bright colors, white for dark colors
    // 128 is the standard threshold, but can be adjusted for preference
    return (yiq >= 128) ? 'black' : 'white';
};
