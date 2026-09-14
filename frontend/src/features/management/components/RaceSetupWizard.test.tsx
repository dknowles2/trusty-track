// @vitest-environment jsdom
/**
 * The race setup wizard (#662). The rules — which steps, what the answers
 * add up to, what a copied race prefills — are `raceSetup.ts`, tested on
 * their own; this is the wiring: the steps in order, the groups list being
 * editable, and the last step's submission carrying everything the earlier
 * ones decided.
 */
import '../../../setupTests';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

import { useQuery } from 'urql';
import RaceSetupWizard from './RaceSetupWizard';
import { DEFAULT_TERMINOLOGY } from '../../../context/TerminologyContext';
import type { RaceSetupData } from '../raceInput';

const lastYear = {
    id: 4,
    location: 'Church Gym',
    scoringStrategy: 'POINTS',
    tiebreaker: 'SHARED',
    dropWorstRuns: 0,
    carNumberingStrategy: 'PER_GROUP',
    globalStartNumber: 1,
    championshipTrophies: 4,
    weightLimitOz: 5,
    racingGroupSingular: null,
    racingGroupPlural: null,
    organizationSingular: null,
    organizationPlural: null,
    vehicleSingular: 'Rocket',
    vehiclePlural: 'Rockets',
    vehicleArtworkKey: 'rocket',
    racingGroups: [
        { id: 1, name: 'Wolves', color: '#aab7b8', division: 'Wolf', carNumberRangeStart: 100, carNumberRangeEnd: 199 },
        { id: 2, name: 'Bears', color: '#85c1e9', division: null, carNumberRangeStart: 200, carNumberRangeEnd: 299 },
    ],
    awards: [] as Array<{
        id: number;
        name: string;
        kind: string;
        source: string | null;
        place: number | null;
        fromBottom: boolean;
        racingGroupId: number | null;
        artworkKey: string | null;
        sortOrder: number;
        votable: boolean;
    }>,
    roundPlan: null as {
        generalRound: {
            type: string;
            schedulingStrategy: string;
            runsPerLane: number;
            eliminationLosses: number | null;
            balancedPhases: number | null;
        };
        championshipRounds: Array<{
            name: string;
            source: string;
            numTopRacers: number;
            runsPerLane: number;
            advancementFromBottom: boolean;
            sourceRoundId: number;
        }>;
    } | null,
};

/** A round plan as `GET_RACE_SETUP_SOURCE` would return it (#1088): one GENERAL
 * qualifying round (2 runs per lane) and one `ALL` top-3 final whose id is
 * 9 — the same id a `ROUND:9` award names below. */
const roundPlanFixture = {
    generalRound: {
        type: 'ALL',
        schedulingStrategy: 'GENERAL',
        runsPerLane: 2,
        eliminationLosses: null,
        balancedPhases: null,
    },
    championshipRounds: [
        {
            name: 'Finals',
            source: 'ALL',
            numTopRacers: 3,
            runsPerLane: 1,
            advancementFromBottom: false,
            sourceRoundId: 9,
        },
    ],
};

/** Answers each of the three queries the wizard (and the form inside it)
 * sends by its operation name, the same way urql keys them. */
function mockQueries({
    races = [] as Array<{ id: number; name: string }>,
    installDefault = DEFAULT_TERMINOLOGY,
    sourceAwards = lastYear.awards,
    sourceRoundPlan = lastYear.roundPlan,
} = {}) {
    const source = { ...lastYear, awards: sourceAwards, roundPlan: sourceRoundPlan };
    vi.mocked(useQuery).mockImplementation(((args: { query: { definitions: Array<{ name?: { value: string } }> }; pause?: boolean }) => {
        const name = args.query.definitions[0]?.name?.value;
        if (name === 'GetRaceSetupContext') {
            return [{ data: { races, initialConfig: { terminology: installDefault } }, fetching: false, stale: false }, vi.fn()];
        }
        if (name === 'GetRaceSetupSource') {
            return [
                args.pause ? { data: undefined, fetching: false, stale: false } : { data: { race: source }, fetching: false, stale: false },
                vi.fn(),
            ];
        }
        return [{ data: { tracks: [{ id: 7, name: 'Main Track' }] }, fetching: false, stale: false }, vi.fn()];
    }) as never);
}

