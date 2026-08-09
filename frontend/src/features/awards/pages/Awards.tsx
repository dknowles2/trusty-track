/**
 * The awards a race hands out, and who has won them (#170).
 *
 * Listed in presentation order, because that is the order they get announced
 * in and reordering them is most of what an operator does here after the first
 * time. A speed award shows its rule and its current holder side by side, which
 * is the reassurance that matters: "Fastest Wolf — Ada Lovelace" is how you
 * know the standings agree with the trophy you are about to hand over.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiArrowDown, mdiArrowUp, mdiPencil, mdiTrashCan, mdiTrophyOutline } from '@mdi/js';
import Modal from '../../../components/ui/Modal';
import { useAlert } from '../../../context/AlertContext';
import { describeSpeedAward, racerLabel } from '../awardText';
import AwardForm, { AwardDraft } from '../components/AwardForm';
import {
  CREATE_AWARD_MUTATION,
  DELETE_AWARD_MUTATION,
  RACE_AWARDS_QUERY,
  REORDER_AWARDS_MUTATION,
  UPDATE_AWARD_MUTATION,
} from '../graphql/queries';

type AwardRow = {
  id: number;
  name: string;
  kind: string;
  source?: string | null;
  place?: number | null;
  denId?: number | null;
  recipient?: {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
    racerImageUrl?: string | null;
  } | null;
};

export default function Awards() {
  const { raceId } = useParams<{ raceId: string }>();
  const id = parseInt(raceId || '0');
  const { showConfirm, showToast } = useAlert();

  const [result, refetch] = useQuery({
    query: RACE_AWARDS_QUERY,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });
  const [, createAward] = useMutation(CREATE_AWARD_MUTATION);
  const [, updateAward] = useMutation(UPDATE_AWARD_MUTATION);
  const [, deleteAward] = useMutation(DELETE_AWARD_MUTATION);
  const [, reorderAwards] = useMutation(REORDER_AWARDS_MUTATION);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AwardRow | null>(null);

  const race = result.data?.race;
  const awards: AwardRow[] = useMemo(() => race?.awards ?? [], [race]);
  const rounds = race?.rounds ?? [];
  const dens = race?.dens ?? [];
  const racers = race?.racers ?? [];

  if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

  const asInput = (draft: AwardDraft) => ({
    name: draft.name,
    kind: draft.kind,
    source: draft.kind === 'SPEED' ? draft.source : null,
    place: draft.kind === 'SPEED' ? draft.place : null,
    denId: draft.kind === 'SPEED' ? draft.denId : null,
    racerId: draft.kind === 'SPECIAL' ? draft.racerId : null,
  });

  const handleCreate = async (draft: AwardDraft) => {
    const response = await createAward({ raceId: id, award: asInput(draft) });
    if (response.error) {
      showToast(response.error.message, 'error');
      return;
    }
    setAdding(false);
    refetch({ requestPolicy: 'network-only' });
  };

  const handleUpdate = async (draft: AwardDraft) => {
    if (!editing) return;
    const response = await updateAward({ id: editing.id, award: asInput(draft) });
    if (response.error) {
      showToast(response.error.message, 'error');
      return;
    }
    setEditing(null);
    refetch({ requestPolicy: 'network-only' });
  };

  const handleDelete = async (award: AwardRow) => {
    const confirmed = await showConfirm(
      `Remove “${award.name}” from this race's awards?`,
      'Delete award',
      'Delete',
      'danger',
    );
    if (!confirmed) return;
    const response = await deleteAward({ id: award.id });
    if (response.error) {
      showToast(response.error.message, 'error');
      return;
    }
    refetch({ requestPolicy: 'network-only' });
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= awards.length) return;
    const order = awards.map((a) => a.id);
    [order[index], order[target]] = [order[target], order[index]];
    const response = await reorderAwards({ raceId: id, awardIds: order });
    if (response.error) {
      showToast(response.error.message, 'error');
      return;
    }
    refetch({ requestPolicy: 'network-only' });
  };

  return (
    <div className="container" style={{ padding: '2rem' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '15px',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
          borderBottom: '1px solid #eee',
          paddingBottom: '1rem',
        }}
      >
        {/* The row held only its buttons once the mode toggle went, so it read
            as an empty bar with a rule under it. */}
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Awards</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {/* Opens the ceremony on this screen. It is an ordinary route, so it
              is also the address to point a projector at. */}
          <Link to={`/race/${id}/awards/present`} className="secondary-btn">
            Present
          </Link>
          <button type="button" className="primary-btn" onClick={() => setAdding(true)}>
            Add an award
          </button>
        </div>
      </div>

      {result.fetching && awards.length === 0 && <p>Loading…</p>}
      {result.error && <p style={{ color: '#b60205' }}>{result.error.message}</p>}

      {!result.fetching && awards.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#666' }}>
          <Icon path={mdiTrophyOutline} size={2} color="#ccc" />
          <p style={{ marginTop: '1rem' }}>
            No awards yet. Add the ones your pack hands out — Best Paint and Most
            Original as well as the fast ones.
          </p>
        </div>
      )}

      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
        {awards.map((award, index) => (
          <li
            key={award.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '0.85rem 1rem',
              border: '1px solid #ddd',
              borderRadius: '12px',
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <button
                type="button"
                className="secondary-btn"
                aria-label={`Move ${award.name} earlier`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                style={{ padding: '2px 6px' }}
              >
                <Icon path={mdiArrowUp} size={0.7} />
              </button>
              <button
                type="button"
                className="secondary-btn"
                aria-label={`Move ${award.name} later`}
                disabled={index === awards.length - 1}
                onClick={() => move(index, 1)}
                style={{ padding: '2px 6px' }}
              >
                <Icon path={mdiArrowDown} size={0.7} />
              </button>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{award.name}</strong>
              <div style={{ color: '#666', fontSize: '0.9rem' }}>
                {award.kind === 'SPEED'
                  ? describeSpeedAward(award, rounds, dens)
                  : 'Chosen by the judges'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
              {award.recipient ? (
                <>
                  {award.recipient.racerImageUrl && (
                    <img
                      src={award.recipient.racerImageUrl}
                      alt=""
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                  <span>{racerLabel(award.recipient)}</span>
                </>
              ) : (
                <em style={{ color: '#999' }}>
                  {award.kind === 'SPEED' ? 'Not decided by the racing yet' : 'Nobody yet'}
                </em>
              )}
            </div>

            <button
              type="button"
              className="secondary-btn"
              aria-label={`Edit ${award.name}`}
              onClick={() => setEditing(award)}
            >
              <Icon path={mdiPencil} size={0.8} />
            </button>
            <button
              type="button"
              className="secondary-btn"
              aria-label={`Delete ${award.name}`}
              onClick={() => handleDelete(award)}
            >
              <Icon path={mdiTrashCan} size={0.8} />
            </button>
          </li>
        ))}
      </ol>

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add an award">
        <AwardForm
          rounds={rounds}
          dens={dens}
          racers={racers}
          submitLabel="Add award"
          onSubmit={handleCreate}
          onCancel={() => setAdding(false)}
        />
      </Modal>

      <Modal isOpen={editing !== null} onClose={() => setEditing(null)} title="Edit award">
        {editing && (
          <AwardForm
            initial={{
              name: editing.name,
              kind: editing.kind === 'SPEED' ? 'SPEED' : 'SPECIAL',
              source: editing.source ?? null,
              place: editing.place ?? null,
              denId: editing.denId ?? null,
              // Only for a special award. A speed award's recipient is
              // computed, and seeding it here would turn "switch this to a
              // judged award" into "give it permanently to whoever happens to
              // be fastest right now".
              racerId: editing.kind === 'SPECIAL' ? (editing.recipient?.id ?? null) : null,
            }}
            rounds={rounds}
            dens={dens}
            racers={racers}
            submitLabel="Save changes"
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
