import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RacerAvatar from './RacerAvatar';

describe('RacerAvatar', () => {
    it('renders image when provided', () => {
        const racer = {
            id: 1,
            first_name: 'John',
            last_name: 'Doe',
            racer_image_url: 'http://example.com/image.jpg'
        };
        render(<RacerAvatar racer={racer} />);
        const img = screen.getByRole('img');
        expect(img).toHaveAttribute('src', 'http://example.com/image.jpg');
        expect(img).toHaveAttribute('alt', 'John Doe');
    });

    it('renders initials and background color when no image provided', () => {
        const racer = {
            id: 1,
            first_name: 'John',
            last_name: 'Doe'
        };
        render(<RacerAvatar racer={racer} />);
        const avatar = screen.getByTitle('John Doe');
        expect(avatar).toHaveTextContent('JD');
        
        // Dynamically check expected color
        // ID 1 maps to COMMON_COLORS[1] (#FCD116: Gold), which is bright and gets black text.
        // JSDOM/Vitest converts 'black' to 'rgb(0, 0, 0)'
        expect(avatar).toHaveStyle({ color: 'rgb(0, 0, 0)' }); 
        // Let's just check that background-color is set
        expect(avatar.style.backgroundColor).not.toBe('');
    });
    
    it('renders first initial if no last name', () => {
        const racer = {
            id: 2,
            first_name: 'Cher',
            last_name: ''
        };
        render(<RacerAvatar racer={racer} />);
        const avatar = screen.getByTitle('Cher');
        expect(avatar).toHaveTextContent('C');
    });
});
