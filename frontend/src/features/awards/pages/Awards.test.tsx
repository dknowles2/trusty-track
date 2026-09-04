import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { print } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMutation, useQuery } from 'urql';
import { AlertProvider } from '../../../context/AlertContext';
import { RACE_AWARDS_QUERY } from '../graphql/queries';
import Awards from './Awards';

vi.mock('urql', async () => {
  const actual = await vi.importActual<typeof import('urql')>('urql');
  return { ...actual, useQuery: vi.fn(), useMutation: vi.fn() };
});

// The roll-down's own provenance (#615) — widened so a test can override
// either with a real value without every base fixture's `[]`/`null` narrowing
// the type out from under it.
type PassedOverFixture = {
  racer: { firstName: string; lastName: string; carNumber: number } | null;
  award: { name: string } | null;
};
type DuplicateOfFixture = { id: number; name: string } | null;

const RACE = {
  id: 1,
  name: 'Pack 42 Derby',
  votingOpen: false,
  awards: [
    {
      id: 10,
      name: 'Fastest Wolf',
      kind: 'SPEED',
      sortOrder: 0,
      source: 'ALL',
      place: 1,
      racingGroupId: 5,
      artworkKey: 'trophy',
      votable: false,
      placeContested: false,
      voteTally: [],
      racingGroup: { id: 5, name: 'Wolves' },
      recipient: {
        id: 100,
        firstName: 'Ada',
        lastName: 'Lovelace',
        carNumber: 42,
        racerImageUrl: null,
      },
      position: 1,
      passedOver: [] as PassedOverFixture[],
      duplicateOf: null as DuplicateOfFixture,
    },
    {
      id: 11,
      name: 'Best Paint',
      kind: 'SPECIAL',
      sortOrder: 1,
      source: null,
      place: null,
      racingGroupId: null,
      artworkKey: null,
      votable: true,
      placeContested: false,
      voteTally: [
        { racerId: 100, voteCount: 3, racer: { id: 100, carNumber: 42, carName: null } },
        { racerId: 101, voteCount: 1, racer: { id: 101, carNumber: 7, carName: null } },
      ],
      racingGroup: null,
      recipient: null,
      position: null as number | null,
      passedOver: [] as PassedOverFixture[],
      duplicateOf: null as DuplicateOfFixture,
    },
    {
      id: 12,
      name: 'Judges’ Choice',
      kind: 'SPECIAL',
      sortOrder: 2,
      source: null,
      place: null,
      racingGroupId: null,
      artworkKey: null,
      votable: false,
      placeContested: false,
      voteTally: [],
      racingGroup: null,
      recipient: {
        id: 101,
        firstName: 'Grace',
        lastName: 'Hopper',
        carNumber: 7,
        racerImageUrl: null,
      },
      position: null as number | null,
      passedOver: [] as PassedOverFixture[],
      duplicateOf: null as DuplicateOfFixture,
    },
  ],
  rounds: [{ id: 4, name: 'Finals', roundNumber: 2 }],
  racingGroups: [{ id: 5, name: 'Wolves', color: '#888' }],
  racers: [
    { id: 100, firstName: 'Ada', lastName: 'Lovelace', carNumber: 42, carImageUrl: null },
    {
      id: 101,
      firstName: 'Grace',
      lastName: 'Hopper',
      carNumber: 7,
      carImageUrl: '/static/car-101.jpg',
    },
  ],
};

const mutations: Record<string, ReturnType<typeof vi.fn>> = {};

function mockMutations() {
  for (const key of ['create', 'update', 'delete', 'reorder', 'voting']) {
    mutations[key] = vi.fn().mockResolvedValue({ error: undefined });
  }
  (useMutation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (document: Parameters<typeof print>[0]) => {
      const text = print(document);
      if (text.includes('CreateAward')) return [{ fetching: false }, mutations.create];
      if (text.includes('UpdateAward')) return [{ fetching: false }, mutations.update];
      if (text.includes('DeleteAward')) return [{ fetching: false }, mutations.delete];
      if (text.includes('UpdateRaceVoting')) return [{ fetching: false }, mutations.voting];
      return [{ fetching: false }, mutations.reorder];
    },
  );
}

function renderPage(race: typeof RACE | null = RACE) {
  (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { data: race ? { race } : { race: { ...RACE, awards: [] } }, fetching: false, error: undefined },
    vi.fn(),
  ]);
  mockMutations();
  render(
    <MemoryRouter initialEntries={['/race/1/awards']}>
      <AlertProvider>
        <Routes>
          <Route path="/race/:raceId/awards" element={<Awards />} />
        </Routes>
      </AlertProvider>
    </MemoryRouter>,
  );
}

