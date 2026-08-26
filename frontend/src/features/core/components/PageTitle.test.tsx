// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useQuery } from 'urql';

import PageTitle from './PageTitle';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

function renderAt(path: string, races: { id: number; name: string }[] = []) {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockReturnValue([
        { data: { races }, fetching: false, error: null },
        vi.fn(),
    ]);
    return render(
        <MemoryRouter initialEntries={[path]}>
            <PageTitle />
        </MemoryRouter>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('PageTitle', () => {
    it('names the tab after the page and the race', () => {
        renderAt('/race/3/standings', [{ id: 3, name: 'Pack 42 Derby' }]);
        expect(document.title).toBe('Standings — Pack 42 Derby');
    });

    it('uses the view alone for a race it has no name for yet', () => {
        renderAt('/race/3/control/displays');
        expect(document.title).toBe('Displays');
    });

    it('names the application off a race page', () => {
        renderAt('/system-settings');
        expect(document.title).toBe('Settings — Trusty Track');
    });

    it('renders nothing', () => {
        const { container } = renderAt('/');
        expect(container.innerHTML).toBe('');
    });
});
