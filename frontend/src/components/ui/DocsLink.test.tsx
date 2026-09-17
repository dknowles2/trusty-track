// @vitest-environment jsdom
import '../../setupTests';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DocsLink from './DocsLink';
import { docsHref, docsTitle } from '../../docs/docsLink';

describe('DocsLink', () => {
    it('renders a new-tab link to the resolved docs href, with an icon and no visible label by default', () => {
        render(<DocsLink docsKey="awards" />);
        const link = screen.getByTestId('docs-link');
        expect(link).toHaveAttribute('href', docsHref('awards'));
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(link).toHaveAttribute('aria-label', `Help: ${docsTitle('awards')}`);
        expect(link).toHaveAttribute('title', docsTitle('awards'));
        expect(link).toHaveAttribute('data-docs-key', 'awards');
        expect(link).not.toHaveTextContent('Learn more');
    });

    it('renders visible text instead of the icon when a label is given', () => {
        render(<DocsLink docsKey="how-heats-are-built" label="Learn more →" />);
        const link = screen.getByTestId('docs-link');
        expect(link).toHaveTextContent('Learn more →');
        expect(link).toHaveAttribute('href', docsHref('how-heats-are-built'));
    });
});
