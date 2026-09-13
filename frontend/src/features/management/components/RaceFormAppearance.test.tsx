// @vitest-environment jsdom
/**
 * The per-race Display/Printables theme override (#1081). Storage and
 * resolution are backend-tested (`test_race_theme_override.py`,
 * `test_domain_theme.py`); this is only the form's own behaviour — visible
 * while editing, hidden while creating, and which sentinel ("Use the
 * install's setting" vs. "Field Uniform (default)") sends which value.
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

// The override lives in the Appearance section, a click away while editing
// (#587) — the form opens on Event.
const openAppearance = () => userEvent.click(screen.getByTestId('race-settings-nav-appearance'));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuery).mockReturnValue([
        { data: { tracks: [{ id: 7, name: 'Main Track' }] }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
});

describe('creating a race', () => {
    it('offers no Appearance section at all', () => {
        render(<RaceForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create Race" />);

        expect(screen.queryByText('Display theme')).toBeNull();
        expect(screen.queryByText('Printables theme')).toBeNull();
    });
});

describe('editing a race with no override', () => {
    it('shows both pickers with "Use the install\'s setting" pressed', async () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', display_theme: null, printables_theme: null }}
            />,
        );
        await openAppearance();

        expect(screen.getByTestId('race-display-theme-option-INHERIT')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByTestId('race-printables-theme-option-INHERIT')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByTestId('race-display-theme-option-MATCH_APP')).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('picking a theme submits it, and the install sentinel is no longer pressed', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', display_theme: null, printables_theme: null }}
            />,
        );
        await openAppearance();

        await userEvent.click(screen.getByTestId('race-display-theme-option-under-the-lights'));
        expect(screen.getByTestId('race-display-theme-option-INHERIT')).toHaveAttribute(
            'aria-pressed',
            'false',
        );

        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.display_theme).toBe('under-the-lights');
        // Printables was never touched, so it stays exactly what
        // `RaceDetails.tsx` seeded it with — `null`, not absent. Unlike the
        // terminology/name-display overrides, `RaceDetails` always maps
        // both theme fields to `null`-or-string (never leaves them
        // `undefined`, see its own `display_theme`/`printables_theme`
        // mapping), so `RaceDetails.handleUpdateRace` sends
        // `clearPrintablesTheme: true` on *every* save of a race with no
        // override, whether or not Appearance was touched. That is not a
        // bug this test can catch: it is the backend's job
        // (`updateRace` comparing the race's stored value before and after,
        // not the presence of a clear flag) to tell a harmless resend apart
        // from a real change — see `test_display_subscription.py`'s
        // `test_a_full_resend_with_no_theme_change_does_not_nudge_a_connected_display`.
        expect(payload.printables_theme).toBeNull();
    });

    it('picking "Field Uniform (default)" sends the real MATCH_APP value, not null', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', display_theme: null, printables_theme: null }}
            />,
        );
        await openAppearance();

        await userEvent.click(screen.getByTestId('race-printables-theme-option-MATCH_APP'));
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.printables_theme).toBe('MATCH_APP');
    });
});

describe('editing a race with an override already set', () => {
    it('shows the stored theme pressed, not the install sentinel', async () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', display_theme: 'newsprint', printables_theme: null }}
            />,
        );
        await openAppearance();

        expect(screen.getByTestId('race-display-theme-option-newsprint')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByTestId('race-display-theme-option-INHERIT')).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('clicking "Use the install\'s setting" clears the override back to null', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby', display_theme: 'newsprint', printables_theme: null }}
            />,
        );
        await openAppearance();

        await userEvent.click(screen.getByTestId('race-display-theme-option-INHERIT'));
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.display_theme).toBeNull();
    });
});
