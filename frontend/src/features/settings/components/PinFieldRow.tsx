/**
 * One PIN field, with the Remove control that used not to exist (#192).
 *
 * Both PINs need the same three states — leave alone, change, remove — and the
 * roster's status cell is the standing reminder of what happens when the same
 * thing is drawn twice: it gets fixed in one of them.
 *
 * Removal is staged rather than immediate. It takes effect on **Save
 * Settings** like everything else on this page, so the operator can change
 * their mind, and so there is only one button on the page that writes. The
 * lane outage control does save on click, and says so — the difference is that
 * a lane goes out of service mid-event with cars waiting, and a PIN does not.
 *
 * The input is `type="password"` (#790) — these are typed at a table with
 * people around, sometimes on a screen a room can see. No show/hide toggle:
 * a four-digit code is short enough that masking costs little as you type
 * it, and the row already carries a Remove control — a third control would
 * lengthen the row and the tab order for a check-in desk that reaches for
 * this rarely. `inputMode="numeric"` stays, and stays respected: it is not
 * tied to the input's `type`.
 */

import { canRemove, pinHelp, type PinField } from '../pinFields';

type Props = {
  id: string;
  label: string;
  optional?: boolean;
  /** Whether a PIN is currently set. Only then can removal be offered. */
  isSet: boolean;
  placeholder: string;
  /** What this PIN is for, appended to whatever the field is currently doing. */
  what: string;
  field: PinField;
  onChange: (field: PinField) => void;
};

export default function PinFieldRow({
  id,
  label,
  optional,
  isSet,
  placeholder,
  what,
  field,
  onChange,
}: Props) {
  return (
    <div style={{ flex: 1 }}>
      <label htmlFor={id} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
        {label}{' '}
        {optional && <span style={{ fontWeight: 'normal', color: 'var(--text-muted-color)' }}>(optional)</span>}
      </label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="password"
          inputMode="numeric"
          id={id}
          value={field.value}
          disabled={field.remove}
          onChange={(e) => onChange({ ...field, value: e.target.value })}
          placeholder={field.remove ? 'Will be removed' : placeholder}
          style={{
            flex: 1,
            padding: '0.4rem',
            borderRadius: '4px',
            border: '1px solid var(--input-border-color)',
            background: field.remove ? 'var(--surface-removed-color)' : 'var(--surface-color)',
          }}
        />
        {canRemove(isSet) && (
          <button
            type="button"
            data-testid={`${id}-remove`}
            onClick={() => onChange({ value: '', remove: !field.remove })}
            style={{
              padding: '0.4rem 0.7rem',
              borderRadius: '4px',
              border: '1px solid var(--input-border-color)',
              background: field.remove ? 'var(--cub-scouting-gold)' : 'var(--surface-color)',
              color: field.remove ? 'var(--scouting-blue)' : 'var(--error)',
              fontSize: '0.85rem',
              whiteSpace: 'nowrap',
            }}
          >
            {field.remove ? 'Keep' : 'Remove'}
          </button>
        )}
      </div>
      <small style={{ color: field.remove ? 'var(--error)' : 'var(--text-muted-color)' }}>
        {pinHelp(field, isSet, what)}
      </small>
    </div>
  );
}
