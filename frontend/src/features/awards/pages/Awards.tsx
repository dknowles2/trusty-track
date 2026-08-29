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
import StatusBanner from '../../../components/ui/StatusBanner';
import { useAlert } from '../../../context/AlertContext';
import { useRunMutation } from '../../../context/runMutation';
import { errorText } from '../../../utils/errors';
import AwardArtwork from '../artwork';
import { carLabel, describeSpeedAward, racerLabel } from '../awardText';
import AwardForm, { AwardDraft } from '../components/AwardForm';
import BallotShare from '../components/BallotShare';
import {
  CREATE_AWARD_MUTATION,
  DELETE_AWARD_MUTATION,
  RACE_AWARDS_QUERY,
  REORDER_AWARDS_MUTATION,
  UPDATE_AWARD_MUTATION,
  UPDATE_RACE_VOTING_MUTATION,
} from '../graphql/queries';
import { readAppTheme } from '../../../theming/appTheme';
import { themeByKey } from '../../../theming/themes';

type VoteTallyRow = {
  racerId: number;
  voteCount: number;
  racer?: { id: number; carNumber?: number | null; carName?: string | null } | null;
};

type AwardRow = {
  id: number;
  name: string;
  kind: string;
  source?: string | null;
  place?: number | null;
  racingGroupId?: number | null;
  fromBottom?: boolean | null;
  artworkKey?: string | null;
  votable?: boolean | null;
  voteTally?: VoteTallyRow[] | null;
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
  const { showConfirm } = useAlert();
  const runMutation = useRunMutation();

  // The App surface's own theme (#498), read once per render — this device's
  // `localStorage`, never the server. Under the Lights is the only one of
  // the seven where this matters: its Awards list sits on a dark
  // background, and without this every trophy's outline was drawn in the
  // App's blue against a background nearly the same colour (the exact bug
  // `variant` exists to prevent, just relocated from a hardcoded literal to
  // a hardcoded assumption about which theme was active).
  const appIsDark = themeByKey(readAppTheme()).app.isDark;

  const [result, refetch] = useQuery({
    query: RACE_AWARDS_QUERY,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });
  const [, createAward] = useMutation(CREATE_AWARD_MUTATION);
  const [, updateAward] = useMutation(UPDATE_AWARD_MUTATION);
  const [, deleteAward] = useMutation(DELETE_AWARD_MUTATION);
  const [, reorderAwards] = useMutation(REORDER_AWARDS_MUTATION);
  const [, updateRaceVoting] = useMutation(UPDATE_RACE_VOTING_MUTATION);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AwardRow | null>(null);

  const race = result.data?.race;
  const awards: AwardRow[] = useMemo(() => race?.awards ?? [], [race]);
  const rounds = race?.rounds ?? [];
  const racingGroups = race?.racingGroups ?? [];
  const racers = race?.racers ?? [];
  const votingOpen = race?.votingOpen ?? false;
  // The ballot shows every car's photo (or a gray placeholder where there is
  // none) beside a name and number — for an award about the car's looks, a
  // room of placeholders is worse than no ballot at all (#419). The operator
  // sees this before opening voting, not after a parent notices.
  const missingPhotoCount = racers.filter(
    (racer: { carImageUrl?: string | null }) => !racer.carImageUrl,
  ).length;

  if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

  const asInput = (draft: AwardDraft) => ({
    name: draft.name,
    kind: draft.kind,
    source: draft.kind === 'SPEED' ? draft.source : null,
    place: draft.kind === 'SPEED' ? draft.place : null,
    fromBottom: draft.kind === 'SPEED' ? draft.fromBottom : false,
    racingGroupId: draft.kind === 'SPEED' ? draft.racingGroupId : null,
    racerId: draft.kind === 'SPECIAL' ? draft.racerId : null,
    // A SPEED award's key comes from its rule server-side (crud
    // ._set_speed_artwork_key) regardless of what is sent — this is only
    // meaningful for SPECIAL, same as racerId above.
    artworkKey: draft.kind === 'SPECIAL' ? draft.artworkKey : null,
    // Forced false server-side for SPEED regardless of what is sent
    // (crud._clear_fields_of_other_kind) — same shape as artworkKey above.
    votable: draft.kind === 'SPECIAL' ? draft.votable : false,
  });

  const toggleVoting = async () => {
    const response = await runMutation(
      updateRaceVoting,
      { id, race: { votingOpen: !votingOpen } },
      'Voting could not be changed.',
    );
    if (!response) return;
    refetch({ requestPolicy: 'network-only' });
  };

  const applyTallyWinner = async (award: AwardRow, racerId: number) => {
    const response = await runMutation(
      updateAward,
      {
        id: award.id,
        award: {
          name: award.name,
          kind: 'SPECIAL',
          racerId,
          artworkKey: award.artworkKey ?? null,
          votable: award.votable ?? false,
        },
      },
      'The winner could not be set.',
    );
    if (!response) return;
    refetch({ requestPolicy: 'network-only' });
  };

  const handleCreate = async (draft: AwardDraft) => {
    const response = await runMutation(
      createAward,
      { raceId: id, award: asInput(draft) },
      'The award could not be added.',
    );
    if (!response) return;
    setAdding(false);
    refetch({ requestPolicy: 'network-only' });
  };

  const handleUpdate = async (draft: AwardDraft) => {
    if (!editing) return;
    const response = await runMutation(
      updateAward,
      { id: editing.id, award: asInput(draft) },
      'The award could not be saved.',
    );
    if (!response) return;
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
    const response = await runMutation(
      deleteAward,
      { id: award.id },
      'The award could not be removed.',
    );
    if (!response) return;
    refetch({ requestPolicy: 'network-only' });
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= awards.length) return;
    const order = awards.map((a) => a.id);
    [order[index], order[target]] = [order[target], order[index]];
    const response = await runMutation(
      reorderAwards,
      { raceId: id, awardIds: order },
      'The awards could not be reordered.',
    );
    if (!response) return;
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
          borderBottom: '1px solid var(--divider-color)',
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
          {/* The certificate print page, next to the ceremony route it pairs
              with — one is for the room, the other for the wall afterward. */}
          <Link to={`/race/${id}/print/certificates`} className="secondary-btn">
            Print certificates
          </Link>
          <button type="button" className="primary-btn" onClick={() => setAdding(true)}>
            Add an award
          </button>
        </div>
      </div>

      {awards.length > 0 && (
        <StatusBanner tone={votingOpen ? 'active' : 'neutral'} style={{ marginBottom: '1.5rem' }}>
          <button
            type="button"
            className={votingOpen ? 'secondary-btn' : 'primary-btn'}
            onClick={toggleVoting}
          >
            {votingOpen ? 'Close voting' : 'Open voting'}
          </button>
          <strong>Voting is {votingOpen ? 'open' : 'closed'}</strong>
          {votingOpen && <BallotShare raceId={id} />}
          {missingPhotoCount > 0 && (
            <span style={{ flexBasis: '100%', color: 'var(--warning-alt-color)' }}>
              {missingPhotoCount} of {racers.length} cars have no photo — voters will see a
              gray square instead. <Link to={`/race/${id}`}>Upload photos</Link> from the
              roster.
            </span>
          )}
        </StatusBanner>
      )}

      {result.fetching && awards.length === 0 && <p>Loading…</p>}
      {result.error && (
        <p style={{ color: 'var(--error)' }}>
          {errorText(result.error, 'The awards could not be loaded.')}
        </p>
      )}

      {!result.fetching && awards.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted-color)' }}>
          <Icon path={mdiTrophyOutline} size={2} color="var(--input-border-color)" />
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
              flexDirection: 'column',
              gap: '0.6rem',
              padding: '0.85rem 1rem',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              background: 'var(--surface-color)',
            }}
          >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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

            {award.artworkKey && (
              <AwardArtwork
                artworkKey={award.artworkKey}
                size={32}
                variant={appIsDark ? 'dark' : 'light'}
              />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{award.name}</strong>
              <div style={{ color: 'var(--text-muted-color)', fontSize: '0.9rem' }}>
                {award.kind === 'SPEED'
                  ? describeSpeedAward(award, rounds, racingGroups)
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
                <em style={{ color: 'var(--text-faint-color)' }}>
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
          </div>

          {award.votable && award.voteTally && award.voteTally.length > 0 && (
            <div
              style={{
                borderTop: '1px solid var(--divider-color)',
                paddingTop: '0.6rem',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '0.6rem 1rem',
              }}
            >
              <strong style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>Votes:</strong>
              {award.voteTally.map((row) => (
                <span key={row.racerId} style={{ fontSize: '0.9rem' }}>
                  {carLabel(row.racer)} — {row.voteCount}
                  {row.racer && (
                    <button
                      type="button"
                      className="secondary-btn"
                      style={{ marginLeft: '0.4rem', padding: '0.1rem 0.4rem' }}
                      onClick={() => applyTallyWinner(award, row.racerId)}
                    >
                      Use this result
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          </li>
        ))}
      </ol>

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add an award">
        <AwardForm
          rounds={rounds}
          racingGroups={racingGroups}
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
              fromBottom: editing.fromBottom ?? false,
              racingGroupId: editing.racingGroupId ?? null,
              // Only for a special award. A speed award's recipient is
              // computed, and seeding it here would turn "switch this to a
              // judged award" into "give it permanently to whoever happens to
              // be fastest right now".
              racerId: editing.kind === 'SPECIAL' ? (editing.recipient?.id ?? null) : null,
              artworkKey: editing.artworkKey ?? null,
              votable: editing.votable ?? false,
            }}
            rounds={rounds}
            racingGroups={racingGroups}
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
