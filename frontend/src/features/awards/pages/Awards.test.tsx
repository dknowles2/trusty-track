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

const RACE = {
  id: 1,
  name: 'Pack 42 Derby',
  awards: [
    {
      id: 10,
      name: 'Fastest Wolf',
      kind: 'SPEED',
      sortOrder: 0,
      source: 'PACK',
      place: 1,
      denId: 5,
      artworkKey: 'trophy',
      den: { id: 5, name: 'Wolves' },
      recipient: {
        id: 100,
        firstName: 'Ada',
        lastName: 'Lovelace',
        carNumber: 42,
        racerImageUrl: null,
      },
    },
    {
      id: 11,
      name: 'Best Paint',
      kind: 'SPECIAL',
      sortOrder: 1,
      source: null,
      place: null,
      denId: null,
      artworkKey: null,
      den: null,
      recipient: null,
    },
    {
      id: 12,
      name: 'Judges’ Choice',
      kind: 'SPECIAL',
      sortOrder: 2,
      source: null,
      place: null,
      denId: null,
      artworkKey: null,
      den: null,
      recipient: {
        id: 101,
        firstName: 'Grace',
        lastName: 'Hopper',
        carNumber: 7,
        racerImageUrl: null,
      },
    },
  ],
  rounds: [{ id: 4, name: 'Finals', roundNumber: 2 }],
  dens: [{ id: 5, name: 'Wolves', color: '#888' }],
  racers: [
    { id: 100, firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
    { id: 101, firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
  ],
};

const mutations: Record<string, ReturnType<typeof vi.fn>> = {};

function mockMutations() {
  for (const key of ['create', 'update', 'delete', 'reorder']) {
    mutations[key] = vi.fn().mockResolvedValue({ error: undefined });
  }
  (useMutation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (document: Parameters<typeof print>[0]) => {
      const text = print(document);
      if (text.includes('CreateAward')) return [{ fetching: false }, mutations.create];
      if (text.includes('UpdateAward')) return [{ fetching: false }, mutations.update];
      if (text.includes('DeleteAward')) return [{ fetching: false }, mutations.delete];
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
      'denId',
      'artworkKey',
      'recipient',
      'racerImageUrl',
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
      denId: null,
    });
  });

  it('asks before deleting an award', async () => {
    renderPage();
    await userEvent.click(screen.getByLabelText('Delete Best Paint'));

    expect(await screen.findByText(/remove/i)).toBeInTheDocument();
    expect(mutations.delete).not.toHaveBeenCalled();
  });
});
