import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertProvider } from '../../../context/AlertContext';
import { useMutation } from 'urql';
import TrackLanes from './TrackLanes';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useMutation: vi.fn() };
});

const executeMutation = vi.fn();

function mockMutations() {
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockReturnValue([
        { fetching: false },
        executeMutation,
    ]);
}

function renderLanes(outages: number[] = [], laneCount = 4, onChange = vi.fn()) {
    mockMutations();
    render(
        <AlertProvider>
            <TrackLanes trackId={9} laneCount={laneCount} outages={outages} onChange={onChange} />
        </AlertProvider>,
    );
    return onChange;
}

afterEach(() => vi.clearAllMocks());

describe('TrackLanes', () => {
    it('shows one checkbox per lane, unchecked for a lane out of service', () => {
        renderLanes([2], 4);
        expect(screen.getByLabelText('Lane 1 works')).toBeChecked();
        expect(screen.getByLabelText('Lane 2 works')).not.toBeChecked();
        expect(screen.getByLabelText('Lane 3 works')).toBeChecked();
        expect(screen.getByLabelText('Lane 4 works')).toBeChecked();
    });

    it('puts the checkbox before the lane number inside a chip, not after (#1252)', () => {
        // A reviewer on #1269 swapped this order by hand and nothing here
        // failed — this pins it. The chip's own docstring and TrackCard's
        // both describe it as "checkbox-first"; a chip whose visible order
        // doesn't match no longer reads as a row of checkboxes.
        renderLanes([], 4);

        const checkbox = screen.getByLabelText('Lane 1 works');
        const chip = checkbox.closest('.lane-service-chip');
        expect(chip).not.toBeNull();

        // The lane number is a bare text node, a sibling of the checkbox
        // inside the chip — not its own element — so it's found by content
        // rather than by role or label.
        const numberNode = Array.from(chip!.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '1',
        );
        expect(numberNode).toBeDefined();

        // compareDocumentPosition returns a bitmask; DOCUMENT_POSITION_FOLLOWING
        // (4) is set when the node passed in comes *after* the node it was
        // called on — so this asserts the checkbox precedes the number.
        expect(
            checkbox.compareDocumentPosition(numberNode!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('summarizes how many lanes remain and which are out', () => {
        renderLanes([2], 4);
        expect(
            screen.getByText(/3 of 4 lanes in use — Lane 2 out of service/),
        ).toBeInTheDocument();
    });

    it('says every lane is in use when none are out', () => {
        renderLanes([], 4);
        expect(screen.getByText(/All 4 lanes in use/)).toBeInTheDocument();
    });

    it('says the change applies immediately, unlike the rest of the card', () => {
        renderLanes([], 4);
        expect(
            screen.getByText(/applies straight away, and affects rounds generated from now on/),
        ).toBeInTheDocument();
    });

    it('says no schedule can be generated once every lane is out', () => {
        renderLanes([1, 2], 2);
        expect(
            screen.getByText(/No usable lanes — no schedule can be generated/),
        ).toBeInTheDocument();
    });

    it('turning a working lane off sends the whole updated set, sorted', async () => {
        executeMutation.mockResolvedValue({ data: { setLaneOutages: [3] } });
        renderLanes([], 4);

        await userEvent.click(screen.getByLabelText('Lane 3 works'));

        expect(executeMutation).toHaveBeenCalledWith({ trackId: 9, lanes: [3] });
    });

    it('turning a broken lane back on removes it from the set sent', async () => {
        executeMutation.mockResolvedValue({ data: { setLaneOutages: [1] } });
        renderLanes([1, 3], 4);

        await userEvent.click(screen.getByLabelText('Lane 3 works'));

        expect(executeMutation).toHaveBeenCalledWith({ trackId: 9, lanes: [1] });
    });

    it("reports the server's own answer rather than assuming the request was accepted whole", async () => {
        // The server dropped the lane it was sent - it no longer exists on
        // a track whose lane count has since shrunk.
        executeMutation.mockResolvedValue({ data: { setLaneOutages: [] } });
        const onChange = renderLanes([], 4);

        await userEvent.click(screen.getByLabelText('Lane 2 works'));

        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('falls back to the locally-computed set when the response carries none', async () => {
        executeMutation.mockResolvedValue({ data: {} });
        const onChange = renderLanes([], 4);

        await userEvent.click(screen.getByLabelText('Lane 2 works'));

        expect(onChange).toHaveBeenCalledWith([2]);
    });

    it('shows an error toast and leaves onChange uncalled when the save fails', async () => {
        executeMutation.mockResolvedValue({
            error: { graphQLErrors: [{ message: 'The lane change could not be saved.' }] },
        });
        const onChange = renderLanes([], 4);

        await userEvent.click(screen.getByLabelText('Lane 2 works'));

        expect(
            await screen.findByText('The lane change could not be saved.'),
        ).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('disables every lane checkbox while a change is being saved, and re-enables once it settles', async () => {
        let resolve!: (value: unknown) => void;
        executeMutation.mockReturnValue(
            new Promise((r) => {
                resolve = r;
            }),
        );
        renderLanes([], 4);

        await userEvent.click(screen.getByLabelText('Lane 2 works'));
        expect(screen.getByLabelText('Lane 1 works')).toBeDisabled();
        expect(screen.getByLabelText('Lane 2 works')).toBeDisabled();

        resolve({ data: { setLaneOutages: [2] } });
        await waitFor(() => expect(screen.getByLabelText('Lane 1 works')).not.toBeDisabled());
    });
});
