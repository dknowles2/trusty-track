/**
 * #892: every mutation on this page — createAward, updateAward, deleteAward,
 * reorderAwards, updateRaceVoting — is operator-only. A check-in tablet or an
 * unauthenticated display used to see Add an award, Edit, Delete, reorder and
 * Open/Close voting fully enabled and find out only from a refused mutation.
 * This is the screen's own half: which controls are disabled for which role.
 * Backend enforcement is `backend/tests/test_auth_policy.py`'s job.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMutation, useQuery } from 'urql';
import { AlertProvider } from '../../../context/AlertContext';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';
import Awards from './Awards';

vi.mock('urql', async () => {
  const actual = await vi.importActual<typeof import('urql')>('urql');
  return { ...actual, useQuery: vi.fn(), useMutation: vi.fn() };
});

const RACE = {
  id: 1,
  name: 'Pack 42 Derby',
  votingOpen: false,
  isLocked: false,
  awards: [
    {
      id: 10,
      name: 'Fastest Wolf',
      kind: 'SPEED',
      sortOrder: 0,
      source: 'ALL',
      place: 1,
      racingGroupId: null,
      artworkKey: 'trophy',
      votable: false,
      placeContested: false,
      voteTally: [],
      racingGroup: null,
      recipient: null,
      position: null,
      passedOver: [],
      duplicateOf: null,
    },
  ],
  rounds: [],
  racingGroups: [],
  racers: [],
};

function mockMutations() {
  (useMutation as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => [
    { fetching: false },
    vi.fn().mockResolvedValue({ error: undefined }),
  ]);
}

function mockQueries(role: 'VIEWER' | 'CHECKIN' | 'OPERATOR') {
  (useQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { query: unknown }) => {
      if (args.query === INITIAL_CONFIG_QUERY) {
        return [
          {
            data: { initialConfig: { role, isOperator: role === 'OPERATOR' } },
            fetching: false,
            error: undefined,
          },
          vi.fn(),
        ];
      }
      return [{ data: { race: RACE }, fetching: false, error: undefined }, vi.fn()];
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/race/1/awards']}>
      <AlertProvider>
        <Routes>
          <Route path="/race/:raceId/awards" element={<Awards />} />
        </Routes>
      </AlertProvider>
    </MemoryRouter>,
  );
}

describe('the awards screen reflects the caller role', () => {
  it('disables Add an award and every award row control for a viewer', async () => {
    mockQueries('VIEWER');
    mockMutations();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Add an award' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Fastest Wolf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Fastest Wolf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Fastest Wolf later' })).toBeDisabled();
  });

  it('names the operator PIN on a disabled control', async () => {
    mockQueries('VIEWER');
    mockMutations();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Add an award' })).toHaveAttribute(
      'title',
      'That needs the operator PIN. Enter it with the lock icon in the top bar.',
    );
  });

  it('disables the same controls for check-in — awards are operator-only, not check-in-level', async () => {
    mockQueries('CHECKIN');
    mockMutations();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Add an award' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Fastest Wolf' })).toBeDisabled();
  });

  it('leaves every control enabled for the operator', async () => {
    mockQueries('OPERATOR');
    mockMutations();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Add an award' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit Fastest Wolf' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete Fastest Wolf' })).toBeEnabled();
  });
});
