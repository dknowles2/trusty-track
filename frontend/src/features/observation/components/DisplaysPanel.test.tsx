// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DisplaysPanel from './DisplaysPanel';
import { useQuery, useMutation, useClient } from 'urql';
import { ADVANCE_DISPLAY, ASSIGN_DISPLAY, IDENTIFY_DISPLAY, RENAME_DISPLAY } from '../graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
        useMutation: vi.fn(),
        useClient: vi.fn(),
    };
});

const assignDisplay = vi.fn().mockResolvedValue({ data: {} });
const advanceDisplay = vi.fn().mockResolvedValue({ data: {} });
const identifyDisplay = vi.fn().mockResolvedValue({ data: {} });
const renameDisplay = vi.fn().mockResolvedValue({ data: {} });
// The reroll (#521) is an imperative `client.query` call rather than a
// mutation — asked of the server so it can be checked against every other
// display's name, which a component-local list could never see.
const suggestDisplayName = vi.fn();

function renderPanel(
    view: string,
    cycleSeconds = 10,
    connected = true,
    awards = 2,
    hasDisplay = true,
    scrollBehavior = 'PAGING',
    showCheckedIn = true,
    qrTarget = 'STANDINGS',
    showStandingsTicker = true,
) {
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
                    displays: !hasDisplay ? [] : [
                        {
                            displayId: 'd-1',
                            name: 'Gym north',
                            view,
                            cycleSeconds,
                            scrollBehavior,
                            showCheckedIn,
                            qrTarget,
                            showStandingsTicker,
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
    (vi.mocked(useClient) as ReturnType<typeof vi.fn>).mockReturnValue({
        query: suggestDisplayName,
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

    it('is offered for standings-only, which uses it as the page duration or scroll pass length', () => {
        renderPanel('STANDINGS_ONLY', 5);
        expect(screen.getByLabelText('Cycle interval for Gym north')).toBeTruthy();
    });
});

describe('the paging/auto-scroll control (#663)', () => {
    it('is offered for standings-only', () => {
        renderPanel('STANDINGS_ONLY');
        expect(screen.getByLabelText('How Gym north moves through the standings')).toBeTruthy();
    });

    it('is absent for every other view', () => {
        renderPanel('STANDINGS');
        expect(screen.queryByLabelText('How Gym north moves through the standings')).toBeNull();
    });

    it('reflects the display’s current choice', () => {
        renderPanel('STANDINGS_ONLY', 10, true, 2, true, 'SMOOTH');
        const select = screen.getByLabelText(
            'How Gym north moves through the standings',
        ) as HTMLSelectElement;
        expect(select.value).toBe('SMOOTH');
    });

    it('sends the choice, keeping the row on standings-only', () => {
        renderPanel('STANDINGS_ONLY');
        fireEvent.change(screen.getByLabelText('How Gym north moves through the standings'), {
            target: { value: 'SMOOTH' },
        });
        expect(assignDisplay).toHaveBeenCalledWith({
            displayId: 'd-1',
            view: 'STANDINGS_ONLY',
            scrollBehavior: 'SMOOTH',
        });
    });
});

describe('the everybody/pending-only control (#612)', () => {
    it('is offered for check-in progress', () => {
        renderPanel('CHECKIN');
        expect(screen.getByLabelText('Who Gym north lists')).toBeTruthy();
    });

    it('is absent for every other view', () => {
        renderPanel('STANDINGS');
        expect(screen.queryByLabelText('Who Gym north lists')).toBeNull();
    });

    it('reflects the display’s current choice', () => {
        renderPanel('CHECKIN', 10, true, 2, true, 'PAGING', false);
        const select = screen.getByLabelText('Who Gym north lists') as HTMLSelectElement;
        expect(select.value).toBe('PENDING');
    });

    it('sends the choice, keeping the row on check-in', () => {
        renderPanel('CHECKIN');
        fireEvent.change(screen.getByLabelText('Who Gym north lists'), {
            target: { value: 'PENDING' },
        });
        expect(assignDisplay).toHaveBeenCalledWith({
            displayId: 'd-1',
            view: 'CHECKIN',
            showCheckedIn: false,
        });
    });
});

describe('the QR target control (#614)', () => {
    it('is offered for the QR code view', () => {
        renderPanel('QRCODE');
        expect(screen.getByLabelText("What Gym north's QR code opens")).toBeTruthy();
    });

    it('is absent for every other view', () => {
        renderPanel('STANDINGS');
        expect(screen.queryByLabelText("What Gym north's QR code opens")).toBeNull();
    });

    it('reflects the display’s current choice', () => {
        renderPanel('QRCODE', 10, true, 2, true, 'PAGING', true, 'VOTE');
        const select = screen.getByLabelText("What Gym north's QR code opens") as HTMLSelectElement;
        expect(select.value).toBe('VOTE');
    });

    it('sends the choice, keeping the row on the QR code view', () => {
        renderPanel('QRCODE');
        fireEvent.change(screen.getByLabelText("What Gym north's QR code opens"), {
            target: { value: 'VOTE' },
        });
        expect(assignDisplay).toHaveBeenCalledWith({
            displayId: 'd-1',
            view: 'QRCODE',
            qrTarget: 'VOTE',
        });
    });
});

describe('the standings ticker control (#616)', () => {
    it('is offered for the broadcast overlay view', () => {
        renderPanel('OVERLAY');
        expect(screen.getByLabelText('Whether Gym north shows the standings ticker')).toBeTruthy();
    });

    it('is absent for every other view', () => {
        renderPanel('STANDINGS');
        expect(screen.queryByLabelText('Whether Gym north shows the standings ticker')).toBeNull();
    });

    it('reflects the display’s current choice', () => {
        renderPanel('OVERLAY', 10, true, 2, true, 'PAGING', true, 'STANDINGS', false);
        const select = screen.getByLabelText(
            'Whether Gym north shows the standings ticker',
        ) as HTMLSelectElement;
        expect(select.value).toBe('OFF');
    });

    it('sends the choice, keeping the row on the broadcast overlay', () => {
        renderPanel('OVERLAY');
        fireEvent.change(screen.getByLabelText('Whether Gym north shows the standings ticker'), {
            target: { value: 'OFF' },
        });
        expect(assignDisplay).toHaveBeenCalledWith({
            displayId: 'd-1',
            view: 'OVERLAY',
            showStandingsTicker: false,
        });
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
            'Standings only',
            'Check-in progress',
            'QR code',
            'Broadcast overlay (OBS)',
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

describe("the rename form's new-name reroll (#521)", () => {
    it('asks the server rather than a component-local list, so it fills the draft with a name that cannot collide', async () => {
        suggestDisplayName.mockReturnValue({
            toPromise: () => Promise.resolve({ data: { suggestDisplayName: 'Bold Beaver' } }),
        });
        renderPanel('STANDINGS');
        fireEvent.click(screen.getByLabelText('Rename Gym north'));

        fireEvent.click(screen.getByLabelText('Suggest a new name'));

        // It only ever fills the draft — renameDisplay is still what commits
        // a name, and clicking the suggestion must not call it on its own.
        expect(renameDisplay).not.toHaveBeenCalled();
        await waitFor(() => {
            const input = screen.getByPlaceholderText('e.g. Gym north') as HTMLInputElement;
            expect(input.value).toBe('Bold Beaver');
        });
        expect(suggestDisplayName).toHaveBeenCalledWith(
            expect.anything(),
            { displayId: 'd-1', avoid: 'Gym north' },
            expect.objectContaining({ requestPolicy: 'network-only' }),
        );
    });

    it('sends the draft already on screen, so pressing the die twice cannot return the same word both times', async () => {
        suggestDisplayName
            .mockReturnValueOnce({
                toPromise: () => Promise.resolve({ data: { suggestDisplayName: 'Bold Beaver' } }),
            })
            .mockReturnValueOnce({
                toPromise: () => Promise.resolve({ data: { suggestDisplayName: 'Plucky Puffin' } }),
            });
        renderPanel('STANDINGS');
        fireEvent.click(screen.getByLabelText('Rename Gym north'));

        fireEvent.click(screen.getByLabelText('Suggest a new name'));
        await waitFor(() => {
            expect(
                (screen.getByPlaceholderText('e.g. Gym north') as HTMLInputElement).value,
            ).toBe('Bold Beaver');
        });

        fireEvent.click(screen.getByLabelText('Suggest a new name'));
        await waitFor(() => {
            expect(
                (screen.getByPlaceholderText('e.g. Gym north') as HTMLInputElement).value,
            ).toBe('Plucky Puffin');
        });

        expect(suggestDisplayName).toHaveBeenLastCalledWith(
            expect.anything(),
            { displayId: 'd-1', avoid: 'Bold Beaver' },
            expect.objectContaining({ requestPolicy: 'network-only' }),
        );
    });

    it('saves the suggestion once the operator submits the form', async () => {
        suggestDisplayName.mockReturnValue({
            toPromise: () => Promise.resolve({ data: { suggestDisplayName: 'Bold Beaver' } }),
        });
        renderPanel('STANDINGS');
        fireEvent.click(screen.getByLabelText('Rename Gym north'));
        fireEvent.click(screen.getByLabelText('Suggest a new name'));
        await waitFor(() => {
            expect(
                (screen.getByPlaceholderText('e.g. Gym north') as HTMLInputElement).value,
            ).toBe('Bold Beaver');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(renameDisplay).toHaveBeenCalledWith({ displayId: 'd-1', name: 'Bold Beaver' });
    });
});

describe('opening a new display window (#590)', () => {
    // A second monitor on the operator's own computer used to share this
    // computer's single stored id with every other tab; this button hands a
    // freshly opened one an id of its own, baked into the URL, so it never
    // has to contend with a tab already claiming this machine's device id.
    it('opens a fresh screen for this race, with nothing to type', () => {
        renderPanel('STANDINGS');
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        fireEvent.click(screen.getByRole('button', { name: 'Open a new display window' }));

        expect(openSpy).toHaveBeenCalledTimes(1);
        const [url, target, features] = openSpy.mock.calls[0];
        expect(url).toMatch(/^\/race\/1\/observation\?displayId=.+$/);
        expect(target).toBe('_blank');
        // noopener, so the new window starts with no sessionStorage carried
        // over from this one — its identity comes entirely from the URL.
        expect(features).toBe('noopener');

        openSpy.mockRestore();
    });

    it('mints a different id on every click, so two windows never collide', () => {
        renderPanel('STANDINGS');
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        const button = screen.getByRole('button', { name: 'Open a new display window' });
        fireEvent.click(button);
        fireEvent.click(button);

        const firstUrl = openSpy.mock.calls[0][0];
        const secondUrl = openSpy.mock.calls[1][0];
        expect(firstUrl).not.toBe(secondUrl);

        openSpy.mockRestore();
    });

    it('is offered even before any display has opened', () => {
        renderPanel('STANDINGS', 10, true, 2, false);
        expect(screen.getByText('No audience displays are open yet.')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Open a new display window' }),
        ).toBeInTheDocument();
    });
});
