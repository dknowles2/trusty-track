// @vitest-environment jsdom
/**
 * Check-in mode reorders the form (#1153): weight, the inspection toggle
 * and Save sit above two disclosures (Details, Photos) rather than after
 * the whole thing — same fields, same state, same validation, same
 * `onSubmit` payload, just a different arrangement. Add Racer is untouched.
 *
 * The #848 submit-label cases (moved here from having no dedicated test at
 * all — `RaceDetailsCheckIn.test.tsx` only drives the obvious "never touch
 * the toggle" path end to end) are pinned alongside the reorder, since both
 * are about the same button.
 */
import '../../../setupTests';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn(), useMutation: vi.fn() };
});

import { useQuery, useMutation } from 'urql';
import RacerForm, { type RacerData } from './RacerForm';
import { AlertProvider } from '../../../context/AlertContext';

const ORIGINAL_WIDTH = window.innerWidth;

function setViewportWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue([
        { data: { race: { racingGroups: [] } }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
    vi.mocked(useMutation).mockReturnValue([{ fetching: false, stale: false }, vi.fn()] as never);
});

afterEach(() => {
    setViewportWidth(ORIGINAL_WIDTH);
});

const racer: RacerData = {
    first_name: 'Jordan',
    last_name: 'Mitchell',
    car_number: 42,
    car_passed_inspection: false,
    car_weight: undefined,
    car_name: 'Blue Streak',
    excluded_from_standings: false,
};

function renderForm(props: Partial<ComponentProps<typeof RacerForm>> = {}) {
    return render(
        <AlertProvider>
            <RacerForm
                raceId={1}
                onSubmit={vi.fn().mockResolvedValue(undefined)}
                onCancel={vi.fn()}
                {...props}
            />
        </AlertProvider>,
    );
}

describe('check-in mode reorders the form (#1153)', () => {
    it('renders Car Weight first — ahead of First Name in the document — autofocused, with a numeric keypad', () => {
        setViewportWidth(1280);
        renderForm({ initialData: racer, checkInMode: true });

        const weightInput = screen.getByLabelText('Car Weight (oz)');
        expect(weightInput).toHaveFocus();
        expect(weightInput).toHaveAttribute('inputmode', 'decimal');

        const firstName = screen.getByLabelText('First Name');
        // DOCUMENT_POSITION_FOLLOWING on the result means `firstName` comes
        // after `weightInput` in the document — i.e. weight really is first.
        expect(
            weightInput.compareDocumentPosition(firstName) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('opens both disclosures by default at 1280px (tablet landscape and up)', () => {
        setViewportWidth(1280);
        renderForm({ initialData: racer, checkInMode: true });

        expect(screen.getByTestId('racer-form-details')).toHaveAttribute('open');
        expect(screen.getByTestId('racer-form-photos')).toHaveAttribute('open');
    });

    it('closes both disclosures by default at 390px (phone)', () => {
        setViewportWidth(390);
        renderForm({ initialData: racer, checkInMode: true });

        expect(screen.getByTestId('racer-form-details')).not.toHaveAttribute('open');
        expect(screen.getByTestId('racer-form-photos')).not.toHaveAttribute('open');
    });

    it('leaves Add Racer in its original order: no disclosures, First Name is still first and still autofocused', () => {
        setViewportWidth(390);
        renderForm();

        expect(screen.queryByTestId('racer-form-details')).not.toBeInTheDocument();
        expect(screen.queryByTestId('racer-form-photos')).not.toBeInTheDocument();

        const weightInput = screen.getByLabelText('Car Weight (oz)');
        expect(weightInput).not.toHaveAttribute('inputmode');
        // Add Racer has never set an explicit `autoFocus` anywhere — a real
        // `Modal` picks the first focusable element itself, which is First
        // Name here since nothing about its position changed.
        expect(weightInput).not.toHaveFocus();
    });

    it('opens the Details disclosure and focuses First Name when it is left blank', async () => {
        setViewportWidth(390);
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        // A lone space rather than an empty string — jsdom (like a real
        // browser) honours `required` on a rendered input before this
        // component's own check ever runs, so an empty value never reaches
        // `handleSubmit` at all. See `frontend-screens.md`'s note on the
        // identical trap in `RaceFormSections.test.tsx`.
        renderForm({ initialData: { ...racer, first_name: ' ' }, checkInMode: true, onSubmit });

        expect(screen.getByTestId('racer-form-details')).not.toHaveAttribute('open');

        await userEvent.click(screen.getByRole('button', { name: /Save/ }));

        expect(screen.getByTestId('racer-form-details')).toHaveAttribute('open');
        expect(screen.getByLabelText('First Name')).toHaveFocus();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('opens the Details disclosure and focuses Last Name when it is left blank', async () => {
        setViewportWidth(390);
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        renderForm({ initialData: { ...racer, last_name: ' ' }, checkInMode: true, onSubmit });

        await userEvent.click(screen.getByRole('button', { name: /Save/ }));

        expect(screen.getByTestId('racer-form-details')).toHaveAttribute('open');
        expect(screen.getByLabelText('Last Name')).toHaveFocus();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits the same payload as Add Racer once the fields are valid', async () => {
        setViewportWidth(390);
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        renderForm({ initialData: racer, checkInMode: true, onSubmit });

        await userEvent.clear(screen.getByLabelText('Car Weight (oz)'));
        await userEvent.type(screen.getByLabelText('Car Weight (oz)'), '4.9');
        await userEvent.click(screen.getByRole('button', { name: /Save/ }));

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ first_name: 'Jordan', last_name: 'Mitchell', car_weight: 4.9 }),
        );
    });
});

describe('#848: the submit button says what it is about to do', () => {
    it('says "Save Check-in" while the toggle is on', () => {
        renderForm({
            initialData: { ...racer, car_passed_inspection: true },
            checkInMode: true,
            submitLabel: 'Save Check-in',
        });

        expect(screen.getByRole('button', { name: 'Save Check-in' })).toBeInTheDocument();
    });

    it('says "Save without checking in" the moment the toggle is turned off', async () => {
        renderForm({
            initialData: { ...racer, car_passed_inspection: true },
            checkInMode: true,
            submitLabel: 'Save Check-in',
        });

        await userEvent.click(screen.getByLabelText('Passed Inspection / Checked In'));

        expect(screen.getByRole('button', { name: 'Save without checking in' })).toBeInTheDocument();
    });

    it('says "Save without checking in" when opened on an uninspected racer, before the toggle is touched', () => {
        renderForm({
            initialData: { ...racer, car_passed_inspection: false },
            checkInMode: true,
            submitLabel: 'Save Check-in',
        });

        expect(screen.getByRole('button', { name: 'Save without checking in' })).toBeInTheDocument();
    });

    it('says "Save Racer" outside check-in mode', () => {
        renderForm();

        expect(screen.getByRole('button', { name: 'Save Racer' })).toBeInTheDocument();
    });
});

describe('a racer\'s home unit (#1076, stage 1)', () => {
    it('appears in the main order for Add Racer, after the group', () => {
        renderForm();

        expect(screen.getByLabelText('Home Pack')).toBeInTheDocument();
    });

    it('appears in the Details disclosure in check-in mode', () => {
        renderForm({ checkInMode: true });

        expect(screen.getByTestId('racer-form-details')).toContainElement(
            screen.getByLabelText('Home Pack'),
        );
    });

    it('reads the race\'s own resolved label instead of the built-in default', () => {
        renderForm({ homeUnitLabel: 'Home Troop' });

        expect(screen.getByLabelText('Home Troop')).toBeInTheDocument();
        expect(screen.queryByLabelText('Home Pack')).not.toBeInTheDocument();
    });

    it('seeds from the racer being edited and sends the typed value on submit', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        renderForm({
            initialData: { ...racer, home_unit: 'Pack 12' },
            onSubmit,
        });

        expect(screen.getByLabelText('Home Pack')).toHaveValue('Pack 12');

        await userEvent.clear(screen.getByLabelText('Home Pack'));
        await userEvent.type(screen.getByLabelText('Home Pack'), 'Pack 30');
        await userEvent.click(screen.getByRole('button', { name: 'Save Racer' }));

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ home_unit: 'Pack 30' }),
        );
    });
});