beforeEach(() => {
    vi.clearAllMocks();
});

const renderWizard = () => {
    const onSubmit = vi.fn<(data: RaceSetupData) => Promise<void>>(async () => {});
    const onCancel = vi.fn();
    render(<RaceSetupWizard onSubmit={onSubmit} onCancel={onCancel} />);
    return { onSubmit, onCancel };
};

const next = () => userEvent.click(screen.getByTestId('setup-next'));

describe('with no previous races', () => {
    it('opens on the questions, not on a scratch-or-copy choice nobody can make', () => {
        mockQueries();
        renderWizard();

        expect(screen.queryByTestId('setup-step-start')).toBeNull();
        expect(screen.getByTestId('setup-step-kind')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^Pinewood Derby/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /^Cub Scouts/ })).toBeChecked();
        expect(screen.getByTestId('setup-words-summary')).toHaveTextContent('Pack, Den and Car');
    });

    it('scaffolds the six dens, then the form, and submits them all together with no override', async () => {
        mockQueries();
        const { onSubmit } = renderWizard();

        await next();
        expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
        expect(screen.getByLabelText('Den 1 name')).toHaveValue('Lion');
        expect(screen.getByLabelText('Den 6 name')).toHaveValue('Arrow of Light');
        expect(screen.getByLabelText('Den 2 start number')).toHaveValue(200);

        await next();
        expect(screen.getByLabelText('Event Name')).toBeInTheDocument();
        // The form is the flat create form (#587), under its three headings.
        expect(screen.getByRole('heading', { name: 'Scoring' })).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Event Name'), '2027 Pinewood Derby');
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const data = onSubmit.mock.calls[0][0];
        expect(data.name).toBe('2027 Pinewood Derby');
        expect(data.racing_groups.map((g) => g.name)).toEqual(['Lion', 'Tiger', 'Wolf', 'Bear', 'Webelos', 'Arrow of Light']);
        // The built-in words on a default install: the race inherits.
        expect(data.vehicle_singular).toBeNull();
        expect(data.racing_group_singular).toBeNull();
        // The scaffolded dens each got a block of numbers of their own
        // (#811) — a race created here should actually use them, rather
        // than defaulting to Global and leaving the ranges unused.
        expect(data.car_numbering_strategy).toBe('PER_GROUP');
    });

    it('with no groups configured, numbering stays Global — the ordinary default', async () => {
        mockQueries();
        const { onSubmit } = renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Something else/ }));
        await next();
        expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
        await next();
        expect(screen.getByLabelText('Event Name')).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Event Name'), 'No Groups Race');
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0].car_numbering_strategy).toBe('GLOBAL');
    });

    it('a Space Derby carries the rocket words as an override', async () => {
        mockQueries();
        const { onSubmit } = renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Space Derby/ }));
        expect(screen.getByTestId('setup-words-summary')).toHaveTextContent('Rocket');
        await next();
        await next();
        await userEvent.type(screen.getByLabelText('Event Name'), 'Space Derby');
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        const data = onSubmit.mock.calls[0][0];
        expect(data.vehicle_singular).toBe('Rocket');
        expect(data.vehicle_artwork_key).toBe('rocket');
        expect(data.organization_singular).toBe('Pack');
    });

    it('a district derby calls its groups ranks, and the groups step says so', async () => {
        mockQueries();
        renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^A district or council derby/ }));
        await next();
        expect(screen.getByLabelText('Rank 1 name')).toHaveValue('Lion');
        expect(screen.getByRole('button', { name: 'Add rank' })).toBeInTheDocument();
    });

    it('a school starts with no groups; an added one needs a name before moving on', async () => {
        mockQueries();
        renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^A school/ }));
        // Cub Scouts' scale question is not asked of a school.
        expect(screen.queryByRole('radio', { name: /^One pack’s own derby/ })).toBeNull();
        await next();
        expect(screen.queryByLabelText('Grade 1 name')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Add grade' }));
        expect(screen.getByLabelText('Grade 1 name')).toHaveValue('');
        expect(screen.getByLabelText('Grade 1 start number')).toHaveValue(100);

        await next();
        expect(screen.getByTestId('setup-problem')).toHaveTextContent('Every grade needs a name.');
        expect(screen.queryByLabelText('Event Name')).toBeNull();

        await userEvent.type(screen.getByLabelText('Grade 1 name'), '3rd Grade');
        await next();
        expect(screen.getByLabelText('Event Name')).toBeInTheDocument();
    });

    it('removing a group drops it from what is submitted', async () => {
        mockQueries();
        const { onSubmit } = renderWizard();

        await next();
        await userEvent.click(screen.getByTestId('setup-remove-group-0'));
        expect(screen.getByLabelText('Den 1 name')).toHaveValue('Tiger');
        await next();
        await userEvent.type(screen.getByLabelText('Event Name'), 'No Lions');
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        expect(onSubmit.mock.calls[0][0].racing_groups.map((g) => g.name)).not.toContain('Lion');
    });

    it('Back from the form returns to the groups without losing the name typed', async () => {
        mockQueries();
        renderWizard();

        await next();
        await next();
        await userEvent.type(screen.getByLabelText('Event Name'), 'Keep me');
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
        expect(screen.getByLabelText('Den 1 name')).toBeInTheDocument();

        await next();
        expect(screen.getByLabelText('Event Name')).toHaveValue('Keep me');
    });

    it('Cancel on the first step is the caller\'s cancel', async () => {
        mockQueries();
        const { onCancel } = renderWizard();

        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalled();
    });

    describe('step pills (#1087)', () => {
        it('clicking a visited pill jumps back to that step, keeping the groups list', async () => {
            mockQueries();
            renderWizard();

            await next();
            expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
            await next();
            expect(screen.getByLabelText('Event Name')).toBeInTheDocument();

            await userEvent.click(screen.getByRole('button', { name: '1. Kind of event' }));
            expect(screen.getByTestId('setup-step-kind')).toBeInTheDocument();

            await next();
            expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
            expect(screen.getByLabelText('Den 1 name')).toHaveValue('Lion');
        });

        it('the current step and a future step have no button, and clicking them does nothing', async () => {
            mockQueries();
            renderWizard();

            await next();
            expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();

            expect(screen.queryByRole('button', { name: '2. Dens' })).toBeNull();
            expect(screen.queryByRole('button', { name: '3. Details' })).toBeNull();
            expect(screen.getByText('2. Dens')).not.toHaveAttribute('aria-disabled');
            expect(screen.getByText('3. Details')).toHaveAttribute('aria-disabled', 'true');

            await userEvent.click(screen.getByText('2. Dens'));
            expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
            await userEvent.click(screen.getByText('3. Details'));
            expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
        });

        it('after jumping back to kind and changing the organization, Next regenerates the groups', async () => {
            mockQueries();
            renderWizard();

            await next();
            expect(screen.getByLabelText('Den 1 name')).toHaveValue('Lion');
            await next();

            await userEvent.click(screen.getByRole('button', { name: '1. Kind of event' }));
            await userEvent.click(screen.getByRole('radio', { name: /^A district or council derby/ }));
            await next();
            expect(screen.getByLabelText('Rank 1 name')).toBeInTheDocument();
        });

        it('jumping back without changing the answer keeps an edited group name', async () => {
            mockQueries();
            renderWizard();

            await next();
            await userEvent.clear(screen.getByLabelText('Den 1 name'));
            await userEvent.type(screen.getByLabelText('Den 1 name'), 'Custom Lions');
            await next();

            await userEvent.click(screen.getByRole('button', { name: '1. Kind of event' }));
            await next();
            expect(screen.getByLabelText('Den 1 name')).toHaveValue('Custom Lions');
        });
    });
});

