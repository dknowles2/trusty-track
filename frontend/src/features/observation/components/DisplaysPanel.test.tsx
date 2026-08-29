// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DisplaysPanel from './DisplaysPanel';
import { useQuery, useMutation } from 'urql';
import { ADVANCE_DISPLAY, ASSIGN_DISPLAY, IDENTIFY_DISPLAY, RENAME_DISPLAY } from '../graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
        useMutation: vi.fn(),
    };
});

const assignDisplay = vi.fn().mockResolvedValue({ data: {} });
const advanceDisplay = vi.fn().mockResolvedValue({ data: {} });
const identifyDisplay = vi.fn().mockResolvedValue({ data: {} });
const renameDisplay = vi.fn().mockResolvedValue({ data: {} });

function renderPanel(view: string, cycleSeconds = 10, connected = true, awards = 2) {
    // Two queries, and they answer different questions: the list of screens,
    // and whether the race has any awards to announce.
    type QueryArgs = { query: { definitions: { name?: { value?: string } }[] } };
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: QueryArgs) => {
        const asksForAwards = args.query.definitions.some(
            (definition) => definition.name?.value === 'RaceAwardCount',
        );
        if (asksForAwards) {
            return [
                {
                    data: {
                        race: {
                            id: 1,
                            awards: Array.from({ length: awards }, (_, i) => ({ id: i + 1 })),
                        },
                    },
                    fetching: false,
                    error: null,
                },
                vi.fn(),
            ];
        }
        return [
            {
                data: {
                    displays: [
                        {
                            displayId: 'd-1',
                            name: 'Gym north',
                            view,
                            cycleSeconds,
                            description: 'Standings',
                            pacedByAPerson: view === 'AWARDS',
                            connected,
                        },
                    ],
                },
                fetching: false,
                error: null,
            },
            vi.fn(),
        ];
    });
    // Discriminated by document: `assignDisplay` and `advanceDisplay` send
    // different variable shapes (`{ view, cycleSeconds }` vs. `{ delta }`), and
    // a single shared spy could not tell which mutation actually fired.
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation((query: unknown) => {
        if (query === ASSIGN_DISPLAY) return [{ fetching: false }, assignDisplay];
        if (query === ADVANCE_DISPLAY) return [{ fetching: false }, advanceDisplay];
        if (query === IDENTIFY_DISPLAY) return [{ fetching: false }, identifyDisplay];
        if (query === RENAME_DISPLAY) return [{ fetching: false }, renameDisplay];
        return [{ fetching: false }, vi.fn()];
    });
    render(<DisplaysPanel raceId={1} />);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('the seconds control on a display row', () => {
    it('is offered for the photo slideshow — the reported bug', () => {
        renderPanel('SLIDESHOW', 5);
        expect(screen.getByLabelText('Cycle interval for Gym north')).toBeTruthy();
    });

    it('keeps the row on its own view when the interval changes', () => {
        renderPanel('SLIDESHOW', 5);
        fireEvent.change(screen.getByLabelText('Cycle interval for Gym north'), {
            target: { value: '8' },
        });
        // The old handler hard-coded view: 'CYCLE', which would have
        // switched the screen off the slideshow to set its speed.
        expect(assignDisplay).toHaveBeenCalledWith({
            displayId: 'd-1',
            view: 'SLIDESHOW',
            cycleSeconds: 8,
        });
    });

    it('is still offered for the tab cycle', () => {
        renderPanel('CYCLE');
        expect(screen.getByLabelText('Cycle interval for Gym north')).toBeTruthy();
    });

    it('is absent for a view with no timer to set', () => {
        renderPanel('STANDINGS');
        expect(screen.queryByLabelText('Cycle interval for Gym north')).toBeNull();
    });
});

