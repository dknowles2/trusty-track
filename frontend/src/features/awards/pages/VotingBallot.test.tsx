import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { print } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMutation, useQuery } from 'urql';
import { AlertProvider } from '../../../context/AlertContext';
import { VOTING_BALLOT_QUERY } from '../graphql/queries';
import VotingBallot from './VotingBallot';

vi.mock('urql', async () => {
  const actual = await vi.importActual<typeof import('urql')>('urql');
  return { ...actual, useQuery: vi.fn(), useMutation: vi.fn() };
});

const RACE = {
  id: 1,
  name: 'Pack 42 Derby',
  votingOpen: true,
  awards: [
    { id: 11, name: 'Best Paint', kind: 'SPECIAL', votable: true },
    { id: 12, name: 'Fastest Wolf', kind: 'SPEED', votable: false },
    { id: 13, name: "Judges' Choice", kind: 'SPECIAL', votable: false },
  ],
  racers: [
    { id: 100, carNumber: 42, carName: 'Blue Streak', carImageUrl: null },
    { id: 101, carNumber: 7, carName: null, carImageUrl: null },
    { id: 102, carNumber: null, carName: null, carImageUrl: null },
  ],
};

let castVote: ReturnType<typeof vi.fn>;

function mockMutation() {
  castVote = vi.fn().mockResolvedValue({ data: { castVote: null }, error: undefined });
  (useMutation as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { fetching: false },
    castVote,
  ]);
}

function renderPage(race: typeof RACE | null = RACE) {
  (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { data: { race }, fetching: false, error: undefined },
    vi.fn(),
  ]);
  mockMutation();
  render(
    <MemoryRouter initialEntries={['/race/1/vote']}>
      <AlertProvider>
        <Routes>
          <Route path="/race/:raceId/vote" element={<VotingBallot />} />
        </Routes>
      </AlertProvider>
    </MemoryRouter>,
  );
}

describe('the voting ballot page (#305)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('asks for cars and nothing about who built them', () => {
    // The anonymity this page promises is enforced by what it asks for —
    // there is no server-side check on a query.
    const document = print(VOTING_BALLOT_QUERY);
    for (const field of ['carNumber', 'carName', 'carImageUrl', 'votingOpen', 'votable']) {
      expect(document).toContain(field);
    }
    for (const field of ['firstName', 'lastName', 'racerImageUrl']) {
      expect(document).not.toContain(field);
    }
  });

  it('shows only the votable judged awards', () => {
    renderPage();
    expect(screen.getByText('Best Paint')).toBeInTheDocument();
    expect(screen.queryByText('Fastest Wolf')).toBeNull();
    expect(screen.queryByText("Judges' Choice")).toBeNull();
  });

  it('shows a car by number and name, never a racer name', () => {
    renderPage();
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Blue Streak')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('Unnumbered')).toBeInTheDocument();
  });

  it('says voting is closed rather than showing any awards', () => {
    renderPage({ ...RACE, votingOpen: false });
    expect(screen.getByText(/voting is closed/i)).toBeInTheDocument();
    expect(screen.queryByText('Best Paint')).toBeNull();
  });

  it('casts a vote with a fresh ballot key', async () => {
    renderPage();
    await userEvent.click(screen.getByText('#42'));

    await waitFor(() =>
      expect(castVote).toHaveBeenCalledWith(
        expect.objectContaining({ awardId: 11, racerId: 100 }),
      ),
    );
    const ballotKey = castVote.mock.calls[0][0].ballotKey;
    expect(typeof ballotKey).toBe('string');
    expect(ballotKey.length).toBeGreaterThan(0);
  });

  it('thanks the voter and offers to vote again, without locking the device', async () => {
    renderPage();
    await userEvent.click(screen.getByText('#42'));

    expect(await screen.findByText(/thanks for voting/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vote again' }));

    // The car grid for this award is back — nothing remembers the vote just
    // cast, which is the point: many voters share one device.
    expect(screen.getByText('#42')).toBeInTheDocument();
  });

  it('shows the reason a vote was refused rather than a raw error', async () => {
    castVote = vi
      .fn()
      .mockResolvedValue({ data: { castVote: 'Voting is closed.' }, error: undefined });
    (useMutation as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { fetching: false },
      castVote,
    ]);
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { data: { race: RACE }, fetching: false, error: undefined },
      vi.fn(),
    ]);
    render(
      <MemoryRouter initialEntries={['/race/1/vote']}>
        <AlertProvider>
          <Routes>
            <Route path="/race/:raceId/vote" element={<VotingBallot />} />
          </Routes>
        </AlertProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByText('#42'));

    expect(await screen.findByText('Voting is closed.')).toBeInTheDocument();
  });
});
