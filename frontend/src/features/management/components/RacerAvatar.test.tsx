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

        // The color is keyed on the name, not the id — an id shifts when the
        // roster is rebuilt, and every avatar in the room recolored with it.
        // Same name, different id must therefore be the same color.
        const { container } = render(
            <RacerAvatar racer={{ ...racer, id: 999 }} />
        );
        const sameName = container.querySelector('[title="John Doe"]') as HTMLElement;
        expect(sameName.style.backgroundColor).toBe(avatar.style.backgroundColor);
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

    it('does not crash when id is null', () => {
        const racer = {
            id: null as any,
            first_name: 'Null',
            last_name: 'ID'
        };
        // This should not throw Uncaught TypeError: Cannot read properties of null (reading 'length')
        render(<RacerAvatar racer={racer} />);
        expect(screen.getByTitle('Null ID')).toBeInTheDocument();
    });
});
