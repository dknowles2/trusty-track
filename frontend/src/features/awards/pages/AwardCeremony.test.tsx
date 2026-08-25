import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery, useSubscription } from 'urql';
import AwardCeremony from './AwardCeremony';

vi.mock('urql', async () => {
  const actual = await vi.importActual<typeof import('urql')>('urql');
  return { ...actual, useQuery: vi.fn(), useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]) };
});

const RACE = {
  id: 1,
  name: 'Pack 42 Derby',
  awards: [
    {
      id: 1,
      name: 'Fastest Wolf',
      kind: 'SPEED',
      sortOrder: 0,
      source: 'PACK',
      place: 1,
      denId: 5,
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
      id: 2,
      name: 'Best Paint',
      kind: 'SPECIAL',
      sortOrder: 1,
      source: null,
      place: null,
      denId: null,
      den: null,
      recipient: null,
    },
  ],
  rounds: [],
  dens: [{ id: 5, name: 'Wolves', color: '#888' }],
  racers: [],
};

function renderCeremony(race: unknown = RACE, fetching = false) {
  (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { data: race ? { race } : undefined, fetching, error: undefined },
    vi.fn(),
  ]);
  render(
    <MemoryRouter initialEntries={['/race/1/awards/present']}>
      <Routes>
        <Route path="/race/:raceId/awards/present" element={<AwardCeremony />} />
        <Route path="/race/:raceId/observation" element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockAssignment(assignment: { assigned: boolean; view: string } | null) {
  (useSubscription as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { data: assignment ? { displayAssignment: { cycleSeconds: 10, ...assignment } } : undefined },
    vi.fn(),
  ]);
}

describe('the award ceremony', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('opens on the first award', () => {
    renderCeremony();
    expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace (#42)')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('advances on the right arrow', async () => {
    renderCeremony();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('Best Paint')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('advances on a click, because a presenter is not always at a keyboard', async () => {
    renderCeremony();
    await userEvent.click(screen.getByText('Fastest Wolf'));
    expect(screen.getByText('Best Paint')).toBeInTheDocument();
  });

  it('goes back', async () => {
    renderCeremony();
    await userEvent.keyboard('{ArrowRight}{ArrowLeft}');
    expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
  });

  it('stays on the last award rather than starting over', async () => {
    // The one the audience is photographing.
    renderCeremony();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(screen.getByText('Best Paint')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('says an award is undecided rather than skipping it', async () => {
    renderCeremony();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('Still to be decided')).toBeInTheDocument();
  });

  it('has something to say for a race with no awards', () => {
    renderCeremony({ ...RACE, awards: [] });
    expect(screen.getByText(/no awards have been set up/i)).toBeInTheDocument();
  });

  it('does not claim there are no awards while it is still loading', () => {
    // The empty state and the loading state look identical otherwise, and this
    // one goes on a projector in front of a room.
    renderCeremony(null, true);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/no awards have been set up/i)).toBeNull();
  });
});

describe('a screen assigned here stays on the operator leash — the reported bug', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('goes back to the observation page when told to show something else', () => {
    mockAssignment({ assigned: true, view: 'STANDINGS' });
    renderCeremony();
    expect(screen.getByText('observation page')).toBeInTheDocument();
  });

  it('stays while the assignment is still the ceremony', () => {
    mockAssignment({ assigned: true, view: 'AWARDS' });
    renderCeremony();
    expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
  });

  it('ignores the default payload a hand-opened ceremony receives', () => {
    // Every connected screen gets a payload carrying the default view with
    // assigned=false. Acting on it would march a ceremony somebody opened
    // directly on the projector machine off to the standings.
    mockAssignment({ assigned: false, view: 'STANDINGS' });
    renderCeremony();
    expect(screen.getByText('Fastest Wolf')).toBeInTheDocument();
  });
});