describe('driving a ceremony from the operator’s list', () => {
    it('offers Next and Previous for a screen showing the ceremony', () => {
        renderPanel('AWARDS');
        expect(screen.getByLabelText('Next award on Gym north')).toBeTruthy();
        expect(screen.getByLabelText('Previous award on Gym north')).toBeTruthy();
    });

    it('sends a step, never a slide number — only the screen knows that', () => {
        renderPanel('AWARDS');
        fireEvent.click(screen.getByLabelText('Next award on Gym north'));
        expect(advanceDisplay).toHaveBeenCalledWith({ displayId: 'd-1', delta: 1 });

        fireEvent.click(screen.getByLabelText('Previous award on Gym north'));
        expect(advanceDisplay).toHaveBeenCalledWith({ displayId: 'd-1', delta: -1 });

        // Never through assignDisplay, which is a different mutation entirely.
        expect(assignDisplay).not.toHaveBeenCalled();
    });

    it('is dead for a screen that is not there', () => {
        // A command published to a screen holding no subscription reaches
        // nobody, and its next opening payload is a reconnection rather than
        // an instruction — so the click would silently do nothing.
        renderPanel('AWARDS', 10, false);
        expect(screen.getByLabelText('Next award on Gym north')).toHaveProperty(
            'disabled',
            true,
        );
    });

    it('is absent for a view that drives itself', () => {
        renderPanel('STANDINGS');
        expect(screen.queryByLabelText('Next award on Gym north')).toBeNull();
    });
});

describe('offering the ceremony as a view', () => {
    function viewsOffered() {
        const select = screen.getByLabelText('What Gym north shows') as HTMLSelectElement;
        return Array.from(select.options).map((option) => option.textContent);
    }

    it('is offered once the race has awards', () => {
        renderPanel('STANDINGS');
        expect(viewsOffered()).toContain('Awards ceremony');
    });

    it('is left out of a race with no awards — the reported bug', () => {
        // Choosing it there sends the screen to a page whose only content is
        // a line saying there is nothing to announce.
        renderPanel('STANDINGS', 10, true, 0);
        expect(viewsOffered()).not.toContain('Awards ceremony');
    });

    it('leaves every other view alone', () => {
        renderPanel('STANDINGS', 10, true, 0);
        expect(viewsOffered()).toEqual([
            'Standings',
            "Last heat's times",
            'Cycle between both',
            'Projector',
            'Racer photos',
        ]);
    });

    it('keeps it for a screen already showing it', () => {
        // Reachable by deleting the last award mid-ceremony. Without this the
        // row's select has nothing chosen, so it says nothing about what the
        // screen is doing.
        renderPanel('AWARDS', 10, true, 0);
        const select = screen.getByLabelText('What Gym north shows') as HTMLSelectElement;
        expect(select.value).toBe('AWARDS');
    });
});

describe('identifying a screen (#495)', () => {
    it('offers an Identify control on every row', () => {
        renderPanel('STANDINGS');
        expect(screen.getByLabelText('Identify Gym north')).toBeTruthy();
    });

    it('sends the identify mutation for that display, not assign or advance', () => {
        renderPanel('STANDINGS');
        fireEvent.click(screen.getByLabelText('Identify Gym north'));

        expect(identifyDisplay).toHaveBeenCalledWith({ displayId: 'd-1' });
        expect(assignDisplay).not.toHaveBeenCalled();
        expect(advanceDisplay).not.toHaveBeenCalled();
    });

    it('is dead for a screen that is not connected', () => {
        // There is no screen to flash a name on if nothing is listening —
        // the same reasoning as the ceremony's Next/Previous.
        renderPanel('STANDINGS', 10, false);
        expect(screen.getByLabelText('Identify Gym north')).toHaveProperty('disabled', true);
    });
});

describe("the rename form's new-name reroll (#495)", () => {
    it('fills the draft input with a suggestion rather than saving it', () => {
        renderPanel('STANDINGS');
        fireEvent.click(screen.getByLabelText('Rename Gym north'));

        fireEvent.click(screen.getByLabelText('Suggest a new name'));

        // It only ever fills the draft — renameDisplay is still what commits
        // a name, and clicking the suggestion must not call it on its own.
        expect(renameDisplay).not.toHaveBeenCalled();
        const input = screen.getByPlaceholderText('e.g. Gym north') as HTMLInputElement;
        expect(input.value).not.toBe('');
        expect(input.value).not.toBe('Gym north');
    });

    it('saves the suggestion once the operator submits the form', () => {
        renderPanel('STANDINGS');
        fireEvent.click(screen.getByLabelText('Rename Gym north'));
        fireEvent.click(screen.getByLabelText('Suggest a new name'));
        const input = screen.getByPlaceholderText('e.g. Gym north') as HTMLInputElement;
        const suggested = input.value;

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(renameDisplay).toHaveBeenCalledWith({ displayId: 'd-1', name: suggested });
    });
});
