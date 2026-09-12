import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AwardForm from './AwardForm';
import { templateById } from '../awardTemplates';

const ROUNDS = [{ id: 4, name: 'Finals', roundNumber: 2 }];
const RACING_GROUPS = [{ id: 10, name: 'Wolves' }];
const RACERS = [
  { id: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
  { id: 2, firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
];

function renderForm(props: Partial<React.ComponentProps<typeof AwardForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    <AwardForm
      rounds={ROUNDS}
      racingGroups={RACING_GROUPS}
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
  it('defaults to a speed award, which needs no further input to be right (#999)', () => {
    // A speed award already defaults to the last championship round (or the
    // qualifying standings) below, so it is correct the moment a name is
    // typed; a judged award is never right until somebody is chosen — the
    // shape #999's "Pack Champion silently becomes judged" bug had backwards.
    renderForm();
    expect(screen.getByLabelText('Standings to use')).toBeInTheDocument();
    expect(screen.getByLabelText('Position')).toBeInTheDocument();
    expect(screen.queryByLabelText('Winner')).toBeNull();
  });

  it('swaps the whole second half when the kind changes', async () => {
    // The two kinds share nothing but a name, so showing both sets of controls
    // would put four dead inputs in front of the operator.
    renderForm();
    await userEvent.click(screen.getByLabelText(/somebody we choose/i));

    expect(screen.getByLabelText('Winner')).toBeInTheDocument();
    expect(screen.queryByLabelText('Standings to use')).toBeNull();
    expect(screen.queryByLabelText('Position')).toBeNull();
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
    renderForm(); // Speed-based is the default (#999) — nothing to click.

    const options = screen
      .getAllByRole('option')
      .map((o) => o.textContent)
      .filter(Boolean);
    // Matches the Standings page's own wording exactly (#862) — "Overall"
    // on its own reads as "the whole race, final included", the opposite
    // of what it means.
    expect(options).toContain('Overall (qualifying rounds)');
    expect(options).toContain('Finals');
  });

  it('shows a note about what "Overall" leaves out, only while it is picked', async () => {
    // The Standings page has always carried this warning next to its own
    // "Overall" option; the award form is the one place a mix-up actually
    // hands out the wrong trophy (#862).
    renderForm(); // Speed-based is the default (#999) — nothing to click.

    expect(screen.getByText(/cover the qualifying rounds/i)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Standings to use'), 'Finals');

    expect(screen.queryByText(/cover the qualifying rounds/i)).toBeNull();
  });

  it('defaults a new speed award to the last championship round, not the qualifying standings', async () => {
    // #862: a "Pack Champion" award left on its old default (`ALL`, the
    // qualifying standings — #17) silently announced the qualifying leader
    // rather than the Grand Finals winner. `ALL` is still one click away.
    const onSubmit = vi.fn();
    render(
      <AwardForm
        rounds={[
          { id: 1, name: 'All Pack', roundNumber: 1 },
          { id: 4, name: 'Grand Finals', roundNumber: 2, advancementSource: 'ALL' },
        ]}
        racingGroups={RACING_GROUPS}
        racers={RACERS}
        submitLabel="Add award"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    ); // Speed-based is the default (#999) — nothing to click.

    expect(screen.getByLabelText('Standings to use')).toHaveValue('ROUND:4');

    await userEvent.type(screen.getByLabelText('Award name'), 'Pack Champion');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pack Champion', source: 'ROUND:4' }),
    );
  });

  it('still defaults to the qualifying standings when the race has no championship round', async () => {
    renderForm(); // ROUNDS has no advancementSource — a general round only.

    expect(screen.getByLabelText('Standings to use')).toHaveValue('ALL');
  });

  it('submits a judged award with its chosen racer', async () => {
    const onSubmit = renderForm();

    await userEvent.click(screen.getByLabelText(/somebody we choose/i));
    await userEvent.type(screen.getByLabelText('Award name'), 'Best Paint');
    await userEvent.selectOptions(screen.getByLabelText('Winner'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Best Paint', kind: 'SPECIAL', racerId: 2 }),
    );
  });

  it('defaults a new judged award to votable (#305)', async () => {
    // Most judged awards a pack adds are exactly the ones people vote for.
    const onSubmit = renderForm();
    await userEvent.click(screen.getByLabelText(/somebody we choose/i));
    await userEvent.type(screen.getByLabelText('Award name'), 'Best Paint');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ votable: true }));
  });

  it('lets voting be turned off for a judged award', async () => {
    const onSubmit = renderForm();
    await userEvent.click(screen.getByLabelText(/somebody we choose/i));
    await userEvent.type(screen.getByLabelText('Award name'), 'Judges’ Pick');
    await userEvent.click(screen.getByLabelText(/let people vote for this/i));
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ votable: false }));
  });

  it('has no vote control on a speed award — one cannot be voted on', async () => {
    renderForm(); // Speed-based is the default (#999) — nothing to click.

    expect(screen.queryByLabelText(/let people vote for this/i)).toBeNull();
  });

  it('submits a speed award with its source, place and racingGroup', async () => {
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText('Award name'), 'Fastest Wolf');
    await userEvent.selectOptions(screen.getByLabelText('Limited to a den'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Fastest Wolf',
        kind: 'SPEED',
        source: 'ALL',
        place: 1,
        fromBottom: false,
        racingGroupId: 10,
      }),
    );
  });

  it('submits a slowest-car award', async () => {
    // Plenty of packs give one, and it is the same standings read from the
    // other end rather than a third kind of award.
    const onSubmit = renderForm();

    await userEvent.type(screen.getByLabelText('Award name'), 'Slowest Car');
    await userEvent.selectOptions(screen.getByLabelText('Counting from'), 'BOTTOM');
    await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SPEED', place: 1, fromBottom: true }),
    );
  });

  it('names the positions from whichever end is chosen', async () => {
    renderForm(); // Speed-based is the default (#999) — nothing to click.

    expect(screen.getByRole('option', { name: 'Fastest' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Counting from'), 'BOTTOM');

    expect(screen.getByRole('option', { name: 'Slowest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2nd slowest' })).toBeInTheDocument();
  });

  it('lets a judged award be left undecided', async () => {
    // Most of them are, right up until the end of the event.
    const onSubmit = renderForm();
    await userEvent.click(screen.getByLabelText(/somebody we choose/i));
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

  it('shows the generic hint before any template is chosen', async () => {
    // #440: AwardTemplate.blurb was written by every template and read by
    // nothing until this. Before a choice is made there is no blurb to show.
    renderForm();
    await userEvent.click(screen.getByLabelText(/somebody we choose/i));
    expect(
      screen.getByText('Fills in the name and its artwork — both stay editable afterward.'),
    ).toBeInTheDocument();
  });

  it("shows the chosen template's blurb as help text (#440)", async () => {
    renderForm();
    await userEvent.click(screen.getByLabelText(/somebody we choose/i));
    const bestPaint = templateById('best-paint');
    if (!bestPaint) throw new Error('missing fixture template');

    await userEvent.selectOptions(
      screen.getByLabelText('Start from a ready-made award'),
      'Best Paint',
    );

    expect(screen.getByText(bestPaint.blurb)).toBeInTheDocument();
    expect(
      screen.queryByText('Fills in the name and its artwork — both stay editable afterward.'),
    ).toBeNull();
  });

  it('falls back to the generic hint once the operator edits the name by hand', async () => {
    // The blurb describes the template that was applied; once the name no
    // longer matches it, showing it as a caption for the new name would be
    // wrong rather than merely stale.
    renderForm();
    await userEvent.click(screen.getByLabelText(/somebody we choose/i));
    await userEvent.selectOptions(
      screen.getByLabelText('Start from a ready-made award'),
      'Best Paint',
    );
    await userEvent.type(screen.getByLabelText('Award name'), '!');

    expect(
      screen.getByText('Fills in the name and its artwork — both stay editable afterward.'),
    ).toBeInTheDocument();
  });

  it('opens on the award it is editing', () => {
    renderForm({
      initial: {
        name: 'Fastest Wolf',
        kind: 'SPEED',
        source: 'ROUND:4',
        place: 2,
        fromBottom: true,
        racingGroupId: 10,
      },
      submitLabel: 'Save changes',
    });

    expect(screen.getByLabelText('Award name')).toHaveValue('Fastest Wolf');
    expect(screen.getByLabelText('Standings to use')).toHaveValue('ROUND:4');
    expect(screen.getByLabelText('Counting from')).toHaveValue('BOTTOM');
    expect(screen.getByLabelText('Position')).toHaveValue('2');
    expect(screen.getByLabelText('Limited to a den')).toHaveValue('10');
  });

  describe('the judged-award picker warning (#615)', () => {
    const AWARDS = [
      { id: 100, name: 'Fastest Car', recipient: { id: 1 } },
      { id: 101, name: 'Best Paint', recipient: null },
    ];

    it('warns when the picked racer already holds another award', async () => {
      renderForm({ awards: AWARDS });
      await userEvent.click(screen.getByLabelText(/somebody we choose/i));
      await userEvent.selectOptions(screen.getByLabelText('Winner'), 'Ada Lovelace (#42)');

      expect(
        screen.getByText('Already won “Fastest Car.” Award this one too?'),
      ).toBeInTheDocument();
    });

    it('says nothing when nobody has won anything yet, or nothing is picked', async () => {
      renderForm({ awards: AWARDS });
      await userEvent.click(screen.getByLabelText(/somebody we choose/i));
      expect(screen.queryByText(/Already won/)).toBeNull();

      await userEvent.selectOptions(screen.getByLabelText('Winner'), 'Grace Hopper (#7)');
      expect(screen.queryByText(/Already won/)).toBeNull();
    });

    it('does not warn about the award being edited itself', async () => {
      renderForm({
        awards: AWARDS,
        excludeAwardId: 100,
        initial: { name: 'Fastest Car', kind: 'SPECIAL', racerId: 1 },
      });

      expect(screen.queryByText(/Already won/)).toBeNull();
    });

    it('never blocks the pick — a computed rule does not override a judge', async () => {
      const onSubmit = renderForm({ awards: AWARDS });
      await userEvent.click(screen.getByLabelText(/somebody we choose/i));
      await userEvent.type(screen.getByLabelText('Award name'), 'Most Aerodynamic');
      await userEvent.selectOptions(screen.getByLabelText('Winner'), 'Ada Lovelace (#42)');
      await userEvent.click(screen.getByRole('button', { name: 'Add award' }));

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ racerId: 1 }));
    });
  });

  describe('editing a judged award into a speed award (#992)', () => {
    // The exact repro: a judged award (null source/place, since a SPECIAL
    // award never had either) switched to Speed-based on the edit form. The
    // selects displayed a default the draft did not hold, and Save sent the
    // nulls straight through — "Not set up — this award cannot be won".
    const CHAMPIONSHIP_ROUNDS = [
      { id: 1, name: 'All Pack', roundNumber: 1 },
      { id: 4, name: 'Grand Finals', roundNumber: 2, advancementSource: 'ALL' },
    ];

    it('fills in a real source and place, not null, once switched to Speed-based', async () => {
      const onSubmit = vi.fn();
      render(
        <AwardForm
          rounds={CHAMPIONSHIP_ROUNDS}
          racingGroups={RACING_GROUPS}
          racers={RACERS}
          initial={{
            name: 'Fastest Wolf',
            kind: 'SPECIAL',
            source: null,
            place: null,
            racerId: null,
          }}
          submitLabel="Save changes"
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );

      await userEvent.click(screen.getByLabelText(/speed-based/i));
      // What the select displays is what will be sent — the whole bug was a
      // gap between the two.
      expect(screen.getByLabelText('Standings to use')).toHaveValue('ROUND:4');
      expect(screen.getByLabelText('Position')).toHaveValue('1');

      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'ROUND:4', place: 1 }),
      );
    });

    it('also fixes an award already saved broken by the bug, on open', () => {
      // An award saved by the pre-fix code has kind SPEED with a genuinely
      // null source/place — the state #992's own repro leaves behind.
      // Re-opening it for editing must not perpetuate the bug.
      render(
        <AwardForm
          rounds={CHAMPIONSHIP_ROUNDS}
          racingGroups={RACING_GROUPS}
          racers={RACERS}
          initial={{ name: 'Fastest Wolf', kind: 'SPEED', source: null, place: null }}
          submitLabel="Save changes"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByLabelText('Standings to use')).toHaveValue('ROUND:4');
      expect(screen.getByLabelText('Position')).toHaveValue('1');
    });

    it('clears the speed fields back out when switched to Somebody we choose', async () => {
      const onSubmit = vi.fn();
      render(
        <AwardForm
          rounds={CHAMPIONSHIP_ROUNDS}
          racingGroups={RACING_GROUPS}
          racers={RACERS}
          initial={{
            name: 'Fastest Wolf',
            kind: 'SPEED',
            source: 'ROUND:4',
            place: 2,
            fromBottom: true,
            racingGroupId: 10,
          }}
          submitLabel="Save changes"
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );

      await userEvent.click(screen.getByLabelText(/somebody we choose/i));
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          source: null,
          place: null,
          racingGroupId: null,
          fromBottom: false,
        }),
      );
    });
  });

  describe('the speed-sounding-name hint on a judged award (#999)', () => {
    it('offers a one-click switch when the name sounds like a speed award', async () => {
      renderForm();
      await userEvent.click(screen.getByLabelText(/somebody we choose/i));
      await userEvent.type(screen.getByLabelText('Award name'), 'Fastest Wolf');

      expect(screen.getByText(/sounds like a speed award/i)).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole('button', { name: /switch who wins it to speed-based/i }),
      );

      expect(screen.getByLabelText('Standings to use')).toBeInTheDocument();
    });

    it('says nothing for an ordinary judged award name', async () => {
      renderForm();
      await userEvent.click(screen.getByLabelText(/somebody we choose/i));
      await userEvent.type(screen.getByLabelText('Award name'), 'Best Paint');

      expect(screen.queryByText(/sounds like a speed award/i)).toBeNull();
    });

    it('never fires while the kind is already Speed-based', async () => {
      renderForm();
      await userEvent.type(screen.getByLabelText('Award name'), 'Fastest Car');

      expect(screen.queryByText(/sounds like a speed award/i)).toBeNull();
    });
  });
});
