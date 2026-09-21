// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import DisplaysPanel from './DisplaysPanel';
import { useQuery, useMutation, useClient } from 'urql';
import {
    ADVANCE_DISPLAY,
    ASSIGN_DISPLAY,
    IDENTIFY_DISPLAY,
    RENAME_DISPLAY,
    SET_CAMERA_TRACK,
} from '../graphql/queries';

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
    onDisplaysChange?: (hasDisplays: boolean) => void,
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
    render(<DisplaysPanel raceId={1} onDisplaysChange={onDisplaysChange} />);
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
        // Grouped (#948), not in `VIEW_OPTIONS`' own declaration order — see
        // "grouping the options into optgroups" below for the grouping
        // itself.
        expect(viewsOffered()).toEqual([
            'Standings',
            "Last heat's times",
            'Cycle between both',
            'Projector',
            'Broadcast overlay (OBS)',
            'Racer photos',
            'Standings only',
            'QR code',
            'Check-in progress',
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

describe('grouping the options into optgroups (#948)', () => {
    function optgroupLabels() {
        const select = screen.getByLabelText('What Gym north shows') as HTMLSelectElement;
        return Array.from(select.querySelectorAll('optgroup')).map((group) => group.label);
    }

    it('offers the four groups the issue lists, in order', () => {
        renderPanel('STANDINGS', 10, true, 2);
        expect(optgroupLabels()).toEqual([
            'During racing',
            'Between heats',
            'Before racing',
            'After',
        ]);
    });

    it('drops the After group along with the ceremony option for a race with no awards', () => {
        renderPanel('STANDINGS', 10, true, 0);
        expect(optgroupLabels()).toEqual(['During racing', 'Between heats', 'Before racing']);
    });

    it('puts each option under the group the issue names', () => {
        renderPanel('STANDINGS', 10, true, 2);
        const select = screen.getByLabelText('What Gym north shows') as HTMLSelectElement;
        const byGroup = (label: string) =>
            Array.from(
                select.querySelector(`optgroup[label="${label}"]`)?.querySelectorAll('option') ??
                    [],
            ).map((option) => option.textContent);

        expect(byGroup('During racing')).toEqual([
            'Standings',
            "Last heat's times",
            'Cycle between both',
            'Projector',
            'Broadcast overlay (OBS)',
        ]);
        expect(byGroup('Between heats')).toEqual(['Racer photos', 'Standings only', 'QR code']);
        expect(byGroup('Before racing')).toEqual(['Check-in progress']);
        expect(byGroup('After')).toEqual(['Awards ceremony']);
    });
});

describe('the description line under the select (#948)', () => {
    // "Standings" vs "Standings only" vs "Projector" could otherwise only be
    // told apart by walking to the screen — the thing the panel exists to
    // avoid.
    it('names what the chosen view actually shows', () => {
        renderPanel('PROJECTOR');
        expect(
            screen.getByText(/live heat large on one side, top-five standings/),
        ).toBeInTheDocument();
    });

    it('changes with the view', () => {
        renderPanel('STANDINGS_ONLY');
        expect(
            screen.getByText(/leaderboard alone, filling the whole screen/),
        ).toBeInTheDocument();
    });

    it('reads the racing-group and vehicle words through terminology rather than a literal', () => {
        // The default vocabulary — a race with no terminology override reads
        // "den" and "car", the built-in Scouting words.
        renderPanel('CHECKIN');
        expect(screen.getByText('Who has checked in and who has not, grouped by den.')).toBeInTheDocument();
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

describe('adding a second screen on this computer (#590)', () => {
    // A second monitor on the operator's own computer used to share this
    // computer's single stored id with every other tab; this button hands a
    // freshly opened one an id of its own, baked into the URL, so it never
    // has to contend with a tab already claiming this machine's device id.
    it('opens a fresh screen for this race, with nothing to type', () => {
        renderPanel('STANDINGS');
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        fireEvent.click(screen.getByRole('button', { name: 'Add a second screen on this computer' }));

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

        const button = screen.getByRole('button', { name: 'Add a second screen on this computer' });
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
            screen.getByRole('button', { name: 'Add a second screen on this computer' }),
        ).toBeInTheDocument();
    });

    // #1249: the second-screen button is deliberately quieter than Open Live
    // here — no icon, so it stops reading as a peer.
    it('carries no icon, unlike Open Live here', () => {
        renderPanel('STANDINGS');
        const button = screen.getByRole('button', { name: 'Add a second screen on this computer' });
        expect(button.querySelector('svg')).toBeNull();
    });
});

describe('putting this screen on air (#958, #1249)', () => {
    // Live used to be a race-row destination that replaced the operator's
    // own page; this button is where opening it moved to. It carries no
    // fresh `displayId` the way "Add a second screen on this computer" does
    // — the point is putting *this* computer's own screen on air, not a
    // deliberate second one.
    it('opens Live here, new tab, noopener, no displayId', () => {
        renderPanel('STANDINGS');
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        fireEvent.click(screen.getByRole('button', { name: 'Open Live here' }));

        expect(openSpy).toHaveBeenCalledWith('/race/1/observation', '_blank', 'noopener');
        openSpy.mockRestore();
    });

    it('is offered even before any display has opened', () => {
        renderPanel('STANDINGS', 10, true, 2, false);
        expect(screen.getByRole('button', { name: 'Open Live here' })).toBeInTheDocument();
    });

    // #1249: no button offers the projector URL fallback anymore — Projector
    // is one of the view dropdown's own entries, and the Live page's own
    // "Launch Projector Mode" button is untouched by this change.
    it('offers no button that opens the projector URL fallback', () => {
        renderPanel('STANDINGS');
        const buttons = screen.getAllByRole('button');
        expect(
            buttons.some((button) => /projector/i.test(button.textContent ?? '')),
        ).toBe(false);
    });

    it('is the one primary-btn in the launch area', () => {
        renderPanel('STANDINGS');
        const openLive = screen.getByRole('button', { name: 'Open Live here' });
        expect(openLive.className).toContain('primary-btn');

        const secondScreen = screen.getByRole('button', {
            name: 'Add a second screen on this computer',
        });
        expect(secondScreen.className).not.toContain('primary-btn');

        const allPrimary = screen
            .getAllByRole('button')
            .filter((button) => button.className.includes('primary-btn'));
        expect(allPrimary).toEqual([openLive]);
    });
});

describe('the two headings over the launch area (#1249)', () => {
    // <h2>, not <h3>: DisplaysPage.tsx has no <h2> of its own between its
    // <h1> and this panel, and that's the level SystemSettings.tsx and
    // RaceDetails.tsx already use for a section under a page <h1> — pinned
    // here so a future edit can't quietly drop back a level.
    it('names "This computer" and "Other devices" as real level-2 headings', () => {
        renderPanel('STANDINGS');
        expect(screen.getByRole('heading', { name: 'This computer', level: 2 })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Other devices', level: 2 })).toBeInTheDocument();
    });

    it('shows both headings before any display has opened too', () => {
        renderPanel('STANDINGS', 10, true, 2, false);
        expect(screen.getByRole('heading', { name: 'This computer', level: 2 })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Other devices', level: 2 })).toBeInTheDocument();
    });
});

describe('the two connect blocks under Other devices (#1254, #1293)', () => {
    type CameraFixture = {
        displayId: string;
        role: 'CAMERA';
        trackId: number | null;
        lastClipAt: string | null;
        cameraOrder: number;
        name?: string;
    };

    // A race runs on exactly one track (#1293) — the camera block presets
    // it, with no picker over the install's other tracks. Defaults give
    // every test in this block a real race track unless it deliberately
    // asks for none, so the "no track" case below is the one exception
    // rather than the default every other test has to route around.
    function renderConnectBlocks(options: {
        tracks?: { id: number; name: string }[];
        raceTrackId?: number | null;
        cameras?: CameraFixture[];
        setCameraTrack?: ReturnType<typeof vi.fn>;
    } = {}) {
        const {
            tracks = [{ id: 9, name: 'Main Track' }],
            raceTrackId = 9,
            cameras = [],
            setCameraTrack = vi.fn().mockResolvedValue({ data: {} }),
        } = options;
        type QueryArgs = { query: { definitions: { name?: { value?: string } }[] } };
        (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: QueryArgs) => {
            const name = args.query.definitions.find((d) => d.name?.value)?.name?.value;
            if (name === 'RaceAwardCount') {
                return [
                    { data: { race: { id: 1, awards: [] } }, fetching: false, error: null },
                    vi.fn(),
                ];
            }
            if (name === 'GetTracks') {
                return [{ data: { tracks }, fetching: false, error: null }, vi.fn()];
            }
            if (name === 'RaceTrackForCameraPreset') {
                return [
                    { data: { race: { id: 1, trackId: raceTrackId } }, fetching: false, error: null },
                    vi.fn(),
                ];
            }
            if (name === 'ObservationNetworkAddresses') {
                return [
                    { data: { networkAddresses: [], mdnsHostname: null }, fetching: false, error: null },
                    vi.fn(),
                ];
            }
            // GetDisplays
            return [
                {
                    data: {
                        displays: [
                            {
                                displayId: 'd-1',
                                name: 'Gym north',
                                view: 'STANDINGS',
                                cycleSeconds: 10,
                                scrollBehavior: 'PAGING',
                                showCheckedIn: true,
                                qrTarget: 'STANDINGS',
                                showStandingsTicker: true,
                                description: 'Standings',
                                pacedByAPerson: false,
                                connected: true,
                                role: 'DISPLAY',
                            },
                            ...cameras,
                        ],
                    },
                    fetching: false,
                    error: null,
                },
                vi.fn(),
            ];
        });
        (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation((query: unknown) => {
            if (query === SET_CAMERA_TRACK) return [{ fetching: false }, setCameraTrack];
            return [{ fetching: false }, vi.fn()];
        });
        (vi.mocked(useClient) as ReturnType<typeof vi.fn>).mockReturnValue({ query: vi.fn() });
        return { ...render(<DisplaysPanel raceId={1} />), setCameraTrack };
    }

    it('renders both blocks as a labelled pair', () => {
        renderConnectBlocks();
        expect(screen.getByRole('heading', { name: 'Connect a screen' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Connect a camera' })).toBeInTheDocument();
        expect(
            screen.getByText('For the finish line — scan on the phone that will film it.'),
        ).toBeInTheDocument();
        expect(screen.getByTestId('connect-screen-address')).toBeInTheDocument();
        expect(screen.getByTestId('connect-camera-address')).toBeInTheDocument();
    });

    it('presets the race’s own track, with no picker', () => {
        renderConnectBlocks({
            tracks: [
                { id: 9, name: 'North' },
                { id: 11, name: 'South' },
            ],
            raceTrackId: 11,
        });

        // The install has two tracks; the race runs on exactly one of
        // them, and the code carries that one with nothing to choose.
        expect(screen.queryByTestId('connect-camera-track')).toBeNull();
        const cameraBlock = screen.getByTestId('connect-camera-address');
        expect(within(cameraBlock).getByText(/trackId=11/)).toBeInTheDocument();
    });

    it('a race with no track: the notice, not an address — never the install’s only track either', () => {
        renderConnectBlocks({ raceTrackId: null });

        const notice = screen.getByTestId('connect-camera-no-track');
        expect(
            within(notice).getByText(
                "Pick this race's track in Edit race first, so the camera knows which timer to listen to.",
            ),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('connect-camera-address')).toBeNull();
    });

    it('shows no camera URL while the race track query is still pending', () => {
        // `cameraPresetSettled` is "has RACE_TRACK_QUERY answered" — a
        // default computed before that race's own track query has
        // answered would be a *wrong* preset shown with the same
        // confidence as a right one.
        let raceTrackPending = true;
        type QueryArgs = { query: { definitions: { name?: { value?: string } }[] } };
        const tracks = [{ id: 9, name: 'Main Track' }];
        const implementation = (args: QueryArgs) => {
            const name = args.query.definitions.find((d) => d.name?.value)?.name?.value;
            if (name === 'RaceAwardCount') {
                return [
                    { data: { race: { id: 1, awards: [] } }, fetching: false, error: null },
                    vi.fn(),
                ];
            }
            if (name === 'GetTracks') {
                return [{ data: { tracks }, fetching: false, error: null }, vi.fn()];
            }
            if (name === 'RaceTrackForCameraPreset') {
                return raceTrackPending
                    ? [{ data: undefined, fetching: true, error: null }, vi.fn()]
                    : [{ data: { race: { id: 1, trackId: 9 } }, fetching: false, error: null }, vi.fn()];
            }
            if (name === 'ObservationNetworkAddresses') {
                return [
                    { data: { networkAddresses: [], mdnsHostname: null }, fetching: false, error: null },
                    vi.fn(),
                ];
            }
            // GetDisplays
            return [
                {
                    data: {
                        displays: [
                            {
                                displayId: 'd-1',
                                name: 'Gym north',
                                view: 'STANDINGS',
                                cycleSeconds: 10,
                                scrollBehavior: 'PAGING',
                                showCheckedIn: true,
                                qrTarget: 'STANDINGS',
                                showStandingsTicker: true,
                                description: 'Standings',
                                pacedByAPerson: false,
                                connected: true,
                                role: 'DISPLAY',
                            },
                        ],
                    },
                    fetching: false,
                    error: null,
                },
                vi.fn(),
            ];
        };
        (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation(implementation);
        (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation(() => [
            { fetching: false },
            vi.fn(),
        ]);
        (vi.mocked(useClient) as ReturnType<typeof vi.fn>).mockReturnValue({ query: vi.fn() });

        const { rerender } = render(<DisplaysPanel raceId={1} />);

        expect(screen.queryByTestId('connect-camera-address')).toBeNull();
        expect(screen.queryByTestId('connect-camera-no-track')).toBeNull();
        expect(screen.getByText(/Preparing the camera address/)).toBeInTheDocument();

        raceTrackPending = false;
        rerender(<DisplaysPanel raceId={1} />);

        expect(screen.queryByText(/Preparing the camera address/)).toBeNull();
        const cameraBlock = screen.getByTestId('connect-camera-address');
        expect(within(cameraBlock).getByText(/trackId=9/)).toBeInTheDocument();
    });

    it('mints the camera identity once, and a later render of the same instance keeps the same displayId', () => {
        const { rerender } = renderConnectBlocks();
        const readDisplayId = () =>
            screen
                .getByTestId('connect-camera-address')
                .textContent?.match(/displayId=([^&\s]+)/)?.[1];

        const firstId = readDisplayId();
        expect(firstId).toBeTruthy();

        // Re-render the *same* mounted instance — the ordinary case this
        // panel sees constantly (a subscription tick, another row's
        // rename), not a fresh mount. Passing a new, unrelated prop
        // (`onDisplaysChange`) forces React to actually re-run the
        // component body rather than bail out early on identical props.
        rerender(<DisplaysPanel raceId={1} onDisplaysChange={() => {}} />);

        expect(readDisplayId()).toBe(firstId);
    });

    it('shows the empty-state line while no camera has connected', () => {
        renderConnectBlocks();
        expect(
            screen.getByText('No cameras yet — scan the code above to connect one.'),
        ).toBeInTheDocument();
    });

    it('hides the empty-state line once a camera row exists', () => {
        renderConnectBlocks({
            cameras: [
                { displayId: 'cam-1', role: 'CAMERA', trackId: 9, lastClipAt: null, cameraOrder: 0 },
            ],
        });
        expect(
            screen.queryByText('No cameras yet — scan the code above to connect one.'),
        ).toBeNull();
    });
});

describe('the camera row: a read-only line, and an override for a mismatch (#1293)', () => {
    type CameraFixture = {
        displayId: string;
        role: 'CAMERA';
        trackId: number | null;
        lastClipAt: string | null;
        cameraOrder: number;
        name?: string;
    };

    function renderCameraRow(options: {
        tracks?: { id: number; name: string }[];
        raceTrackId?: number | null;
        camera: CameraFixture;
        setCameraTrack?: ReturnType<typeof vi.fn>;
    }) {
        const {
            tracks = [{ id: 9, name: 'Main Track' }],
            raceTrackId = 9,
            camera,
            setCameraTrack = vi.fn().mockResolvedValue({ data: {} }),
        } = options;
        type QueryArgs = { query: { definitions: { name?: { value?: string } }[] } };
        (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: QueryArgs) => {
            const name = args.query.definitions.find((d) => d.name?.value)?.name?.value;
            if (name === 'RaceAwardCount') {
                return [
                    { data: { race: { id: 1, awards: [] } }, fetching: false, error: null },
                    vi.fn(),
                ];
            }
            if (name === 'GetTracks') {
                return [{ data: { tracks }, fetching: false, error: null }, vi.fn()];
            }
            if (name === 'RaceTrackForCameraPreset') {
                return [
                    { data: { race: { id: 1, trackId: raceTrackId } }, fetching: false, error: null },
                    vi.fn(),
                ];
            }
            if (name === 'ObservationNetworkAddresses') {
                return [
                    { data: { networkAddresses: [], mdnsHostname: null }, fetching: false, error: null },
                    vi.fn(),
                ];
            }
            // GetDisplays — the camera row under test, alone.
            return [
                { data: { displays: [{ name: 'Finish line cam', ...camera }] }, fetching: false, error: null },
                vi.fn(),
            ];
        });
        (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation((query: unknown) => {
            if (query === SET_CAMERA_TRACK) return [{ fetching: false }, setCameraTrack];
            return [{ fetching: false }, vi.fn()];
        });
        (vi.mocked(useClient) as ReturnType<typeof vi.fn>).mockReturnValue({ query: vi.fn() });
        return { ...render(<DisplaysPanel raceId={1} />), setCameraTrack };
    }

    it('shows "Listening to {track}" and no <select>', () => {
        renderCameraRow({
            raceTrackId: 9,
            tracks: [{ id: 9, name: 'Main Track' }],
            camera: { displayId: 'cam-1', role: 'CAMERA', trackId: 9, lastClipAt: null, cameraOrder: 0 },
        });

        expect(screen.getByText(/Listening to Main Track/)).toBeInTheDocument();
        expect(screen.queryByLabelText(/Which track .* listens to/)).toBeNull();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('offers no override when the camera already matches the race’s track', () => {
        renderCameraRow({
            raceTrackId: 9,
            camera: { displayId: 'cam-1', role: 'CAMERA', trackId: 9, lastClipAt: null, cameraOrder: 0 },
        });

        expect(screen.queryByRole('button', { name: "Use this race's track" })).toBeNull();
    });

    it('a camera on a different track: the override button appears and calls setCameraTrack with the race’s track', () => {
        const { setCameraTrack } = renderCameraRow({
            raceTrackId: 9,
            tracks: [
                { id: 9, name: 'Main Track' },
                { id: 11, name: 'Other Track' },
            ],
            camera: { displayId: 'cam-1', role: 'CAMERA', trackId: 11, lastClipAt: null, cameraOrder: 0 },
        });

        const override = screen.getByRole('button', { name: "Use this race's track" });
        fireEvent.click(override);
        expect(setCameraTrack).toHaveBeenCalledWith({ displayId: 'cam-1', trackId: 9 });
    });

    it('a camera with no track yet: the override button appears too', () => {
        renderCameraRow({
            raceTrackId: 9,
            camera: { displayId: 'cam-1', role: 'CAMERA', trackId: null, lastClipAt: null, cameraOrder: 0 },
        });

        expect(screen.getByRole('button', { name: "Use this race's track" })).toBeInTheDocument();
    });
});

describe('reporting whether any display is known for this race (#850)', () => {
    // `ScenesPanel` has no query of its own for this — it would be a second
    // subscription answering the same question this one already does. The
    // Displays tab reads it off this panel instead, so the two can never
    // disagree about whether there is anything for a scene to apply to.
    it('reports true once a display is listed', () => {
        const onDisplaysChange = vi.fn();
        renderPanel('STANDINGS', 10, true, 2, true, 'PAGING', true, 'STANDINGS', true, onDisplaysChange);
        expect(onDisplaysChange).toHaveBeenCalledWith(true);
    });

    it('reports false while the list is empty', () => {
        const onDisplaysChange = vi.fn();
        renderPanel('STANDINGS', 10, true, 2, false, 'PAGING', true, 'STANDINGS', true, onDisplaysChange);
        expect(onDisplaysChange).toHaveBeenCalledWith(false);
    });
});
