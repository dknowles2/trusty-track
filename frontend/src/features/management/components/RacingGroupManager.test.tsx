/**
 * `RacingGroupManager.tsx` had no test file at all (#777). The path worth
 * the most coverage is the newest: #823 made `deleteRacingGroup`'s refusal
 * (a round or an award still scoped to the racing group) reach the client as
 * a real GraphQL error, and `handleDeleteRacingGroup` was rewritten to show
 * that message through `utils/errors.ts`'s `errorText` rather than always
 * showing the same generic sentence. Nothing had exercised either branch —
 * the backend's own message passing through, or the fallback when there is
 * none to show.
 *
 * Every user-facing string here has to go through `useTerminology()`
 * (`.claude/rules/terminology-and-names.md`, enforced by
 * `terminologyGuard.test.ts`'s static scan) — a custom `TerminologyProvider`
 * value is used below to prove the words are actually read from context at
 * render time, not merely present in the source as the literal word "Den".
 */

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Provider } from 'urql';
import { fromValue, never } from 'wonka';
import RacingGroupManager from './RacingGroupManager';
import { AlertProvider } from '../../../context/AlertContext';
import { TerminologyProvider, type Terminology } from '../../../context/TerminologyContext';

afterEach(() => {
    cleanup();
});

const RACING_GROUPS = [
    {
        id: 1,
        name: 'Lions',
        color: '#F4D03F',
        division: 'Lion',
        carNumberRangeStart: 100,
        carNumberRangeEnd: 199,
    },
];

const CUSTOM_TERMINOLOGY: Terminology = {
    racingGroupSingular: 'Squad',
    racingGroupPlural: 'Squads',
    organizationSingular: 'Pack',
    organizationPlural: 'Packs',
    vehicleSingular: 'Car',
    vehiclePlural: 'Cars',
    vehicleArtworkKey: 'car',
};

interface MutationBehavior {
    /** What `createRacingGroupMutation`/`updateRacingGroupMutation`/
     * `deleteRacingGroupMutation` resolve with, keyed by which one fired —
     * distinguished by shape, since a mock client sees only the printed
     * operation and its variables. */
    onDelete?: { data?: unknown; error?: unknown };
}

function renderManager(
    { terminology, onUpdate = vi.fn(), behavior = {} }: {
        terminology?: Terminology;
        onUpdate?: () => void;
        behavior?: MutationBehavior;
    } = {},
) {
    const executeMutation = vi.fn((op: { variables?: Record<string, unknown> }) => {
        const variables = op.variables ?? {};
        if ('racingGroup' in variables && 'raceId' in variables) {
            // createRacingGroup
            return fromValue({
                data: { createRacingGroup: { id: 2, name: variables.racingGroup && (variables.racingGroup as { name: string }).name } },
                stale: false,
                hasNext: false,
            });
        }
        if ('racingGroup' in variables && 'id' in variables) {
            // updateRacingGroup
            return fromValue({
                data: { updateRacingGroup: { id: variables.id, name: 'updated' } },
                stale: false,
                hasNext: false,
            });
        }
        // deleteRacingGroup — only `id`, no `racingGroup` key.
        if (behavior.onDelete?.error) {
            return fromValue({ data: null, error: behavior.onDelete.error, stale: false, hasNext: false });
        }
        return fromValue({ data: { deleteRacingGroup: true }, stale: false, hasNext: false });
    });

    const client = {
        executeQuery: () =>
            fromValue({
                data: { race: { racingGroups: RACING_GROUPS } },
                stale: false,
                hasNext: false,
            }),
        executeMutation,
        executeSubscription: () => never,
    } as unknown as Parameters<typeof Provider>[0]['value'];

    const tree = (
        <Provider value={client}>
            <AlertProvider>
                <TerminologyProvider value={terminology}>
                    <RacingGroupManager raceId={1} onUpdate={onUpdate} />
                </TerminologyProvider>
            </AlertProvider>
        </Provider>
    );

    render(tree);
    return { executeMutation, onUpdate };
}