describe('with a previous race', () => {
    it('opens on the scratch-or-copy choice, and scratch goes on to the questions', async () => {
        mockQueries({ races: [{ id: 4, name: 'Last Year' }] });
        renderWizard();

        expect(screen.getByTestId('setup-step-start')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^Start from scratch/ })).toBeChecked();
        await next();
        expect(screen.getByTestId('setup-step-kind')).toBeInTheDocument();
    });

    it('lists previous races in the order the query returns them, newest first (#1129)', async () => {
        // `Query.races` is itself ordered newest-first now (#1129); this
        // dropdown used to reverse whatever order it got, which was a fix
        // for the *old*, oldest-first server order and inverts the new one
        // if left in place. Three distinctly-named races confirm the
        // `<select>` renders in query order rather than un-reversing it.
        mockQueries({
            races: [
                { id: 6, name: 'Newest Race' },
                { id: 5, name: 'Middle Race' },
                { id: 4, name: 'Last Year' },
            ],
        });
        renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        const options = within(screen.getByLabelText('Previous race')).getAllByRole('option');
        // The first option is the placeholder; the rest must match query order.
        expect(options.slice(1).map((o) => o.textContent)).toEqual([
            'Newest Race',
            'Middle Race',
            'Last Year',
        ]);
    });

    it('copying brings the groups and the settings over, skips the questions, and submits them', async () => {
        mockQueries({ races: [{ id: 4, name: 'Last Year' }] });
        const { onSubmit } = renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        // Nothing to copy from yet, so nowhere to go.
        expect(screen.getByTestId('setup-next')).toBeDisabled();
        await userEvent.selectOptions(screen.getByLabelText('Previous race'), '4');
        expect(screen.getByTestId('setup-source-summary')).toHaveTextContent('2 dens to copy: Wolves, Bears.');

        await next();
        // Straight to the groups — the previous race answered the questions.
        expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
        expect(screen.getByLabelText('Den 1 name')).toHaveValue('Wolves');
        expect(screen.getByLabelText('Den 1 category')).toHaveValue('Wolf');
        expect(screen.getByLabelText('Den 2 end number')).toHaveValue(299);

        await next();
        // The form opens on last year's settings and venue…
        expect(screen.getByLabelText(/^Points/)).toBeChecked();
        expect(screen.getByLabelText('Location')).toHaveValue('Church Gym');
        // …but not its name.
        expect(screen.getByLabelText('Event Name')).toHaveValue('');

        await userEvent.type(screen.getByLabelText('Event Name'), 'This Year');
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        const data = onSubmit.mock.calls[0][0];
        expect(data.racing_groups.map((g) => g.name)).toEqual(['Wolves', 'Bears']);
        expect(data.scoring_strategy).toBe('POINTS');
        expect(data.championship_trophies).toBe(4);
        // Last year's words, copied raw: the rocket override stays, the
        // inherited group word stays inherited.
        expect(data.vehicle_singular).toBe('Rocket');
        expect(data.racing_group_singular).toBeNull();
        // Nothing to copy this year — no awards were on the source race.
        expect(data.awards).toEqual([]);
    });

    it('previews which awards will and will not copy, and submits only the copyable ones (#722)', async () => {
        mockQueries({
            races: [{ id: 4, name: 'Last Year' }],
            sourceAwards: [
                { id: 1, name: 'Fastest Overall', kind: 'SPEED', source: 'ALL', place: 1, fromBottom: false, racingGroupId: null, artworkKey: 'trophy', sortOrder: 0, votable: false },
                { id: 2, name: 'Best Paint', kind: 'SPECIAL', source: null, place: null, fromBottom: false, racingGroupId: null, artworkKey: null, sortOrder: 1, votable: true },
                { id: 3, name: 'Fastest Wolf', kind: 'SPEED', source: 'ALL', place: 1, fromBottom: false, racingGroupId: 1, artworkKey: 'trophy', sortOrder: 2, votable: false },
                { id: 4, name: 'Finals Champion', kind: 'SPEED', source: 'ROUND:9', place: 1, fromBottom: false, racingGroupId: null, artworkKey: 'trophy', sortOrder: 3, votable: false },
            ],
        });
        const { onSubmit } = renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        await userEvent.selectOptions(screen.getByLabelText('Previous race'), '4');
        expect(screen.getByTestId('setup-source-awards-summary')).toHaveTextContent('4 awards to copy');

        await next();
        // The preview names exactly what will and will not survive, before
        // the race is ever created — "Fastest Wolf" follows the Wolves den,
        // which was carried over unchanged, and "Finals Champion" cannot,
        // since this race has no rounds yet.
        expect(screen.getByTestId('setup-awards-copy-summary')).toHaveTextContent('Fastest Overall');
        expect(screen.getByTestId('setup-awards-copy-summary')).toHaveTextContent('Best Paint');
        expect(screen.getByTestId('setup-awards-copy-summary')).toHaveTextContent('Fastest Wolf');
        expect(screen.getByTestId('setup-awards-excluded')).toHaveTextContent('Finals Champion');

        await next();
        await userEvent.type(screen.getByLabelText('Event Name'), 'This Year');
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        const data = onSubmit.mock.calls[0][0];
        expect(data.awards?.map((a) => a.name)).toEqual(['Fastest Overall', 'Best Paint', 'Fastest Wolf']);
        // Still the old race's group id — the server remaps it using the
        // copied group's own `copied_from_id`.
        expect(data.awards?.find((a) => a.name === 'Fastest Wolf')?.racing_group_id).toBe(1);
        // No recipient rode along for the copied judged award (#170).
        expect(data.awards?.find((a) => a.name === 'Best Paint')).not.toHaveProperty('racer_id');
    });

    it('excludes a group-scoped award once its group is removed on the groups step', async () => {
        mockQueries({
            races: [{ id: 4, name: 'Last Year' }],
            sourceAwards: [
                { id: 3, name: 'Fastest Wolf', kind: 'SPEED', source: 'ALL', place: 1, fromBottom: false, racingGroupId: 1, artworkKey: 'trophy', sortOrder: 0, votable: false },
            ],
        });
        renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        await userEvent.selectOptions(screen.getByLabelText('Previous race'), '4');
        await next();
        expect(screen.getByTestId('setup-awards-copy-summary')).toHaveTextContent('Fastest Wolf');

        await userEvent.click(screen.getByTestId('setup-remove-group-0'));
        expect(screen.getByTestId('setup-awards-excluded')).toHaveTextContent('Fastest Wolf');
        expect(screen.queryByTestId('setup-awards-copy-summary')).toBeNull();
    });

    it('the step list names the groups by the copied race\'s own word', async () => {
        mockQueries({ races: [{ id: 4, name: 'Last Year' }] });
        renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        await userEvent.selectOptions(screen.getByLabelText('Previous race'), '4');
        const steps = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');
        expect(steps.map((s) => s.textContent)).toEqual(['1. Start', '2. Dens', '3. Details']);
    });

    it('in copy mode the pills are the three-step list, and a jump to start survives a mode switch (#1087)', async () => {
        mockQueries({ races: [{ id: 4, name: 'Last Year' }] });
        renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        await userEvent.selectOptions(screen.getByLabelText('Previous race'), '4');
        await next();
        expect(screen.getByTestId('setup-step-groups')).toBeInTheDocument();
        await next();
        expect(screen.getByLabelText('Event Name')).toBeInTheDocument();

        const steps = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');
        expect(steps).toHaveLength(3);

        await userEvent.click(screen.getByRole('button', { name: '1. Start' }));
        expect(screen.getByTestId('setup-step-start')).toBeInTheDocument();

        // The mode radios only render on the start step, so a switch always
        // happens with the index already at 0 — `steps[Math.min(stepIndex,
        // steps.length - 1)]` clamps regardless, but this pins that the
        // switch (three steps to four, and back) never leaves the wizard on
        // a step that no longer exists.
        await userEvent.click(screen.getByRole('radio', { name: /^Start from scratch/ }));
        expect(screen.getByTestId('setup-step-start')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        expect(screen.getByTestId('setup-step-start')).toBeInTheDocument();
    });
});

