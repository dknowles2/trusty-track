// @vitest-environment jsdom
import '../../setupTests';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import ShareableUrl from './ShareableUrl';

describe('ShareableUrl', () => {
    it('renders the url inside a <code> element', () => {
        const { container } = render(<ShareableUrl url="http://192.168.1.24:8612/race/1/vote" />);
        const code = container.querySelector('code');
        expect(code).not.toBeNull();
        expect(code?.textContent).toBe('http://192.168.1.24:8612/race/1/vote');
    });

    it('only the address wraps — overflow-wrap: anywhere on the <code>, never break-all on the whole sentence', () => {
        const { container } = render(<ShareableUrl url="http://192.168.1.24:8612/race/1/vote" />);
        const code = container.querySelector('code') as HTMLElement;
        expect(code.style.overflowWrap).toBe('anywhere');
        expect(code.style.wordBreak).toBe('');
    });
});
