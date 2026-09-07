/**
 * #787 — a stale link should say so, not render an empty page.
 *
 * Two failures, one gap: `App.tsx` had no `path="*"` route, so an unmatched
 * path drew the header and then nothing; and a race id that does not
 * resolve rendered the full Roster page — an empty-looking, still-clickable
 * race, with nothing distinguishing "not loaded yet" from "not there".
 *
 * `urql`'s `useQuery` is mocked and dispatches on the operation's own name
 * (`GetInitialConfigStatus`, `GetRaceTerminology`) rather than on call order,
 * since `App`'s tree calls it more than once for the same document.
 */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Urql from 'urql';

import { ProtectedRoute, RaceTerminologyGate } from './App';
import NotFoundPage from './features/core/components/NotFoundPage';

vi.mock('urql', async () => {
  const actual = await vi.importActual<typeof import('urql')>('urql');
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

function operationName(query: unknown): string | undefined {
  const doc = query as { definitions?: { name?: { value?: string } }[] };
  return doc.definitions?.[0]?.name?.value;
}

describe('ProtectedRoute + a catch-all route (#787)', () => {
  const mockUseQuery = Urql.useQuery as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockImplementation((opts: { query: unknown }) => {
      if (operationName(opts.query) === 'GetInitialConfigStatus') {
        return [{ data: { initialConfig: { initialized: true } }, fetching: false, error: undefined }];
      }
      return [{ data: undefined, fetching: false, error: undefined }];
    });
  });

  it('renders a not-found page for a path nothing matches, on a configured install', () => {
    render(
      <MemoryRouter initialEntries={['/race/1/race-control']}>
        <Routes>
          <Route path="/some-known-route" element={<div>known</div>} />
          <Route
            path="*"
            element={<ProtectedRoute><NotFoundPage heading="Page not found" message="That page does not exist." /></ProtectedRoute>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to home/i })).toHaveAttribute('href', '/');
  });
});

describe('RaceTerminologyGate (#787)', () => {
  const mockUseQuery = Urql.useQuery as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders its children once the race resolves', () => {
    mockUseQuery.mockImplementation((opts: { query: unknown }) => {
      if (operationName(opts.query) === 'GetRaceTerminology') {
        return [{ data: { race: { id: 1, terminology: null } }, fetching: false, error: undefined }];
      }
      return [{ data: undefined, fetching: false, error: undefined }];
    });

    render(
      <MemoryRouter initialEntries={['/race/1']}>
        <Routes>
          <Route
            path="/race/:raceId"
            element={<RaceTerminologyGate><div>the roster page</div></RaceTerminologyGate>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('the roster page')).toBeInTheDocument();
  });

  it('says a race no longer exists instead of rendering an empty one', () => {
    mockUseQuery.mockImplementation((opts: { query: unknown }) => {
      if (operationName(opts.query) === 'GetRaceTerminology') {
        return [{ data: { race: null }, fetching: false, error: undefined }];
      }
      return [{ data: undefined, fetching: false, error: undefined }];
    });

    render(
      <MemoryRouter initialEntries={['/race/999']}>
        <Routes>
          <Route
            path="/race/:raceId"
            element={<RaceTerminologyGate><div>the roster page</div></RaceTerminologyGate>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText('the roster page')).not.toBeInTheDocument();
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to home/i })).toHaveAttribute('href', '/');
  });
});