describe('copying the round plan (#1088)', () => {
    it('the Details step shows the round summary and re-points a copied ROUND: award', async () => {
        mockQueries({
            races: [{ id: 4, name: 'Last Year' }],
            sourceRoundPlan: roundPlanFixture,
            sourceAwards: [
                {
                    id: 4,
                    name: 'Pack Champion',
                    kind: 'SPEED',
                    source: 'ROUND:9',
                    place: 1,
                    fromBottom: false,
                    racingGroupId: null,
                    artworkKey: 'trophy',
                    sortOrder: 0,
                    votable: false,
                },
            ],
        });
        const { onSubmit } = renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        await userEvent.selectOptions(screen.getByLabelText('Previous race'), '4');
        await next();
        // A round-scoped award now copies, since the plan reproduces it.
        expect(screen.getByTestId('setup-awards-copy-summary')).toHaveTextContent('Pack Champion');

        await next();
        expect(screen.getByTestId('setup-round-plan-summary')).toHaveTextContent(
            'Rounds: 1 qualifying (General, 2 runs per lane) → Finals (top 3) — from *Last Year*',
        );
        const checkbox = screen.getByRole('checkbox', { name: 'Copy the rounds too' });
        expect(checkbox).toBeChecked();

        await userEvent.type(screen.getByLabelText('Event Name'), 'This Year');
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        const data = onSubmit.mock.calls[0][0];
        expect(data.round_plan).toEqual(roundPlanFixture);
        expect(data.awards?.[0]).toMatchObject({ name: 'Pack Champion', source: 'ROUND:9', copied_from_round_id: 9 });
    });

    it('unticking "Copy the rounds too" sends no plan and drops the round-scoped award', async () => {
        mockQueries({
            races: [{ id: 4, name: 'Last Year' }],
            sourceRoundPlan: roundPlanFixture,
            sourceAwards: [
                {
                    id: 4,
                    name: 'Pack Champion',
                    kind: 'SPEED',
                    source: 'ROUND:9',
                    place: 1,
                    fromBottom: false,
                    racingGroupId: null,
                    artworkKey: 'trophy',
                    sortOrder: 0,
                    votable: false,
                },
            ],
        });
        const { onSubmit } = renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        await userEvent.selectOptions(screen.getByLabelText('Previous race'), '4');
        await next();
        await next();

        await userEvent.click(screen.getByRole('checkbox', { name: 'Copy the rounds too' }));
        expect(screen.getByTestId('setup-round-plan-summary')).toHaveTextContent('Not copying the rounds');

        // Going back to the groups/awards step reflects the same choice —
        // the award is now excluded, not copied.
        await userEvent.click(screen.getByRole('button', { name: '2. Dens' }));
        expect(screen.getByTestId('setup-awards-excluded')).toHaveTextContent('Pack Champion');

        await next();
        await userEvent.type(screen.getByLabelText('Event Name'), 'This Year');
        await userEvent.click(screen.getByRole('button', { name: 'Create Race' }));

        const data = onSubmit.mock.calls[0][0];
        expect(data.round_plan ?? null).toBeNull();
        expect(data.awards).toEqual([]);
    });

    it('no round plan on the source race: no round-plan section at all', async () => {
        mockQueries({ races: [{ id: 4, name: 'Last Year' }] });
        renderWizard();

        await userEvent.click(screen.getByRole('radio', { name: /^Copy settings from a previous race/ }));
        await userEvent.selectOptions(screen.getByLabelText('Previous race'), '4');
        await next();
        await next();

        expect(screen.queryByTestId('setup-round-plan')).toBeNull();
    });
});