describe('RacingGroupManager', () => {
    it('renders the racing groups the query returns', () => {
        renderManager();
        expect(screen.getByText('Lions')).toBeInTheDocument();
        expect(screen.getByText('#100-199')).toBeInTheDocument();
    });

    it('creates a racing group with the form values and refreshes on success', async () => {
        const { executeMutation, onUpdate } = renderManager();

        fireEvent.click(screen.getByText('Add New Den'));
        // Neither text input in the add form has an `htmlFor`/`id` pairing
        // with its label, so `getByLabelText` cannot find it — Name is the
        // first text input in document order, ahead of the free-text
        // Category field.
        fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Tigers' } });
        fireEvent.click(screen.getByText('Add Den'));

        await waitFor(() => expect(onUpdate).toHaveBeenCalled());

        const createCall = executeMutation.mock.calls.find(
            ([op]) => op.variables?.racingGroup && op.variables?.raceId,
        );
        expect(createCall).toBeTruthy();
        const variables = createCall![0].variables as {
            raceId: number;
            racingGroup: { name: string };
        };
        expect(variables.raceId).toBe(1);
        expect(variables.racingGroup.name).toBe('Tigers');

        // The form closes and resets on success — back to the list view,
        // which holds no text inputs at all.
        expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    });

    it('asks for confirmation before deleting, and calls nothing if cancelled', async () => {
        const { executeMutation } = renderManager();

        fireEvent.click(screen.getByTitle('Delete Den'));
        expect(await screen.findByRole('heading', { name: 'Delete Den' })).toBeInTheDocument();
        // The dialog names the racing group's own word, mid-sentence.
        expect(screen.getByText(/racers in this den will be unassigned/i)).toBeInTheDocument();

        fireEvent.click(screen.getByText('Cancel'));

        await waitFor(() => {
            expect(
                executeMutation.mock.calls.some(([op]) => {
                    const vars = op.variables ?? {};
                    return 'id' in vars && !('racingGroup' in vars);
                }),
            ).toBe(false);
        });
    });

    it('deletes on confirmation and refreshes when the backend allows it', async () => {
        const { executeMutation, onUpdate } = renderManager();

        fireEvent.click(screen.getByTitle('Delete Den'));
        fireEvent.click(await screen.findByText('Confirm'));

        await waitFor(() => expect(onUpdate).toHaveBeenCalled());
        const deleteCall = executeMutation.mock.calls.find(([op]) => {
            const vars = op.variables ?? {};
            return 'id' in vars && !('racingGroup' in vars);
        });
        expect(deleteCall).toBeTruthy();
        const variables = deleteCall![0].variables as { id: number };
        expect(variables.id).toBe(1);
    });

    // #823/#837: the mutation now lets the backend's own `ValueError` reach
    // the client as a GraphQL error naming exactly which round or award is
    // blocking the delete, and `handleDeleteRacingGroup` shows *that*
    // message via `errorText` rather than always showing the same generic
    // sentence. This is the newest and least-exercised path.
    it("shows the backend's own refusal message when a round or award blocks the delete", async () => {
        renderManager({
            behavior: {
                onDelete: {
                    error: {
                        graphQLErrors: [
                            { message: "Cannot delete racing group: round 'Finals' is scoped to it." },
                        ],
                    },
                },
            },
        });

        fireEvent.click(screen.getByTitle('Delete Den'));
        fireEvent.click(await screen.findByText('Confirm'));

        expect(
            await screen.findByText("Cannot delete racing group: round 'Finals' is scoped to it."),
        ).toBeInTheDocument();
        // The generic fallback must not also be shown — the specific reason
        // replaces it, rather than the two stacking.
        expect(
            screen.queryByText(/can't be deleted while a round or an award is scoped to it/i),
        ).not.toBeInTheDocument();
    });

    it('falls back to a generic explanation when the refusal carries no backend message', async () => {
        renderManager({
            behavior: {
                onDelete: { error: { graphQLErrors: [] } },
            },
        });

        fireEvent.click(screen.getByTitle('Delete Den'));
        fireEvent.click(await screen.findByText('Confirm'));

        expect(
            await screen.findByText(
                "This den can't be deleted while a round or an award is scoped to it. Remove or reassign that first.",
            ),
        ).toBeInTheDocument();
    });

    it("reads the racing group's own word from the configured terminology, not the literal 'Den'", async () => {
        renderManager({ terminology: CUSTOM_TERMINOLOGY });

        expect(screen.getByText('Add New Squad')).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Delete Squad'));
        expect(
            await screen.findByText(/racers in this squad will be unassigned/i),
        ).toBeInTheDocument();
        expect(screen.queryByText(/racers in this den will be unassigned/i)).not.toBeInTheDocument();
    });

    // #928 part 1: the Category picker's suggestions are derived from the
    // race's own resolved words, matched against `ORGANIZATION_KINDS`
    // (`context/organizationKinds.ts`'s `categoryPresetsFor`) — not a fixed
    // Cub Scout list offered to everybody, and not stored anywhere.
    describe('the Category picker (#928)', () => {
        it('offers the Cub Scout ranks for the built-in Pack/Den words, under the corrected label', () => {
            renderManager();
            fireEvent.click(screen.getByText('Add New Den'));

            expect(screen.getByText('Choose a category, or type your own')).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'Lion' })).toBeInTheDocument();
        });

        it('offers no suggestions for a vocabulary that matches no organization kind', () => {
            renderManager({ terminology: CUSTOM_TERMINOLOGY });
            fireEvent.click(screen.getByText('Add New Squad'));

            // The label is still corrected even though the list is empty.
            expect(screen.getByText('Choose a category, or type your own')).toBeInTheDocument();
            expect(screen.queryByRole('option', { name: 'Lion' })).not.toBeInTheDocument();
        });

        it('offers the Awana age groups for a Club/Group vocabulary', () => {
            renderManager({
                terminology: {
                    ...CUSTOM_TERMINOLOGY,
                    organizationSingular: 'Club',
                    organizationPlural: 'Clubs',
                    racingGroupSingular: 'Group',
                    racingGroupPlural: 'Groups',
                },
            });
            fireEvent.click(screen.getByText('Add New Group'));

            expect(screen.getByRole('option', { name: 'Cubbies' })).toBeInTheDocument();
            expect(screen.queryByRole('option', { name: 'Lion' })).not.toBeInTheDocument();
        });
    });
});
