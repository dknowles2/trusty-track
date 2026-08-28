import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AwardForm from './AwardForm';

const ROUNDS = [{ id: 4, name: 'Finals', roundNumber: 2 }];
const DENS = [{ id: 10, name: 'Wolves' }];
const RACERS = [
  { id: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
  { id: 2, firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
];

function renderForm(props: Partial<React.ComponentProps<typeof AwardForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    <AwardForm
      rounds={ROUNDS}
      dens={DENS}
      racers={RACERS}
      submitLabel="Add award"
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...props}
    />,
  );
  return onSubmit;
}

describe('AwardForm', () => {
  it('starts on a judged award, which is the one the app had no answer for', () => {
    renderForm();
    expect(screen.getByLabelText('Winner')).toBeInTheDocument();
    expect(screen.queryByLabelText('Standings to use')).toBeNull();
  });

  it('swaps the whole second half when the kind changes', async () => {
    // The two kinds share nothing but a name, so showing both sets of controls
    // would put four dead inputs in front of the operator.
    renderForm();
    await userEvent.click(screen.getByLabelText(/speed-based/i));

    expect(screen.getByLabelText('Standings to use')).toBeInTheDocument();
    expect(screen.getByLabelText('Position')).toBeInTheDocument();
    expect(screen.queryByLabelText('Winner')).toBeNull();
  });

  it('shows both "Who wins it" descriptions at once, whichever is checked', async () => {
    // #304: the description used to sit below both radios and switch on
    // whichever was selected, so the one you did not pick was never on
    // screen. Both belong under their own label, always visible.
    renderForm();
    const judgedText = screen.getByText(
      /For awards nothing can measure — paint, design, spirit\./,
    );
    const speedText = screen.getByText(
      /Worked out from the standings — fastest or slowest/,
    );
    expect(judgedText).toBeInTheDocument();
    expect(speedText).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/speed-based/i));

    expect(judgedText).toBeInTheDocument();
    expect(speedText).toBeInTheDocument();
  });

  it('offers the overall standings and every round as a source', async () => {
    renderForm();
    await userEvent.click(screen.getByLabelText(/speed-based/i));

    const options = screen
      .getAllByRole('option')
      .map((o) => o.textContent)
      .filter(Boolean);
    expect(options).toContain('Overall standings');
    expect(options).toContain('Finals');
  });

  it('submits a judged award with its chosen racer', async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText('Award name'), 'Best Paint');
    await userEvent.selectOptions(screen.getByLabelText('Winner'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Best Paint', kind: 'SPECIAL', racerId: 2 }),
    );
  });

  it('submits a speed award with its source, place and den', async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText('Award name'), 'Fastest Wolf');
    await userEvent.click(screen.getByLabelText(/speed-based/i));
    await userEvent.selectOptions(screen.getByLabelText('Limited to a den'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Fastest Wolf',
        kind: 'SPEED',
        source: 'PACK',
        place: 1,
        fromBottom: false,
        denId: 10,
      }),
    );
  });

  it('submits a slowest-car award', async () => {
    // Plenty of packs give one, and it is the same standings read from the
    // other end rather than a third kind of award.
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText('Award name'), 'Slowest Car');
    await userEvent.click(screen.getByLabelText(/speed-based/i));
    await userEvent.selectOptions(screen.getByLabelText('Counting from'), 'BOTTOM');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SPEED', place: 1, fromBottom: true }),
    );
  });

  it('names the positions from whichever end is chosen', async () => {
    renderForm();
    await userEvent.click(screen.getByLabelText(/speed-based/i));

    expect(screen.getByRole('option', { name: 'Fastest' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Counting from'), 'BOTTOM');

    expect(screen.getByRole('option', { name: 'Slowest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2nd slowest' })).toBeInTheDocument();
  });

  it('lets a judged award be left undecided', async () => {
    // Most of them are, right up until the end of the event.
    const onSubmit = renderForm();
    await userEvent.type(screen.getByLabelText('Award name'), 'Judges’ Choice');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ racerId: null }));
  });

  it('will not submit a nameless award', async () => {
    const onSubmit = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('trims the name', async () => {
    const onSubmit = renderForm();
    await userEvent.type(screen.getByLabelText('Award name'), '  Best Paint  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Best Paint' }),
    );
  });

  it('opens on the award it is editing', () => {
    renderForm({
      initial: {
        name: 'Fastest Wolf',
        kind: 'SPEED',
        source: 'ROUND:4',
        place: 2,
        fromBottom: true,
        denId: 10,
      },
      submitLabel: 'Save changes',
    });

    expect(screen.getByLabelText('Award name')).toHaveValue('Fastest Wolf');
    expect(screen.getByLabelText('Standings to use')).toHaveValue('ROUND:4');
    expect(screen.getByLabelText('Counting from')).toHaveValue('BOTTOM');
    expect(screen.getByLabelText('Position')).toHaveValue('2');
    expect(screen.getByLabelText('Limited to a den')).toHaveValue('10');
  });
});
