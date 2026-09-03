import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import { useMutation } from 'urql';
import TrackCard, { type TimerModel, type TrackFields } from './TrackCard';

// TrackCard itself talks to no mutation, but with an id it renders the
// lanes-in-service and track-records panels, and both do — the same mock
// TrackRecords.test.tsx and TrackLanes.test.tsx use.
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useMutation: vi.fn() };
});

function mockMutations() {
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockReturnValue([
        { fetching: false },
        vi.fn(),
    ]);
}

const baseTrack: TrackFields = {
    name: 'Main Track',
    laneCount: 4,
    lengthFeet: 32,
    timerType: 'FAKE',
    serialPort: '',
    timerProfile: '',
    remoteStartInstalled: false,
    reverseLanes: false,
    scaleRatio: 25,
    showScaleSpeed: false,
};

const standardModel: TimerModel = {
    key: 'microwizard',
    name: 'Micro Wizard',
    provenance: 'Adapted from the Micro Wizard protocol notes.',
    detectable: true,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'N',
};

const undetectableModel: TimerModel = {
    key: 'oddball',
    name: 'Oddball Timer',
    provenance: 'A device with unusual framing.',
    detectable: false,
    baudRate: 1200,
    dataBits: 7,
    stopBits: 2,
    parity: 'E',
};

const models: TimerModel[] = [standardModel, undetectableModel];

function renderCard(
    trackOverrides: Partial<TrackFields> = {},
    cardOverrides: { canRemove?: boolean; timerModels?: TimerModel[] } = {},
) {
    mockMutations();
    const onChange = vi.fn();
    const onRemove = vi.fn();
    const onLaneOutages = vi.fn();
    const onRecords = vi.fn();
    render(
        <MemoryRouter>
            <AlertProvider>
                <TrackCard
                    index={0}
                    track={{ ...baseTrack, ...trackOverrides }}
                    timerModels={cardOverrides.timerModels ?? models}
                    canRemove={cardOverrides.canRemove ?? true}
                    onChange={onChange}
                    onRemove={onRemove}
                    onLaneOutages={onLaneOutages}
                    onRecords={onRecords}
                />
            </AlertProvider>
        </MemoryRouter>,
    );
    return { onChange, onRemove, onLaneOutages, onRecords };
}

afterEach(() => vi.clearAllMocks());

