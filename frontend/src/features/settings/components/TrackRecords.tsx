/**
 * A track's records from before Trusty Track was keeping them.
 *
 * Inside the track's own card in **Tracks**, like the lanes-in-service
 * control and for the same reason: a record is a property of the track. The
 * computed records need no management — they are the heats they came from —
 * so everything here is the hand-entered kind, and the Stats page merges
 * the two on the record board.
 *
 * Saves on action rather than on **Save Settings**: each record is a row
 * with its own mutation, and half-typed records have no business being
 * carried by a form submit that is really about lane counts.
 */

import { useState } from 'react';
import { gql, useMutation } from 'urql';
import { useAlert } from '../../../context/AlertContext';
import { useRunMutation } from '../../../context/runMutation';

const CREATE_TRACK_RECORD = gql`
  mutation CreateTrackRecord($trackId: Int!, $record: HistoricalTrackRecordInput!) {
    createTrackRecord(trackId: $trackId, record: $record) {
      id trackId timeSeconds racerName carNumber raceName raceDate
    }
  }
`;

const UPDATE_TRACK_RECORD = gql`
  mutation UpdateTrackRecord($recordId: Int!, $record: HistoricalTrackRecordInput!) {
    updateTrackRecord(recordId: $recordId, record: $record) {
      id trackId timeSeconds racerName carNumber raceName raceDate
    }
  }
`;

const DELETE_TRACK_RECORD = gql`
  mutation DeleteTrackRecord($recordId: Int!) {
    deleteTrackRecord(recordId: $recordId)
  }
`;

export interface HistoricalRecord {
  id: number;
  timeSeconds: number;
  racerName: string;
  carNumber: number | null;
  raceName: string | null;
  raceDate: string | null;
}

interface Props {
  trackId: number;
  records: HistoricalRecord[];
  onChange: (records: HistoricalRecord[]) => void;
}

interface FormState {
  time: string;
  racerName: string;
  carNumber: string;
  raceName: string;
  raceDate: string;
}

const EMPTY_FORM: FormState = {
  time: '',
  racerName: '',
  carNumber: '',
  raceName: '',
  raceDate: '',
};

export default function TrackRecords({ trackId, records, onChange }: Props) {
  const { showToast } = useAlert();
  const runMutation = useRunMutation();
  const [, createRecord] = useMutation(CREATE_TRACK_RECORD);
  const [, updateRecord] = useMutation(UPDATE_TRACK_RECORD);
  const [, deleteRecord] = useMutation(DELETE_TRACK_RECORD);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const startEditing = (record: HistoricalRecord) => {
    setEditingId(record.id);
    setForm({
      time: record.timeSeconds.toString(),
      racerName: record.racerName,
      carNumber: record.carNumber?.toString() ?? '',
      raceName: record.raceName ?? '',
      raceDate: record.raceDate ?? '',
    });
  };

  const stopEditing = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const save = async () => {
    const time = parseFloat(form.time);
    if (!(time > 0)) {
      showToast('A record time must be more than zero seconds.', 'error');
      return;
    }
    if (!form.racerName.trim()) {
      showToast('A record names the racer who set it.', 'error');
      return;
    }
    const record = {
      timeSeconds: time,
      racerName: form.racerName.trim(),
      carNumber: form.carNumber ? parseInt(form.carNumber) : null,
      raceName: form.raceName.trim() || null,
      raceDate: form.raceDate || null,
    };
    setBusy(true);
    const response = editingId
      ? await runMutation(updateRecord, { recordId: editingId, record }, 'The record could not be saved.')
      : await runMutation(createRecord, { trackId, record }, 'The record could not be saved.');
    setBusy(false);
    if (!response) return;
    const saved: HistoricalRecord = editingId
      ? response.data.updateTrackRecord
      : response.data.createTrackRecord;
    const next = editingId
      ? records.map((r) => (r.id === editingId ? saved : r))
      : [...records, saved];
    onChange([...next].sort((a, b) => a.timeSeconds - b.timeSeconds));
    stopEditing();
  };

  const remove = async (recordId: number) => {
    setBusy(true);
    const response = await runMutation(
      deleteRecord,
      { recordId },
      'The record could not be removed.',
    );
    setBusy(false);
    if (!response) return;
    if (editingId === recordId) stopEditing();
    onChange(records.filter((r) => r.id !== recordId));
  };

  return (
    <div style={{ marginTop: '1rem' }} data-testid="track-records">
      <span style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
        Track records from past years
      </span>
      {records.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem 0' }}>
          {records.map((record) => (
            <li
              key={record.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.3rem 0',
                fontSize: '0.9rem',
              }}
            >
              <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                {record.timeSeconds.toFixed(3)}s
              </span>
              <span>
                {record.racerName}
                {record.carNumber != null && ` (Car #${record.carNumber})`}
                {record.raceName && ` — ${record.raceName}`}
                {record.raceDate && `, ${record.raceDate}`}
              </span>
              <button
                type="button"
                onClick={() => startEditing(record)}
                disabled={busy}
                aria-label={`Edit the record held by ${record.racerName}`}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✏️
              </button>
              <button
                type="button"
                onClick={() => remove(record.id)}
                disabled={busy}
                aria-label={`Remove the record held by ${record.racerName}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          type="number"
          step="0.001"
          min="0.001"
          placeholder="Time (s)"
          aria-label="Record time in seconds"
          value={form.time}
          onChange={(e) => set('time')(e.target.value)}
          className="form-control"
          style={{ width: '6.5rem' }}
        />
        <input
          type="text"
          placeholder="Racer's name"
          aria-label="Who set the record"
          value={form.racerName}
          onChange={(e) => set('racerName')(e.target.value)}
          className="form-control"
          style={{ width: 'auto', flex: 1, minWidth: '9rem' }}
        />
        <input
          type="number"
          placeholder="Car #"
          aria-label="Car number (optional)"
          value={form.carNumber}
          onChange={(e) => set('carNumber')(e.target.value)}
          className="form-control"
          style={{ width: '5rem' }}
        />
        <input
          type="text"
          placeholder="Event (e.g. Derby 2019)"
          aria-label="Which event it was set at (optional)"
          value={form.raceName}
          onChange={(e) => set('raceName')(e.target.value)}
          className="form-control"
          style={{ width: 'auto', flex: 1, minWidth: '10rem' }}
        />
        <input
          type="date"
          aria-label="When it was set (optional)"
          value={form.raceDate}
          onChange={(e) => set('raceDate')(e.target.value)}
          className="form-control"
          style={{ width: 'auto' }}
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          style={{
            padding: '0.4rem 0.9rem',
            borderRadius: '4px',
            border: 'none',
            background: 'var(--scouting-blue)',
            color: 'var(--on-primary-color)',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {editingId ? 'Save change' : 'Add record'}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={stopEditing}
            disabled={busy}
            className="form-control"
            style={{ width: 'auto', background: 'var(--surface-color)', cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
      </div>
      <small style={{ color: 'var(--text-muted-color)' }}>
        For records set before you used Trusty Track. They appear on the Stats
        page's record board, exactly as entered, until a faster time beats
        them. Saved as soon as you add one.
      </small>
    </div>
  );
}
