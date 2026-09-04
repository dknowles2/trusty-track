// @vitest-environment jsdom
/**
 * The race form's sections (#587): one at a time with a nav while editing,
 * every field on one page while creating — and, because the browser only
 * validates the fields it is rendering, a save that fails on a field in a
 * section that is not up has to say so and go there. The rule itself is
 * `raceSettingsSections.ts`, tested on its own; this is the form's wiring
 * of it.
 */
import '../../../setupTests';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

import { useQuery } from 'urql';
import RaceForm, { RaceFormData } from './RaceForm';

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuery).mockReturnValue([
        { data: { tracks: [{ id: 7, name: 'Main Track' }] }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
});

const open = (id: string) => userEvent.click(screen.getByTestId(`race-settings-nav-${id}`));

const renderEditing = (
    onSubmit: (data: RaceFormData) => Promise<void> = async () => {},
    initialData: Partial<RaceFormData> = { name: 'Pack 42 Derby' },
) =>
    render(
        <RaceForm
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            submitLabel="Save Changes"
            isEditing
            initialData={initialData}
        />,
    );

describe('creating a race', () => {
    it('is one page under three headings, with no nav', () => {
        render(<RaceForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create Race" />);

        expect(screen.queryByTestId('race-settings-nav')).toBeNull();
        // The same words the edit form is navigated by, so the create form
        // teaches the vocabulary.
        expect(screen.getByRole('heading', { name: 'Event' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Scoring' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Check-in' })).toBeInTheDocument();
        // Both of its controls are update-only, so it is absent rather than
        // an empty heading.
        expect(screen.queryByRole('heading', { name: 'Words and names' })).toBeNull();

        // Every field at once — a first-time operator reads top to bottom.
        expect(screen.getByLabelText('Event Name')).toBeInTheDocument();
        expect(screen.getByLabelText(/^Timed \(average\)/)).toBeInTheDocument();
        expect(screen.getByLabelText('Check car weights at inspection')).toBeInTheDocument();
    });
});

describe('editing a race', () => {
    it('opens on Event, with the other sections a click away', async () => {
        renderEditing();

        const nav = screen.getByTestId('race-settings-nav');
        expect(nav).toBeInTheDocument();
        expect(screen.getByTestId('race-settings-nav-event')).toHaveAttribute('aria-current', 'page');

        // Event is up; the lock is the first thing on it (#585).
        expect(screen.getByLabelText('Lock race')).toBeInTheDocument();
        expect(screen.getByLabelText('Event Name')).toHaveValue('Pack 42 Derby');
        expect(screen.getByLabelText('Track / Timer')).toBeInTheDocument();
        expect(screen.getByLabelText(/Interleave heats/)).toBeInTheDocument();
        // The rest is not rendered at all — not merely hidden, which would
        // leave the browser refusing to submit over a field nobody can see.
        expect(screen.queryByLabelText(/^Timed \(average\)/)).toBeNull();
        expect(screen.queryByLabelText('Check car weights at inspection')).toBeNull();
        expect(screen.queryByLabelText('Use different words for this race')).toBeNull();

        await open('scoring');
        expect(screen.getByTestId('race-settings-nav-scoring')).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByLabelText('Event Name')).toBeNull();
        expect(screen.getByLabelText(/^Timed \(average\)/)).toBeInTheDocument();
        expect(screen.getByLabelText('Drop worst run(s)')).toBeInTheDocument();
        expect(screen.getByLabelText(/^Leave it shared/)).toBeInTheDocument();
        expect(screen.getByLabelText('Championship Trophies')).toBeInTheDocument();
        expect(screen.getByLabelText('Exclude Grand Finals winners from qualifying standings')).toBeInTheDocument();
        expect(screen.getByLabelText('At most one trophy per racer')).toBeInTheDocument();

        await open('checkin');
        expect(screen.getByLabelText('Car Numbering')).toBeInTheDocument();
        expect(screen.getByLabelText('Check car weights at inspection')).toBeInTheDocument();

        await open('words');
        expect(screen.getByLabelText('Use different words for this race')).toBeInTheDocument();
        expect(screen.getByLabelText('Override names on public screens for this race')).toBeInTheDocument();
    });

    it('keeps what was typed in a section that is no longer up', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        renderEditing(onSubmit);

        await open('checkin');
        await userEvent.click(screen.getByLabelText('Check car weights at inspection'));
        await open('event');
        await userEvent.clear(screen.getByLabelText('Event Name'));
        await userEvent.type(screen.getByLabelText('Event Name'), 'Renamed Derby');
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.name).toBe('Renamed Derby');
        expect(payload.weight_limit_oz).toBeNull();
    });

    it('keeps the buttons under every section, so Save is always in the same place', async () => {
        renderEditing(async () => {}, { name: 'Pack 42 Derby' });
        for (const id of ['event', 'scoring', 'checkin', 'words']) {
            await open(id);
            expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        }
    });
});

describe('a problem in a section that is not up', () => {
    // The browser validates only what it is rendering. Each of these has a
    // native constraint — `required`, `min`, `max` — that would have fired
    // on a flat form, and does nothing while its section is not on screen.

    it('takes the operator to Event for a blank name, and does not save', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        renderEditing(onSubmit, { name: '   ' });

        await open('scoring');
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('The race needs a name.');
        expect(screen.getByTestId('race-settings-nav-event')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByLabelText('Event Name')).toBeInTheDocument();
    });

    it('takes the operator to Scoring for too many trophies', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        // Seeded rather than typed: the input's `max` would catch a typed 11
        // while Scoring is up, and this is about the case where it is not.
        renderEditing(onSubmit, { name: 'Pack 42 Derby', championship_trophies: 11 });

        // Opens on Event, where the trophy count is nowhere to be seen.
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('between 1 and 10');
        expect(screen.getByLabelText('Championship Trophies')).toHaveValue(11);
    });

    it('takes the operator to Words and names for a blank custom word', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        renderEditing(onSubmit, {
            name: 'Pack 42 Derby',
            racing_group_singular: 'Class',
            racing_group_plural: 'Classes',
            organization_singular: 'School',
            organization_plural: 'Schools',
            vehicle_singular: 'Rocket',
            vehicle_plural: '',
        });

        // Opens on Event, where the blank word is nowhere to be seen.
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Every custom word needs a value');
        expect(screen.getByTestId('race-settings-nav-words')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByLabelText('One vehicle')).toHaveValue('Rocket');
    });

    it('clears the message once a save goes through', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        // Whitespace, not empty: the name input is on screen here, and an
        // empty one is caught by its own `required` before the form's check
        // runs — which is the browser doing its half, not this rule.
        renderEditing(onSubmit, { name: '   ' });

        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(screen.getByRole('alert')).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Event Name'), 'Pack 42 Derby');
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
