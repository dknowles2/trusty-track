import React, { useEffect, useRef, useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { Icon } from '@mdi/react';
import { mdiClose, mdiPlus } from '@mdi/js';
import { RacerCombobox, type RacerOption } from '../../management/components/RacerCombobox';
import { useTerminology } from '../../../context/TerminologyContext';

interface PickRow {
  id: string;
  racerId: number | null;
}

let rowSeq = 0;
function newRow(racerId: number | null = null): PickRow {
  rowSeq += 1;
  return { id: `pick-${rowSeq}`, racerId };
}

interface PickFieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The round this line-up belongs to — used only for the title, so a
   * blank string while nothing is selected renders an empty (but valid)
   * heading rather than a crash. */
  roundName: string;
  /** What the standings currently suggest, so the operator can see what a
   * hand pick is choosing to differ from — `null` when there is nothing yet
   * to compare against (`advancementStatus.numRacers` unset). */
  suggestionLabel: string | null;
  /** Every racer this pick may draw from — checked-in racers only (#228):
   * a hand pick does not override check-in, so a car missing here needs to
   * be checked in first. */
  checkedInRacers: RacerOption[];
  /** The round's current pick if it is already hand-picked, or the
   * standings' own suggestion otherwise — both arrive the same way, off
   * `advancementStatus.advancingRacers[].isAdvancing` (#711), so this modal
   * does not need to know which case it is in. */
  initialRacerIds: number[];
  onSubmit: (racerIds: number[]) => Promise<void>;
}

/**
 * Choosing a championship round's line-up by hand (#711).
 *
 * Reuses `RacerCombobox` — one row per pick, each filtering out whoever is
 * already chosen in another row, the same "taken by another slot" rule
 * `FreeRaceLaneSetup`'s manual lane assignment already follows. Unlike a
 * free-race lane, though, there is no fixed slot count: `advancement_num_racers`
 * is a suggestion the backend does not enforce, so rows can be added or
 * removed freely, with a floor of two (`hand_pick_problem`'s own floor —
 * a one-racer "final" is not a race).
 */
export const PickFieldModal: React.FC<PickFieldModalProps> = ({
  isOpen,
  onClose,
  roundName,
  suggestionLabel,
  checkedInRacers,
  initialRacerIds,
  onSubmit,
}) => {
  const { vehicleLower, vehiclesLower } = useTerminology();
  const [rows, setRows] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Seeded from the round's current pick (or the standings' own suggestion)
  // on the open transition only, the same shape `RoundConfigModal` resets
  // on — this modal stays mounted so the parent need not remount it per
  // round, and re-seeding on every render would fight an operator who has
  // already started editing the rows.
  // Starts `false` rather than mirroring `isOpen`, unlike `RoundConfigModal`'s
  // own version of this ref: that modal's un-seeded defaults are already
  // correct (an empty name, the General tab), so nothing depends on the
  // reset firing on a first mount that opens straight into `isOpen={true}`
  // (the ordinary case here — the parent renders this modal only once a
  // round exists to seed it from). This one's rows start empty, so the
  // first render-after-mount has to see a transition too, or a modal
  // mounted already open would show no rows at all.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setRows(
        initialRacerIds.length > 0
          ? initialRacerIds.map((racerId) => newRow(racerId))
          : [newRow(), newRow()]
      );
    }
    wasOpen.current = isOpen;
  }, [isOpen, initialRacerIds]);

  const pickedIds = rows
    .map((r) => r.racerId)
    .filter((racerId): racerId is number => racerId != null);
  const canSubmit = pickedIds.length >= 2 && !loading;

  const handleAddRow = () => setRows((prev) => [...prev, newRow()]);
  const handleRemoveRow = (id: string) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  const handleRowChange = (id: string, racerId: number | undefined) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, racerId: racerId ?? null } : r)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      await onSubmit(pickedIds);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '0.5rem',
    fontWeight: 'bold',
    fontSize: '0.9rem',
    color: 'var(--text-color)'
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Pick ${roundName || 'this round'}'s line-up`} maxWidth="500px">
      <form onSubmit={handleSubmit}>
        <p style={{ marginTop: 0, marginBottom: '15px', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
          Choose exactly who races in this round. Only checked-in {vehiclesLower} can be
          picked — check the {vehicleLower} in first if it is missing below.
          {suggestionLabel && ` The standings currently suggest ${suggestionLabel}.`}
        </p>

        <label style={labelStyle}>Line-up</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
          {rows.map((row) => (
            <div key={row.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <RacerCombobox
                racers={checkedInRacers.filter(
                  (r) => !rows.some((other) => other.id !== row.id && other.racerId === r.id)
                )}
                value={row.racerId ?? undefined}
                onChange={(racerId) => handleRowChange(row.id, racerId)}
                placeholder="— Select racer —"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => handleRemoveRow(row.id)}
                disabled={rows.length <= 1 || loading}
                aria-label="Remove from line-up"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted-color)',
                  cursor: rows.length <= 1 ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  opacity: rows.length <= 1 ? 0.4 : 1,
                  display: 'flex'
                }}
              >
                <Icon path={mdiClose} size={0.8} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleAddRow}
          className="secondary-btn"
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '15px' }}
        >
          <Icon path={mdiPlus} size={0.7} /> Add another
        </button>

        {pickedIds.length < 2 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--warning-soft-color)', margin: '0 0 15px' }}>
            Pick at least two racers.
          </p>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid var(--divider-color)', paddingTop: '20px' }}>
          <button type="button" onClick={onClose} className="secondary-btn" disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={!canSubmit}>
            {loading ? 'Saving...' : 'Save line-up'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
