// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery } from 'urql';
import DisplaysPage from './DisplaysPage';

// `DisplaysPanel` and `ScenesPanel` are each covered by their own test
// files — this page's own job, since #1296, is just the shared heading
// (title, Locked badge, docs link) above them.
vi.mock('../components/DisplaysPanel', () => ({
  default: () => <div data-testid="displays-panel-stub" />,
}));
vi.mock('../components/ScenesPanel', () => ({
  default: () => <div data-testid="scenes-panel-stub" />,
}));

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return { ...actual, useQuery: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage(raceId: number, locked: boolean) {
  (useQuery as any).mockReturnValue([
    { data: { races: [{ id: raceId, name: 'Test Race', isLocked: locked }] }, fetching: false, error: null },
    vi.fn(),
  ]);
  render(
    <MemoryRouter initialEntries={[`/race/${raceId}/displays`]}>
      <Routes>
        <Route path="/race/:raceId/displays" element={<DisplaysPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DisplaysPage', () => {
  it('shows the shared heading with a docs link', () => {
    renderPage(1, false);

    const heading = screen.getByTestId('displays-heading');
    expect(within(heading).getByText('Displays')).toBeInTheDocument();
    expect(within(heading).getByTestId('docs-link')).toBeInTheDocument();
    expect(within(heading).queryByText('Locked')).not.toBeInTheDocument();
  });

  it('shows the Locked badge when the race is locked (#1296)', () => {
    renderPage(1, true);

    const heading = screen.getByTestId('displays-heading');
    expect(within(heading).getByText('Locked')).toBeInTheDocument();
  });

  it('still renders the panels below the heading', () => {
    renderPage(1, false);

    expect(screen.getByTestId('displays-panel-stub')).toBeInTheDocument();
    expect(screen.getByTestId('scenes-panel-stub')).toBeInTheDocument();
  });
});
