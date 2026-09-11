// @vitest-environment jsdom
/**
 * The QR code display view's own text (#614), offered on the edit form
 * only (#945) — the "Displays" section sat in front of the scoring decision
 * every race needs, on the create form's own single-page layout, so it was
 * moved out and made edit-only, the same shape "Words and names" already
 * uses. Storage and resolution are backend-tested; this is only the form's
 * own behaviour — absent while creating, present and functional while
 * editing.
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

// The fields live in the "Displays" section, which is a click away while
// editing (#587) — the form opens on Event.
const openDisplays = () => userEvent.click(screen.getByTestId('race-settings-nav-displays'));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuery).mockReturnValue([
        { data: { tracks: [{ id: 7, name: 'Main Track' }] }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
});

describe('creating a race', () => {
    it('offers no QR code display text at all', () => {
        render(<RaceForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create Race" />);

        expect(screen.queryByRole('heading', { name: 'Displays' })).toBeNull();
        expect(screen.queryByLabelText('QR code headline (optional)')).toBeNull();
        expect(screen.queryByLabelText('Venue Wi-Fi guidance (optional)')).toBeNull();
    });
});

describe('editing a race', () => {
    it('shows both fields in the Displays section, blank by default', async () => {
        render(
            <RaceForm
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{ name: 'Pack 42 Derby' }}
            />,
        );
        await openDisplays();

        expect(screen.getByLabelText('QR code headline (optional)')).toHaveValue('');
        expect(screen.getByLabelText('Venue Wi-Fi guidance (optional)')).toHaveValue('');
    });

    it('shows an existing headline and Wi-Fi note, and submits an edited value', async () => {
        const onSubmit = vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});
        render(
            <RaceForm
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                submitLabel="Save Changes"
                isEditing
                initialData={{
                    name: 'Pack 42 Derby',
                    qr_headline: 'Scan to Vote for Best in Show!',
                    qr_wifi_note: 'Connect to Pack 123 Guest Wi-Fi',
                }}
            />,
        );
        await openDisplays();

        expect(screen.getByLabelText('QR code headline (optional)')).toHaveValue(
            'Scan to Vote for Best in Show!',
        );
        expect(screen.getByLabelText('Venue Wi-Fi guidance (optional)')).toHaveValue(
            'Connect to Pack 123 Guest Wi-Fi',
        );

        await userEvent.clear(screen.getByLabelText('QR code headline (optional)'));
        await userEvent.type(screen.getByLabelText('QR code headline (optional)'), 'See Live Results!');
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const payload = onSubmit.mock.calls[0][0];
        expect(payload.qr_headline).toBe('See Live Results!');
        // Untouched, and still travels — the two fields are independent.
        expect(payload.qr_wifi_note).toBe('Connect to Pack 123 Guest Wi-Fi');
    });
});
