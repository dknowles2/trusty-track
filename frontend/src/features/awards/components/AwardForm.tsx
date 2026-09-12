/**
 * Defining one award (#170).
 *
 * The form is really two forms behind one kind switch, because the two kinds
 * of award have nothing in common but a name. A `SPEED` award needs a source, a
 * place and optionally a racingGroup; a `SPECIAL` award needs a person. Showing both
 * halves at once and letting the server sort it out would put the operator in
 * front of four controls that do nothing.
 *
 * The ready-made superlative picker (#306) only appears on the judged half: a
 * `SPEED` award's artwork is worked out from its rule server-side, with no
 * control offered for it here. Choosing a template just writes an ordinary
 * name and `artworkKey` into the draft — nothing downstream learns a new
 * concept, and both fields stay free text afterward.
 */

import { useState } from 'react';
import { AWARD_TEMPLATES, templateById } from '../awardTemplates';
import { useTerminology } from '../../../context/TerminologyContext';
import {
  NamedRacingGroup,
  NamedRound,
  ALL_SOURCE,
  awardHolderWarning,
  lastChampionshipRound,
  positionLabel,
  racerLabel,
  roundLabel,
  soundsLikeSpeedAward,
} from '../awardText';

export interface AwardDraft {
  name: string;
  kind: 'SPEED' | 'SPECIAL';
  source: string | null;
  place: number | null;
  fromBottom: boolean;
  racingGroupId: number | null;
  racerId: number | null;
  artworkKey: string | null;
  // SPECIAL only; ignored (forced false) for SPEED — see
  // `crud._clear_fields_of_other_kind` (#305).
  votable: boolean;
}

export interface AwardFormRacer {
  id: number;
  firstName: string;
  lastName: string;
  carNumber?: number | null;
}

export interface AwardFormAward {
  id: number;
  name: string;
  recipient?: { id: number } | null;
}

interface Props {
  initial?: Partial<AwardDraft>;
  rounds: NamedRound[];
  racingGroups: NamedRacingGroup[];
  racers: AwardFormRacer[];
  submitLabel: string;
  onSubmit: (draft: AwardDraft) => void;
  onCancel: () => void;
  /**
   * The race's other awards, for the judged-award picker's own warning
   * (#615): a coordinator picking a racer who already holds a trophy is
   * worth flagging, whatever `Race.oneTrophyPerRacer` is set to — the
   * picker never refuses the pick, only says so. Optional so a caller with
   * no need for the warning (there is currently none) is not forced to
   * thread empty award lists through.
   */
  awards?: AwardFormAward[];
  /** The award being edited, if any — excluded from the collision check so
   * the warning does not fire against the award's own current recipient. */
  excludeAwardId?: number | null;
}

const EMPTY: AwardDraft = {
  name: '',
  // Speed-based (#999): a speed award is right with no further input — it
  // already defaults to the last championship round below, or the
  // qualifying standings when the race has none — whereas a judged award is
  // never right until somebody has been chosen. "Pack Champion" left on the
  // old default silently became a judged, votable award that never
  // resolved.
  kind: 'SPEED',
  source: ALL_SOURCE,
  place: 1,
  fromBottom: false,
  racingGroupId: null,
  racerId: null,
  artworkKey: null,
  // On by default for a new judged award — most of the ones a pack adds are
  // exactly the ones people vote for (#305). Irrelevant until the operator
  // switches to Somebody we choose, since `votable` is forced false for
  // SPEED regardless of what is sent (see `asInput` in `Awards.tsx`).
  votable: true,
};