describe('the awards page', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('asks for every field it renders', () => {
    // The failure this guards against is a mock written from what the
    // component reads rather than what the query selects, which is how a field
    // ends up rendering as undefined against a real backend.
    const document = print(RACE_AWARDS_QUERY);
    for (const field of [
      'kind',
      'source',
      'place',
      'racingGroupId',
      'artworkKey',
      'placeContested',
      'recipient',
      'racerImageUrl',
      'votingOpen',
      'votable',
      'voteTally',
      'carImageUrl',
      'position',
      'passedOver',
      'duplicateOf',
    ]) {
      expect(document).toContain(field);
    }
  });

  it('shows what each award is for and who holds it', () => {
    renderPage();

    expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
    expect(screen.getByText('Fastest in Wolves')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace (#42)')).toBeInTheDocument();
  });

  it('notes a contested SPEED place beside the recipient (#540)', () => {
    renderPage({
      ...RACE,
      awards: [{ ...RACE.awards[0], placeContested: true }, ...RACE.awards.slice(1)],
    });

    const row = screen.getByText('Fastest Wolf').closest('li')!;
    expect(within(row).getByText('Ada Lovelace (#42)')).toBeInTheDocument();
    expect(within(row).getByText('Tied')).toBeInTheDocument();
  });

  it('says nothing extra when the place is not contested', () => {
    renderPage();

    const row = screen.getByText('Fastest Wolf').closest('li')!;
    expect(within(row).queryByText('Tied')).not.toBeInTheDocument();
  });

  it('never notes a contested place for a judged award', () => {
    // SPECIAL has no `place` to contest — `placeContested` is always false
    // server-side, but the component's own kind check is what a stale mock
    // (or a future server change) cannot silently defeat.
    renderPage({
      ...RACE,
      awards: [RACE.awards[0], { ...RACE.awards[2], placeContested: true }],
    });

    const row = screen.getByText('Judges’ Choice').closest('li')!;
    expect(within(row).queryByText('Tied')).not.toBeInTheDocument();
  });

  it('says a judged award is undecided rather than showing nothing', () => {
    renderPage();

    const row = screen.getByText('Best Paint').closest('li')!;
    expect(within(row).getByText('Chosen by the judges')).toBeInTheDocument();
    expect(within(row).getByText('Nobody yet')).toBeInTheDocument();
  });

  it('shows a judged award that has been decided', () => {
    renderPage();

    const row = screen.getByText('Judges’ Choice').closest('li')!;
    expect(within(row).getByText('Grace Hopper (#7)')).toBeInTheDocument();
  });

  it('draws artwork next to an award that has some', () => {
    renderPage();
    const row = screen.getByText('Fastest Wolf').closest('li')!;
    expect(within(row).getByRole('img', { hidden: true })).toBeInTheDocument();

    const paintRow = screen.getByText('Best Paint').closest('li')!;
    expect(within(paintRow).queryByRole('img', { hidden: true })).toBeNull();
  });

  it('links to the certificate print page', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Print certificates' })).toHaveAttribute(
      'href',
      '/race/1/print/certificates',
    );
  });

  it('has something to say when a race has no awards', () => {
    renderPage(null);
    expect(screen.getByText(/no awards yet/i)).toBeInTheDocument();
  });

  it('reorders by swapping with the neighbour', async () => {
    renderPage();
    await userEvent.click(screen.getByLabelText('Move Best Paint earlier'));

    await waitFor(() =>
      expect(mutations.reorder).toHaveBeenCalledWith({
        raceId: 1,
        awardIds: [11, 10, 12],
      }),
    );
  });

  it('cannot move the first award earlier or the last one later', () => {
    renderPage();
    expect(screen.getByLabelText('Move Fastest Wolf earlier')).toBeDisabled();
    expect(screen.getByLabelText('Move Judges’ Choice later')).toBeDisabled();
  });

  it('does not hand a speed award permanently to its current winner', async () => {
    // Editing a speed award and switching it to judged must not pre-select
    // whoever happens to be fastest right now: the recipient is computed, and
    // seeding it would freeze it.
    renderPage();
    await userEvent.click(screen.getByLabelText('Edit Fastest Wolf'));

    await userEvent.click(await screen.findByLabelText(/somebody we choose/i));
    expect(screen.getByLabelText('Winner')).toHaveValue('');
  });

  it('keeps a judged award’s winner when editing it', async () => {
    renderPage();
    await userEvent.click(screen.getByLabelText('Edit Judges’ Choice'));
    expect(await screen.findByLabelText('Winner')).toHaveValue('101');
  });

  it('sends a new award through the create mutation', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /add an award/i }));

    await userEvent.type(await screen.findByLabelText('Award name'), 'Most Original');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    await waitFor(() =>
      expect(mutations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          raceId: 1,
          award: expect.objectContaining({ name: 'Most Original', kind: 'SPECIAL' }),
        }),
      ),
    );
  });

  it('nulls the speed fields on a judged award it sends', async () => {
    // The server clears them too, but sending a source with a judged award
    // would mean the two halves of the row disagree in transit.
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /add an award/i }));
    await userEvent.type(await screen.findByLabelText('Award name'), 'Most Original');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    await waitFor(() => expect(mutations.create).toHaveBeenCalled());
    expect(mutations.create.mock.calls[0][0].award).toMatchObject({
      source: null,
      place: null,
      racingGroupId: null,
    });
  });

  it('asks before deleting an award', async () => {
    renderPage();
    await userEvent.click(screen.getByLabelText('Delete Best Paint'));

    expect(await screen.findByText(/remove/i)).toBeInTheDocument();
    expect(mutations.delete).not.toHaveBeenCalled();
  });

  it('shows an error toast, and does not refetch, when a mutation fails (#436)', async () => {
    renderPage();
    mutations.reorder.mockResolvedValue({
      error: { graphQLErrors: [{ message: 'Awards are locked once the ceremony has run.' }] },
    });

    await userEvent.click(screen.getByLabelText('Move Best Paint earlier'));

    expect(
      await screen.findByText('Awards are locked once the ceremony has run.'),
    ).toBeInTheDocument();
  });

  describe('voting (#305)', () => {
    it('offers to open voting when it is closed', () => {
      renderPage();
      expect(screen.getByText('Voting is closed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open voting' })).toBeInTheDocument();
    });

    it('opens voting through the ordinary race-update mutation', async () => {
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Open voting' }));

      await waitFor(() =>
        expect(mutations.voting).toHaveBeenCalledWith({
          id: 1,
          race: { votingOpen: true },
        }),
      );
    });

    it('offers to close voting, and shows the address to share, once it is open', () => {
      renderPage({ ...RACE, votingOpen: true });
      expect(screen.getByText('Voting is open')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close voting' })).toBeInTheDocument();
      expect(screen.getByText(/\/race\/1\/vote/)).toBeInTheDocument();
    });

    it('shows the tally for a votable award', () => {
      renderPage();
      const row = screen.getByText('Best Paint').closest('li')!;
      expect(within(row).getByText(/#42/)).toBeInTheDocument();
      expect(within(row).getByText(/— 3/)).toBeInTheDocument();
      expect(within(row).getByText(/#7/)).toBeInTheDocument();
      expect(within(row).getByText(/— 1/)).toBeInTheDocument();
    });

    it('shows no tally for an award nobody has voted on', () => {
      renderPage();
      const row = screen.getByText('Judges’ Choice').closest('li')!;
      expect(within(row).queryByText(/Votes:/)).toBeNull();
    });

    it('applies a tally result as an ordinary award edit', async () => {
      renderPage();
      const row = screen.getByText('Best Paint').closest('li')!;
      await userEvent.click(
        within(row).getAllByRole('button', { name: 'Use this result' })[0],
      );

      await waitFor(() =>
        expect(mutations.update).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 11,
            award: expect.objectContaining({ racerId: 100, kind: 'SPECIAL' }),
          }),
        ),
      );
    });
  });

  describe('at most one trophy per racer (#615)', () => {
    it('explains a rolled-down speed award beside its recipient', () => {
      renderPage({
        ...RACE,
        awards: [
          {
            ...RACE.awards[0],
            position: 2,
            passedOver: [
              {
                racer: { firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
                award: { name: 'Fastest Car' },
              },
            ],
          },
          ...RACE.awards.slice(1),
        ] as typeof RACE.awards,
      });

      const row = screen.getByText('Fastest Wolf').closest('li')!;
      expect(
        within(row).getByText(
          'Rolled down from Fastest — Grace Hopper (#7) already won Fastest Car.',
        ),
      ).toBeInTheDocument();
    });

    it('says nothing extra when nothing rolled', () => {
      renderPage();
      const row = screen.getByText('Fastest Wolf').closest('li')!;
      expect(within(row).queryByText(/Rolled down/)).toBeNull();
    });

    it('warns about a judged award that collides with a speed trophy', () => {
      renderPage({
        ...RACE,
        awards: [
          ...RACE.awards.slice(0, 2),
          { ...RACE.awards[2], duplicateOf: { id: 10, name: 'Fastest Wolf' } },
        ],
      });

      const row = screen.getByText('Judges’ Choice').closest('li')!;
      expect(within(row).getByText('Also holds “Fastest Wolf.”')).toBeInTheDocument();
    });

    it('says nothing extra when there is no collision', () => {
      renderPage();
      const row = screen.getByText('Judges’ Choice').closest('li')!;
      expect(within(row).queryByText(/Also holds/)).toBeNull();
    });

    it('passes the race’s awards to the picker so it can warn about a collision', async () => {
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: /add an award/i }));

      await userEvent.selectOptions(
        await screen.findByLabelText('Winner'),
        'Ada Lovelace (#42)',
      );

      expect(
        screen.getByText('Already won “Fastest Wolf.” Award this one too?'),
      ).toBeInTheDocument();
    });
  });

  describe('the no-photo warning (#419)', () => {
    it('warns how many cars have no photo, with a link to the roster', () => {
      renderPage();
      expect(screen.getByText(/1 of 2 cars have no photo/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Upload photos' })).toHaveAttribute(
        'href',
        '/race/1',
      );
    });

    it('says nothing when every car has a photo', () => {
      renderPage({
        ...RACE,
        racers: RACE.racers.map((racer) => ({ ...racer, carImageUrl: '/static/photo.jpg' })),
      });
      expect(screen.queryByText(/cars have no photo/)).toBeNull();
    });

    it('shows the warning whether or not voting is open', () => {
      renderPage({ ...RACE, votingOpen: true });
      expect(screen.getByText(/1 of 2 cars have no photo/)).toBeInTheDocument();
    });
  });
});
