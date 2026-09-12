import { render, screen, waitFor, within } from '@testing-library/react';
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
    {
      id: 100,
      carNumber: 42,
      carName: 'Blue Streak',
      carImageUrl: null,
      racingGroup: null as { color: string } | null,
    },
    {
      id: 101,
      carNumber: 7,
      carName: null,
      carImageUrl: null,
      racingGroup: null as { color: string } | null,
    },
    {
      id: 102,
      carNumber: null,
      carName: null,
      carImageUrl: null,
      racingGroup: null as { color: string } | null,
    },
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
    // there is no server-side check on a query. `racingGroup { color }`
    // is a den's colour, not a child's name (#1006) — it fills a
    // photo-less tile, not an identity.
    const document = print(VOTING_BALLOT_QUERY);
    for (const field of [
      'carNumber',
      'carName',
      'carImageUrl',
      'votingOpen',
      'votable',
      'racingGroup',
      'color',
    ]) {
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

  it('names the car the vote landed on, so a stray tap is visible (#418)', async () => {
    renderPage();
    await userEvent.click(screen.getByText('#42'));

    expect(
      await screen.findByText('Thanks for voting for #42 Blue Streak!'),
    ).toBeInTheDocument();
  });

  it('falls back sensibly when the car has no name', async () => {
    renderPage();
    // Car 101 (#7) has a number but no carName.
    await userEvent.click(screen.getByText('#7'));

    expect(await screen.findByText('Thanks for voting for #7!')).toBeInTheDocument();
  });

  it('falls back to "this car" when the car has neither a number nor a name', async () => {
    renderPage();
    // Car 102 is unnumbered and unnamed.
    await userEvent.click(screen.getByText('Unnumbered'));

    expect(
      await screen.findByText('Thanks for voting for this car!'),
    ).toBeInTheDocument();
  });

  it('shows an error toast when the vote request itself fails (#436)', async () => {
    renderPage();
    castVote.mockResolvedValue({ error: { networkError: new Error('offline') } });

    await userEvent.click(screen.getByText('#42'));

    expect(
      await screen.findByText(
        'Trusty Track could not be reached. Check the network connection and try again.',
      ),
    ).toBeInTheDocument();
    // A failed request never reaches the "thanks for voting" confirmation.
    expect(screen.queryByText(/thanks for voting/i)).toBeNull();
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

  it('fills a photo-less tile with the car number rather than an empty square (#1006)', () => {
    renderPage();

    // Every racer in the fixture has `carImageUrl: null` — nothing here
    // should ever fall back to an <img>.
    expect(screen.queryByRole('img')).toBeNull();
    // The number appears twice per car (once bare in the tile, once as
    // "#42" in the label below it) — the bare form is unique per car, so
    // finding it confirms the tile itself carries the number rather than
    // being an empty square.
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it("uses the racing group's own colour to fill a photo-less tile when the car has one", () => {
    renderPage({
      ...RACE,
      racers: [
        {
          id: 100,
          carNumber: 42,
          carName: 'Blue Streak',
          carImageUrl: null,
          racingGroup: { color: '#ff0000' },
        },
      ],
    });

    expect(screen.getByText('42')).toHaveStyle({ background: '#ff0000' });
  });

  it('collapses every award past the first, and expands one on click (#1006)', async () => {
    renderPage({
      ...RACE,
      awards: [
        { id: 11, name: 'Best Paint', kind: 'SPECIAL', votable: true },
        { id: 14, name: 'Most Original', kind: 'SPECIAL', votable: true },
      ],
    });

    const sections = document.querySelectorAll('details');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveAttribute('open');
    expect(sections[1]).not.toHaveAttribute('open');

    await userEvent.click(screen.getByText('Most Original'));

    expect(sections[1]).toHaveAttribute('open');
  });

  it("keeps a collapsed award's own summary informative once voted on (#1006)", async () => {
    renderPage({
      ...RACE,
      awards: [
        { id: 11, name: 'Best Paint', kind: 'SPECIAL', votable: true },
        { id: 14, name: 'Most Original', kind: 'SPECIAL', votable: true },
      ],
    });

    const sections = document.querySelectorAll('details');
    // Every award shares the same roster, so a car's own label ("#7") is
    // not unique across sections — scope with `within` to avoid the
    // second award's copy matching too.
    await userEvent.click(screen.getByText('Most Original'));
    expect(sections[1]).toHaveAttribute('open');

    await userEvent.click(within(sections[1] as HTMLElement).getByText('#7'));
    await within(sections[1] as HTMLElement).findByText(/thanks for voting/i);

    // Collapse it again — the vote should still be readable from the
    // summary line without reopening the section.
    await userEvent.click(screen.getByText('Most Original'));
    expect(sections[1]).not.toHaveAttribute('open');

    expect(
      within(sections[1] as HTMLElement).getByText('You voted for #7', { exact: false }),
    ).toBeInTheDocument();
  });
});