export default function AwardForm({
  initial,
  rounds,
  racingGroups,
  racers,
  submitLabel,
  onSubmit,
  onCancel,
  awards = [],
  excludeAwardId = null,
}: Props) {
  const { groupLower, orgLower, vehicleLower } = useTerminology();
  // A new speed award defaults to the race's last championship round rather
  // than the qualifying standings, when the race has one (#862). "Pack
  // Champion" created after Grand Finals almost always means the finals;
  // `ALL_SOURCE` is the *qualifying* standings (#17, deliberately — a
  // championship field is drawn from them, so folding the final back in
  // would be circular), and defaulting to it silently announced the
  // qualifying leader rather than the actual champion. Editing an existing
  // award is unaffected: `initial` always wins, spread after this default.
  const defaultSource = lastChampionshipRound(rounds);
  const defaultSpeedSource = defaultSource ? `ROUND:${defaultSource.id}` : ALL_SOURCE;

  // The one place `source`/`place`/`racingGroupId`/`fromBottom` are made to
  // agree with `kind` (#992). Switching *to* SPEED fills a null source/place
  // with the same defaults a fresh award gets — never overwriting a value
  // already there, so toggling kind back and forth does not throw away a
  // choice the operator already made. Switching *to* SPECIAL clears all
  // four: the backend clears them too (`crud._clear_fields_of_other_kind`),
  // but a draft that still holds them is a draft that could send them if a
  // future change to `asInput` ever forgot to ask `draft.kind` first — the
  // very shape #992 was. Called on the initial merge too, which is what
  // fixes an award saved by the bug this closes: opening it for editing
  // used to show a SPEED award with `null` source/place forever, since
  // `initial` was spread *after* the computed default.
  const withKindDefaults = (next: AwardDraft): AwardDraft => {
    if (next.kind === 'SPEED') {
      return {
        ...next,
        source: next.source ?? defaultSpeedSource,
        place: next.place ?? 1,
      };
    }
    return { ...next, source: null, place: null, racingGroupId: null, fromBottom: false };
  };

  const [draft, setDraft] = useState<AwardDraft>(() =>
    withKindDefaults({ ...EMPTY, source: defaultSpeedSource, ...initial }),
  );
  // Which template the picker last applied, purely to show its blurb as help
  // text (#440) — the name and artwork fields it wrote are the only lasting
  // effect, and stay free text from the moment `applyTemplate` runs. Cleared
  // whenever the operator edits the name themselves, so the blurb cannot go
  // on describing an award that no longer matches it.
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const set = <K extends keyof AwardDraft>(key: K, value: AwardDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setKind = (kind: AwardDraft['kind']) =>
    setDraft((current) => withKindDefaults({ ...current, kind }));

  // Writes an ordinary name and artwork key into the draft. Nothing tracks
  // "which template is currently applied" for the *draft* — both fields stay
  // free text the moment this runs, exactly as if the operator had typed them
  // and picked artwork some other way. Choosing the blank option is the
  // explicit way to drop artwork without also clearing a name the operator
  // may have already customised.
  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    if (!id) {
      set('artworkKey', null);
      return;
    }
    const template = templateById(id);
    if (!template) return;
    setDraft((current) => ({
      ...current,
      name: template.name,
      artworkKey: template.artworkKey,
    }));
  };

  const selectedTemplate = selectedTemplateId ? templateById(selectedTemplateId) : undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    onSubmit({ ...draft, name: draft.name.trim() });
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem' }}>
      <div>
        <label htmlFor="award-name" style={{ display: 'block', fontSize: '0.9rem' }}>
          Award name
        </label>
        <input
          id="award-name"
          value={draft.name}
          onChange={(e) => {
            set('name', e.target.value);
            setSelectedTemplateId('');
          }}
          placeholder="e.g. Best Paint, Fastest Wolf"
          className="form-control"
          required
        />
        {/* Non-blocking: a pack can name a judged award anything it likes
            (#999). This only fires while the kind is still Somebody we
            choose — a speed award naming itself "Fastest" is not a mistake
            to flag. */}
        {draft.kind === 'SPECIAL' && soundsLikeSpeedAward(draft.name) && (
          <small style={{ color: 'var(--warning-soft-color)', display: 'block', marginTop: '0.3rem' }}>
            This sounds like a speed award.{' '}
            <button
              type="button"
              onClick={() => setKind('SPEED')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: 'inherit',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Switch Who wins it to Speed-based?
            </button>
          </small>
        )}
      </div>

      <fieldset style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem' }}>
        <legend style={{ fontSize: '0.9rem', padding: '0 0.4rem' }}>Who wins it</legend>
        <label style={{ display: 'block', marginBottom: '0.6rem' }}>
          <input
            type="radio"
            name="award-kind"
            checked={draft.kind === 'SPECIAL'}
            onChange={() => setKind('SPECIAL')}
          />{' '}
          Somebody we choose
          <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.15rem' }}>
            For awards nothing can measure — paint, design, spirit. You can leave it
            undecided for now.
          </small>
        </label>
        <label style={{ display: 'block' }}>
          <input
            type="radio"
            name="award-kind"
            checked={draft.kind === 'SPEED'}
            onChange={() => setKind('SPEED')}
          />{' '}
          Speed-based
          <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.15rem' }}>
            Worked out from the standings — fastest or slowest — so it stays right if
            you correct a time later.
          </small>
        </label>
      </fieldset>

      {draft.kind === 'SPEED' ? (
        <>
          <div>
            <label htmlFor="award-source" style={{ display: 'block', fontSize: '0.9rem' }}>
              Standings to use
            </label>
            <select
              id="award-source"
              // `withKindDefaults` guarantees a non-null `source` whenever
              // `kind === 'SPEED'` — this block only renders in that case
              // (#992). A render-side `?? ALL_SOURCE` fallback here was the
              // bug: it let the select *display* a default the draft never
              // held, so Save sent `null`.
              value={draft.source as string}
              onChange={(e) => set('source', e.target.value)}
              className="form-control"
            >
              {/* Same wording as the Standings page's own selector (#862) —
                  one vocabulary for one concept. "Overall" on its own reads,
                  to a volunteer, as "the whole race, final included", which
                  is the opposite of what it means. */}
              <option value={ALL_SOURCE}>Overall (qualifying rounds)</option>
              {rounds.map((round) => (
                <option key={round.id} value={`ROUND:${round.id}`}>
                  {roundLabel(round)}
                </option>
              ))}
            </select>
            {/* Shown only while Overall is picked, mirroring the Standings
                page's own conditional note (#862) — the one place a speed
                award decides who wins deserves the same warning that page
                already gives about what "Overall" leaves out. */}
            {draft.source === ALL_SOURCE && (
              <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.3rem' }}>
                Overall standings cover the qualifying rounds. Championship results are
                listed separately — pick a round above.
              </small>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '9rem' }}>
              <label
                htmlFor="award-direction"
                style={{ display: 'block', fontSize: '0.9rem' }}
              >
                Counting from
              </label>
              <select
                id="award-direction"
                value={draft.fromBottom ? 'BOTTOM' : 'TOP'}
                onChange={(e) => set('fromBottom', e.target.value === 'BOTTOM')}
                className="form-control"
              >
                <option value="TOP">The fastest {vehicleLower}</option>
                <option value="BOTTOM">The slowest {vehicleLower}</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '9rem' }}>
              <label htmlFor="award-place" style={{ display: 'block', fontSize: '0.9rem' }}>
                Position
              </label>
              <select
                id="award-place"
                // Same invariant as `award-source` above: non-null whenever
                // `kind === 'SPEED'`, maintained by `withKindDefaults`.
                value={draft.place as number}
                onChange={(e) => set('place', Number(e.target.value))}
                className="form-control"
              >
                {[1, 2, 3, 4, 5].map((place) => (
                  <option key={place} value={place}>
                    {positionLabel(place, draft.fromBottom)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '9rem' }}>
              <label htmlFor="award-racing-group" style={{ display: 'block', fontSize: '0.9rem' }}>
                Limited to a {groupLower}
              </label>
              <select
                id="award-racing-group"
                value={draft.racingGroupId ?? ''}
                onChange={(e) => set('racingGroupId', e.target.value ? Number(e.target.value) : null)}
                className="form-control"
              >
                <option value="">The whole {orgLower}</option>
                {racingGroups.map((racingGroup) => (
                  <option key={racingGroup.id} value={racingGroup.id}>
                    {racingGroup.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <label
              htmlFor="award-template"
              style={{ display: 'block', fontSize: '0.9rem' }}
            >
              Start from a ready-made award
            </label>
            <select
              id="award-template"
              value={selectedTemplateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="form-control"
            >
              <option value="">Choose one, or type your own name below</option>
              {AWARD_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.15rem' }}>
              {selectedTemplate
                ? selectedTemplate.blurb
                : 'Fills in the name and its artwork — both stay editable afterward.'}
            </small>
          </div>

          <div>
            <label htmlFor="award-racer" style={{ display: 'block', fontSize: '0.9rem' }}>
              Winner
            </label>
            <select
              id="award-racer"
              value={draft.racerId ?? ''}
              onChange={(e) =>
                set('racerId', e.target.value ? Number(e.target.value) : null)
              }
              className="form-control"
            >
              <option value="">Not decided yet</option>
              {racers.map((racer) => (
                <option key={racer.id} value={racer.id}>
                  {racerLabel(racer)}
                </option>
              ))}
            </select>
            {/* A coordinator picking a racer who already holds another
                award is worth a nudge (#615) — this never blocks the pick,
                since a person's own choice is never overridden by a
                computed rule. */}
            {(() => {
              const warning = awardHolderWarning(draft.racerId, awards, excludeAwardId);
              return warning ? (
                <small style={{ color: 'var(--warning-soft-color)', display: 'block', marginTop: '0.3rem' }}>
                  {warning}
                </small>
              ) : null;
            })()}
          </div>

          <label style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={draft.votable}
              onChange={(e) => set('votable', e.target.checked)}
            />{' '}
            Let people vote for this
            <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.15rem' }}>
              Turn off for an award your {orgLower}'s leaders would rather decide
              privately.
            </small>
          </label>
        </>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button type="button" className="secondary-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary-btn">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
