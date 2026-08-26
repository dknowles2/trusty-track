/**
 * Defining one award (#170).
 *
 * The form is really two forms behind one kind switch, because the two kinds
 * of award have nothing in common but a name. A `SPEED` award needs a source, a
 * place and optionally a den; a `SPECIAL` award needs a person. Showing both
 * halves at once and letting the server sort it out would put the operator in
 * front of four controls that do nothing.
 */

import { useState } from 'react';
import {
  NamedDen,
  NamedRound,
  PACK_SOURCE,
  positionLabel,
  racerLabel,
  roundLabel,
} from '../awardText';

export interface AwardDraft {
  name: string;
  kind: 'SPEED' | 'SPECIAL';
  source: string | null;
  place: number | null;
  fromBottom: boolean;
  denId: number | null;
  racerId: number | null;
}

export interface AwardFormRacer {
  id: number;
  firstName: string;
  lastName: string;
  carNumber?: number | null;
}

interface Props {
  initial?: Partial<AwardDraft>;
  rounds: NamedRound[];
  dens: NamedDen[];
  racers: AwardFormRacer[];
  submitLabel: string;
  onSubmit: (draft: AwardDraft) => void;
  onCancel: () => void;
}

const EMPTY: AwardDraft = {
  name: '',
  kind: 'SPECIAL',
  source: PACK_SOURCE,
  place: 1,
  fromBottom: false,
  denId: null,
  racerId: null,
};

const inputStyle = {
  width: '100%',
  padding: '0.5rem',
  borderRadius: '4px',
  border: '1px solid #ccc',
};

export default function AwardForm({
  initial,
  rounds,
  dens,
  racers,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<AwardDraft>({ ...EMPTY, ...initial });

  const set = <K extends keyof AwardDraft>(key: K, value: AwardDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

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
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Best Paint, Fastest Wolf"
          style={inputStyle}
          required
        />
      </div>

      <fieldset style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '0.75rem' }}>
        <legend style={{ fontSize: '0.9rem', padding: '0 0.4rem' }}>Who wins it</legend>
        <label style={{ display: 'block', marginBottom: '0.35rem' }}>
          <input
            type="radio"
            name="award-kind"
            checked={draft.kind === 'SPECIAL'}
            onChange={() => set('kind', 'SPECIAL')}
          />{' '}
          Somebody we choose
        </label>
        <label style={{ display: 'block' }}>
          <input
            type="radio"
            name="award-kind"
            checked={draft.kind === 'SPEED'}
            onChange={() => set('kind', 'SPEED')}
          />{' '}
          Speed-based
        </label>
        <small style={{ color: '#666', display: 'block', marginTop: '0.4rem' }}>
          {draft.kind === 'SPEED'
            ? 'Worked out from the standings — fastest or slowest — so it stays right if you correct a time later.'
            : 'For awards nothing can measure — paint, design, spirit. You can leave it undecided for now.'}
        </small>
      </fieldset>

      {draft.kind === 'SPEED' ? (
        <>
          <div>
            <label htmlFor="award-source" style={{ display: 'block', fontSize: '0.9rem' }}>
              Standings to use
            </label>
            <select
              id="award-source"
              value={draft.source ?? PACK_SOURCE}
              onChange={(e) => set('source', e.target.value)}
              style={inputStyle}
            >
              <option value={PACK_SOURCE}>Overall standings</option>
              {rounds.map((round) => (
                <option key={round.id} value={`ROUND:${round.id}`}>
                  {roundLabel(round)}
                </option>
              ))}
            </select>
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
                style={inputStyle}
              >
                <option value="TOP">The fastest car</option>
                <option value="BOTTOM">The slowest car</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '9rem' }}>
              <label htmlFor="award-place" style={{ display: 'block', fontSize: '0.9rem' }}>
                Position
              </label>
              <select
                id="award-place"
                value={draft.place ?? 1}
                onChange={(e) => set('place', Number(e.target.value))}
                style={inputStyle}
              >
                {[1, 2, 3, 4, 5].map((place) => (
                  <option key={place} value={place}>
                    {positionLabel(place, draft.fromBottom)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '9rem' }}>
              <label htmlFor="award-den" style={{ display: 'block', fontSize: '0.9rem' }}>
                Limited to a den
              </label>
              <select
                id="award-den"
                value={draft.denId ?? ''}
                onChange={(e) => set('denId', e.target.value ? Number(e.target.value) : null)}
                style={inputStyle}
              >
                <option value="">The whole pack</option>
                {dens.map((den) => (
                  <option key={den.id} value={den.id}>
                    {den.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="award-racer" style={{ display: 'block', fontSize: '0.9rem' }}>
            Winner
          </label>
          <select
            id="award-racer"
            value={draft.racerId ?? ''}
            onChange={(e) => set('racerId', e.target.value ? Number(e.target.value) : null)}
            style={inputStyle}
          >
            <option value="">Not decided yet</option>
            {racers.map((racer) => (
              <option key={racer.id} value={racer.id}>
                {racerLabel(racer)}
              </option>
            ))}
          </select>
        </div>
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
