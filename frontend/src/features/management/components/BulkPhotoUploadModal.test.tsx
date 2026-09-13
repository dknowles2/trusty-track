/**
 * Uploading a batch of photos (issue #116).
 *
 * The case worth pinning is the same image picked twice in one selection.
 * urql keys an operation on its document plus its variables, so two concurrent
 * `uploadImage` mutations carrying an identical data URL are the same
 * operation — and with the normalized cache in the chain only one of them ever
 * got a result. The others never settled: their photos sat on "Uploading…" and
 * **Apply** stayed disabled, with no way out but closing the modal.
 *
 * Reproduced against a real client rather than described from the symptom:
 * three concurrent identical mutations reach the network three times and two of
 * the promises never resolve. Sequential ones are fine, and so are concurrent
 * ones with different variables — which is why one request per distinct image
 * is the fix rather than uploading one at a time.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { Provider } from 'urql';
import { fromValue, never } from 'wonka';
import BulkPhotoUploadModal from './BulkPhotoUploadModal';
import { AlertProvider } from '../../../context/AlertContext';

const RACERS = [
    { id: 1, first_name: 'Alex', last_name: 'Rivera', car_number: 3 },
    { id: 2, first_name: 'Sam', last_name: 'Okafor', car_number: 7 },
    { id: 3, first_name: 'Jamie', last_name: 'Lee', car_number: 9, racer_image_url: '/static/jamie.jpg' },
];

/** A file whose bytes are exactly `body`, so identical bodies collide. */
const image = (name: string, body: string) =>
    new File([body], name, { type: 'image/jpeg' });

