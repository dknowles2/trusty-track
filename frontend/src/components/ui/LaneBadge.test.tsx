// @vitest-environment jsdom
import '../../setupTests';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LaneBadge from './LaneBadge';

describe('LaneBadge', () => {
    it('renders its children with no dot when no colour is configured', () => {
        const { container } = render(<LaneBadge>Lane 2</LaneBadge>);
        expect(screen.getByText('Lane 2')).toBeInTheDocument();
        expect(container.querySelector('.lane-badge-dot')).toBeNull();
    });

    it('renders no dot for an empty-string colour, the "cleared but not removed" shape', () => {
        const { container } = render(<LaneBadge color="">Lane 2</LaneBadge>);
        expect(container.querySelector('.lane-badge-dot')).toBeNull();
    });

    it('renders a dot in the configured colour', () => {
        const { container } = render(<LaneBadge color="#E53935">Lane 1</LaneBadge>);
        const dot = container.querySelector('.lane-badge-dot') as HTMLElement;
        expect(dot).not.toBeNull();
        expect(dot.style.background).toBe('rgb(229, 57, 53)');
    });

    it('names a standard preset colour for anyone hovering the dot', () => {
        const { container } = render(<LaneBadge color="#E53935">Lane 1</LaneBadge>);
        const dot = container.querySelector('.lane-badge-dot') as HTMLElement;
        expect(dot.title).toBe('Red lane');
    });

    it('leaves a custom colour with no title rather than guessing a name', () => {
        const { container } = render(<LaneBadge color="#123456">Lane 1</LaneBadge>);
        const dot = container.querySelector('.lane-badge-dot') as HTMLElement;
        expect(dot.title).toBe('');
        expect(dot.getAttribute('aria-hidden')).toBe('true');
    });

    it('never uses the colour as a background fill on the badge itself', () => {
        const { container } = render(<LaneBadge color="#E53935">Lane 1</LaneBadge>);
        const badge = container.querySelector('span') as HTMLElement;
        expect(badge.style.background).toBe('');
        expect(badge.style.backgroundColor).toBe('');
    });
});