describe('TrackCard', () => {
    it('reports a name edit through onChange', () => {
        const { onChange } = renderCard();
        fireEvent.change(screen.getByLabelText('Track Name'), {
            target: { value: 'Back Track' },
        });
        expect(onChange).toHaveBeenCalledWith('name', 'Back Track');
    });

    it('parses lane count and length as numbers, falling back to 0 for a blank field', () => {
        const { onChange } = renderCard();

        fireEvent.change(screen.getByLabelText('Lanes'), { target: { value: '6' } });
        expect(onChange).toHaveBeenCalledWith('laneCount', 6);

        fireEvent.change(screen.getByLabelText('Lanes'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith('laneCount', 0);

        fireEvent.change(screen.getByLabelText('Length (Feet)'), { target: { value: '40' } });
        expect(onChange).toHaveBeenCalledWith('lengthFeet', 40);
    });

    it('shows a Remove Track control only when the card says it can be removed', () => {
        renderCard({}, { canRemove: false });
        expect(screen.queryByTitle('Remove Track')).not.toBeInTheDocument();
    });

    it('calls onRemove when Remove Track is clicked', async () => {
        const { onRemove } = renderCard({}, { canRemove: true });
        await userEvent.click(screen.getByTitle('Remove Track'));
        expect(onRemove).toHaveBeenCalled();
    });

    describe('scale speed', () => {
        it('hides the ratio input until "Show scale speed" is checked', () => {
            renderCard({ showScaleSpeed: false });
            expect(screen.queryByLabelText(/^Scale \(1:25/)).not.toBeInTheDocument();
        });

        it('reports the checkbox through onChange', async () => {
            const { onChange } = renderCard({ showScaleSpeed: false });
            await userEvent.click(screen.getByRole('checkbox', { name: /show scale speed/i }));
            expect(onChange).toHaveBeenCalledWith('showScaleSpeed', true);
        });

        it('shows the ratio input, with the current value, once scale speed is on', () => {
            renderCard({ showScaleSpeed: true, scaleRatio: 25 });
            expect(screen.getByLabelText(/^Scale \(1:25/)).toHaveValue(25);
        });

        it('reports a ratio edit through onChange, parsed as a number', () => {
            const { onChange } = renderCard({ showScaleSpeed: true, scaleRatio: 25 });
            fireEvent.change(screen.getByLabelText(/^Scale \(1:25/), {
                target: { value: '32' },
            });
            expect(onChange).toHaveBeenCalledWith('scaleRatio', 32);
        });
    });

    describe('lanes in service', () => {
        it('is absent for a track that has not been saved yet (no id)', () => {
            renderCard();
            expect(screen.queryByText('Lanes in service')).not.toBeInTheDocument();
        });

        it('appears, and says it saves immediately, once the track has an id', () => {
            renderCard({ id: 12, laneOutages: [] });
            expect(screen.getByText('Lanes in service')).toBeInTheDocument();
            expect(screen.getByText(/applies straight away/i)).toBeInTheDocument();
        });

        it("is built from this track's own lane count and outages", () => {
            renderCard({ id: 12, laneCount: 3, laneOutages: [2] });
            expect(screen.getByLabelText('Lane 1 works')).toBeChecked();
            expect(screen.getByLabelText('Lane 2 works')).not.toBeChecked();
            expect(screen.getByLabelText('Lane 3 works')).toBeChecked();
            expect(screen.queryByLabelText('Lane 4 works')).not.toBeInTheDocument();
        });
    });

    describe('"Check this timer" link', () => {
        it('is absent for a track that has not been saved yet (no id)', () => {
            renderCard();
            expect(screen.queryByRole('link', { name: /check this timer/i })).not.toBeInTheDocument();
        });

        it("points at this track's own fragment on the diagnostics page", () => {
            renderCard({ id: 12 });
            expect(screen.getByRole('link', { name: /check this timer/i })).toHaveAttribute(
                'href',
                '/timer-check#timer-12',
            );
        });
    });

    describe('timer type', () => {
        it('offers exactly the fake, backend, proxy and hand-entry options', () => {
            renderCard();
            const options = within(screen.getByLabelText('Timer Type'))
                .getAllByRole('option')
                .map((o) => (o as HTMLOptionElement).value);
            expect(options).toEqual(['FAKE', 'AUTO_DETECT_BACKEND', 'AUTO_DETECT_PROXY', 'NONE']);
        });

        it('reports a change through onChange', () => {
            const { onChange } = renderCard({ timerType: 'FAKE' });
            fireEvent.change(screen.getByLabelText('Timer Type'), {
                target: { value: 'AUTO_DETECT_BACKEND' },
            });
            expect(onChange).toHaveBeenCalledWith('timerType', 'AUTO_DETECT_BACKEND');
        });

        it('hides the model, serial port and remote-start controls for the fake timer', () => {
            renderCard({ timerType: 'FAKE' });
            expect(screen.queryByLabelText(/Timer Model/)).not.toBeInTheDocument();
            expect(screen.queryByLabelText(/Serial Port/)).not.toBeInTheDocument();
            expect(screen.queryByText(/remote start gate/i)).not.toBeInTheDocument();
        });

        it('hides the same controls, and explains hand entry, for NONE', () => {
            renderCard({ timerType: 'NONE' });
            expect(
                screen.getByText(/won't try to arm a timer/i),
            ).toBeInTheDocument();
            expect(screen.queryByLabelText(/Timer Model/)).not.toBeInTheDocument();
            expect(screen.queryByLabelText(/Serial Port/)).not.toBeInTheDocument();
            expect(screen.queryByText(/remote start gate/i)).not.toBeInTheDocument();
        });

        it('shows the model picker and remote start, but not a serial port, for the browser proxy', () => {
            renderCard({ timerType: 'AUTO_DETECT_PROXY' });
            expect(screen.getByLabelText(/Timer Model/)).toBeInTheDocument();
            expect(screen.getByText(/remote start gate/i)).toBeInTheDocument();
            expect(screen.queryByLabelText(/Serial Port/)).not.toBeInTheDocument();
        });

        it('shows the serial port field only for the backend-direct timer', () => {
            renderCard({ timerType: 'AUTO_DETECT_BACKEND' });
            expect(screen.getByLabelText(/Serial Port/)).toBeInTheDocument();
        });
    });

    describe('timer model', () => {
        it('reports a chosen model through onChange', () => {
            const { onChange } = renderCard({ timerType: 'AUTO_DETECT_BACKEND' });
            fireEvent.change(screen.getByLabelText(/Timer Model/), {
                target: { value: 'microwizard' },
            });
            expect(onChange).toHaveBeenCalledWith('timerProfile', 'microwizard');
        });

        it('warns that an undetectable model must be chosen explicitly', () => {
            renderCard({ timerType: 'AUTO_DETECT_BACKEND', timerProfile: 'oddball' });
            expect(screen.getByText(/only way to use it/i)).toBeInTheDocument();
        });

        it('says nothing about detectability for a model that can identify itself', () => {
            renderCard({ timerType: 'AUTO_DETECT_BACKEND', timerProfile: 'microwizard' });
            expect(screen.queryByText(/only way to use it/i)).not.toBeInTheDocument();
        });

        it('warns about non-standard framing for a model that uses it', () => {
            renderCard({ timerType: 'AUTO_DETECT_BACKEND', timerProfile: 'oddball' });
            expect(screen.getByText(/not the usual 9600 8-N-1/)).toBeInTheDocument();
        });

        it('says nothing about framing for a standard 9600 8-N-1 model', () => {
            renderCard({ timerType: 'AUTO_DETECT_BACKEND', timerProfile: 'microwizard' });
            expect(screen.queryByText(/not the usual 9600 8-N-1/)).not.toBeInTheDocument();
        });
    });

    describe('remote start', () => {
        it('reports the checkbox through onChange', async () => {
            const { onChange } = renderCard({
                timerType: 'AUTO_DETECT_BACKEND',
                remoteStartInstalled: false,
            });
            await userEvent.click(screen.getByRole('checkbox', { name: /remote start gate/i }));
            expect(onChange).toHaveBeenCalledWith('remoteStartInstalled', true);
        });
    });

    describe('reversed cable', () => {
        it('is offered alongside remote start for a real timer', () => {
            renderCard({ timerType: 'AUTO_DETECT_BACKEND' });
            expect(screen.getByText(/wired backwards/i)).toBeInTheDocument();
        });

        it('is absent for the fake timer and for hand entry', () => {
            renderCard({ timerType: 'FAKE' });
            expect(screen.queryByText(/wired backwards/i)).not.toBeInTheDocument();
            renderCard({ timerType: 'NONE' });
            expect(screen.queryByText(/wired backwards/i)).not.toBeInTheDocument();
        });

        it('reports the checkbox through onChange', async () => {
            const { onChange } = renderCard({
                timerType: 'AUTO_DETECT_BACKEND',
                reverseLanes: false,
            });
            await userEvent.click(screen.getByRole('checkbox', { name: /wired backwards/i }));
            expect(onChange).toHaveBeenCalledWith('reverseLanes', true);
        });
    });
});