function renderModal() {
    const uploads: string[] = [];
    const executeMutation = vi.fn((op: { variables?: Record<string, unknown> }) => {
        const dataUrl = op.variables?.dataUrl;
        if (typeof dataUrl === 'string') {
            uploads.push(dataUrl);
            return fromValue({
                data: { uploadImage: `/static/${uploads.length}.jpg` },
                stale: false,
                hasNext: false,
            });
        }
        return fromValue({ data: { bulkAssignPhotos: true }, stale: false, hasNext: false });
    });

    const client = {
        executeQuery: () => never,
        executeMutation,
        executeSubscription: () => never,
    } as unknown as Parameters<typeof Provider>[0]['value'];

    render(
        <Provider value={client}>
            <AlertProvider>
                <BulkPhotoUploadModal isOpen onClose={() => {}} onSuccess={() => {}} racers={RACERS} />
            </AlertProvider>
        </Provider>,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    return { input, uploads };
}

const assignBoxes = () => screen.queryAllByPlaceholderText('— Assign to racer —');

describe('picking several photos at once', () => {
    it('uploads each distinct image', async () => {
        const { input, uploads } = renderModal();

        fireEvent.change(input, { target: { files: [image('a.jpg', 'AAA'), image('b.jpg', 'BBB')] } });

        await waitFor(() => expect(assignBoxes()).toHaveLength(2));
        expect(uploads).toHaveLength(2);
    });

    it('uploads an image picked twice only once, and finishes both', async () => {
        // Before the fix the second entry never left "Uploading…", which is
        // both photos short of assignable and the modal stuck.
        const { input, uploads } = renderModal();

        fireEvent.change(input, { target: { files: [image('a.jpg', 'SAME'), image('copy.jpg', 'SAME')] } });

        await waitFor(() => expect(assignBoxes()).toHaveLength(2));
        expect(uploads).toHaveLength(1);
        expect(screen.queryByText('Uploading...')).not.toBeInTheDocument();
    });

    it('gives both copies the same uploaded image', async () => {
        // They are the same bytes, so one stored file is the right answer —
        // sharing the request is not a compromise here, it is the truth.
        const { input, uploads } = renderModal();

        fireEvent.change(input, { target: { files: [image('a.jpg', 'SAME'), image('copy.jpg', 'SAME')] } });

        await waitFor(() => expect(assignBoxes()).toHaveLength(2));
        expect(uploads).toEqual([expect.stringContaining('base64')]);
    });
});

/**
 * The demo refuses `uploadImage` with a sentence saying so (#1095). Before
 * this, every photo in the selection painted its own silent red
 * "Upload failed." row with nothing saying why; now a whole selection
 * refused for the identical reason says so once.
 */
describe('every upload in a selection refused for the same reason (#1095)', () => {
    function renderWithRefusal(message: string) {
        const executeMutation = vi.fn(() =>
            fromValue({
                error: { graphQLErrors: [{ message }] },
                data: undefined,
                stale: false,
                hasNext: false,
            }),
        );
        const client = {
            executeQuery: () => never,
            executeMutation,
            executeSubscription: () => never,
        } as unknown as Parameters<typeof Provider>[0]['value'];

        render(
            <Provider value={client}>
                <AlertProvider>
                    <BulkPhotoUploadModal isOpen onClose={() => {}} onSuccess={() => {}} racers={RACERS} />
                </AlertProvider>
            </Provider>,
        );

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        return { input };
    }

    it('shows one alert carrying the server\'s own message', async () => {
        const { input } = renderWithRefusal('uploadImage is not available on the demo');

        fireEvent.change(input, { target: { files: [image('a.jpg', 'AAA'), image('b.jpg', 'BBB')] } });

        await waitFor(() => {
            expect(screen.getByRole('dialog', { name: 'Error' })).toHaveTextContent(
                'uploadImage is not available on the demo',
            );
        });
    });

    it('does not paint one red row per refused photo', async () => {
        const { input } = renderWithRefusal('uploadImage is not available on the demo');

        fireEvent.change(input, { target: { files: [image('a.jpg', 'AAA'), image('b.jpg', 'BBB')] } });

        await waitFor(() => {
            expect(screen.getByRole('dialog', { name: 'Error' })).toBeInTheDocument();
        });
        expect(screen.queryByText(/failed/i, { selector: 'div' })).not.toBeInTheDocument();
    });
});

/**
 * The trigger itself is refused before a file is ever read, not only after
 * the upload comes back (#1095) — `initialConfig.demoRefusedMutations`
 * containing `uploadImage` is the one signal every photo control in the app
 * reads for this.
 */
describe('the trigger on the demo', () => {
    it('disables Choose Photos, with a title, when uploadImage is refused', () => {
        const executeQuery = vi.fn((op: { query: { definitions: { name?: { value: string } }[] } }) => {
            const name = op.query.definitions[0]?.name?.value;
            if (name === 'GetInitialConfigStatus') {
                return fromValue({
                    data: { initialConfig: { demoRefusedMutations: ['uploadImage'] } },
                    stale: false,
                    hasNext: false,
                });
            }
            return never;
        });
        const client = {
            executeQuery,
            executeMutation: () => never,
            executeSubscription: () => never,
        } as unknown as Parameters<typeof Provider>[0]['value'];

        render(
            <Provider value={client}>
                <AlertProvider>
                    <BulkPhotoUploadModal isOpen onClose={() => {}} onSuccess={() => {}} racers={RACERS} />
                </AlertProvider>
            </Provider>,
        );

        const trigger = screen.getByText('Choose Photos');
        expect(trigger).toBeDisabled();
        expect(trigger).toHaveAttribute('title', "Photos can't be uploaded on the demo");
    });
});

/**
 * The picker is the shared `RacerCombobox` (#693), not a private copy that
 * had drifted to show no portraits. This is the visible point of that
 * change, so it is asserted directly rather than trusted from the diff.
 */
describe('the racer picker shares RacerCombobox with the rest of the app', () => {
    it('shows each racer\'s portrait — a photo where one is on file, initials otherwise', async () => {
        const { input } = renderModal();

        fireEvent.change(input, { target: { files: [image('a.jpg', 'AAA')] } });
        await waitFor(() => expect(assignBoxes()).toHaveLength(1));

        fireEvent.focus(assignBoxes()[0]);

        // Jamie has a photo on file: RacerCombobox renders it through
        // RacerAvatar as an <img>, alt-texted with the racer's name.
        expect(await screen.findByAltText('Jamie Lee')).toBeInTheDocument();

        // Alex and Sam have none: RacerAvatar falls back to an initials
        // roundel, titled with the racer's name rather than alt-texted.
        expect(screen.getByTitle('Alex Rivera')).toBeInTheDocument();
        expect(screen.getByTitle('Sam Okafor')).toBeInTheDocument();
    });
});
