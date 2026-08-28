/**
 * Vote for the judged awards from a phone in the room (#305).
 *
 * The one route a phone holding no PIN may act through — `VIEWER` may run
 * exactly one mutation, `castVote`, and only while `Race.votingOpen` is true
 * (`api/auth.py`'s `VOTE_MUTATIONS`). This page is the whole reason that
 * exception exists: no login, just an address shared around the room.
 *
 * **Cars only, never children.** The query behind this page
 * (`VOTING_BALLOT_QUERY`) asks for `carNumber`, `carName` and `carImageUrl`
 * and nothing else — no racer name, no `racerImageUrl`. Enforcing that here,
 * in what this page asks for, is deliberate: queries carry no role check
 * anywhere in this app, so anonymity is a property of this one query, not of
 * the server.
 *
 * **No device lock.** A shared iPad passes from hand to hand all day, so a
 * vote just cast does not block the next one — it only shows a short
 * confirmation and lets whoever is holding the phone vote again, on the same
 * award or a different one. `ballotKey` is generated fresh per vote
 * (`crypto.randomUUID()`), so it only protects one submission against being
 * doubled by a retry, never against a second, third or fortieth vote from
 * this device.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from 'urql';
import { useChrome } from '../../../context/ChromeContext';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import { CAST_VOTE_MUTATION, VOTING_BALLOT_QUERY } from '../graphql/queries';

type BallotCar = {
  id: number;
  carNumber?: number | null;
  carName?: string | null;
  carImageUrl?: string | null;
};

type BallotAward = {
  id: number;
  name: string;
  kind: string;
  votable?: boolean | null;
};

function newBallotKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // A browser old enough to lack `randomUUID` still needs *a* fresh key per
  // vote — this is not a security boundary, only an idempotency token.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Car number ascending, unnumbered last — the same shape
 * `printables/documents.ts`'s `inPrintOrder` uses, but with nothing to fall
 * back to but the id: this page never has a racer's name to sort by. */
function forBallot(cars: BallotCar[]): BallotCar[] {
  return [...cars].sort((a, b) => {
    const hasA = a.carNumber != null;
    const hasB = b.carNumber != null;
    if (hasA && hasB) return (a.carNumber as number) - (b.carNumber as number);
    if (hasA) return -1;
    if (hasB) return 1;
    return a.id - b.id;
  });
}

export default function VotingBallot() {
  const { raceId } = useParams<{ raceId: string }>();
  const id = parseInt(raceId || '0');
  const { showToast } = useAlert();

  // A kiosk page, the same as the observation displays — nothing about the
  // app's own navigation belongs on a phone somebody is handed at the cars.
  const { setHidden: setChromeHidden } = useChrome();
  useEffect(() => {
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [setChromeHidden]);

  const [result] = useQuery({
    query: VOTING_BALLOT_QUERY,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });
  const [, castVote] = useMutation(CAST_VOTE_MUTATION);

  // Which award each just-cast vote landed on, so the confirmation is scoped
  // to that award rather than the whole page. Not persisted anywhere — a
  // reload, or picking a different award, is a clean slate.
  const [justVoted, setJustVoted] = useState<Record<number, boolean>>({});
  const [submitting, setSubmitting] = useState<number | null>(null);

  const race = result.data?.race;
  const votingOpen: boolean = race?.votingOpen ?? false;
  const awards: BallotAward[] = race?.awards ?? [];
  const cars: BallotCar[] = useMemo(() => forBallot(race?.racers ?? []), [race]);
  const votable = awards.filter((a) => a.kind === 'SPECIAL' && a.votable);

  if (!raceId || isNaN(id)) return <div style={{ padding: '2rem' }}>Invalid race.</div>;

  const vote = async (awardId: number, carId: number) => {
    setSubmitting(awardId);
    const response = await castVote({
      awardId,
      racerId: carId,
      ballotKey: newBallotKey(),
    });
    setSubmitting(null);
    if (response.error) {
      showToast(errorText(response.error, 'Your vote could not be sent.'), 'error');
      return;
    }
    if (response.data?.castVote) {
      // A refusal the server explains in a sentence — voting closed between
      // this page loading and the tap, most likely.
      showToast(response.data.castVote, 'error');
      return;
    }
    setJustVoted((current) => ({ ...current, [awardId]: true }));
  };

  return (
    <div
      style={{
        maxWidth: '32rem',
        margin: '0 auto',
        padding: '1.5rem 1rem 3rem',
      }}
    >
      <h1 style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>
        {race?.name ? `Vote — ${race.name}` : 'Vote'}
      </h1>

      {result.fetching && <p>Loading…</p>}
      {result.error && (
        <p style={{ color: '#b60205' }}>
          {errorText(result.error, 'This page could not be loaded.')}
        </p>
      )}

      {!result.fetching && !result.error && !votingOpen && (
        <p style={{ color: '#666', marginTop: '1.5rem' }}>
          Voting is closed right now. Check back once the operator opens it.
        </p>
      )}

      {!result.fetching && votingOpen && votable.length === 0 && (
        <p style={{ color: '#666', marginTop: '1.5rem' }}>
          There is nothing to vote on right now.
        </p>
      )}

      {votingOpen &&
        votable.map((award) => (
          <section
            key={award.id}
            style={{
              marginTop: '1.75rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid #eee',
            }}
          >
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>{award.name}</h2>

            {justVoted[award.id] ? (
              <div
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  background: '#f0f9f0',
                  color: '#256029',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <span>Thanks for voting!</span>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() =>
                    setJustVoted((current) => {
                      const next = { ...current };
                      delete next[award.id];
                      return next;
                    })
                  }
                >
                  Vote again
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(7.5rem, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {cars.map((car) => (
                  <button
                    key={car.id}
                    type="button"
                    disabled={submitting === award.id}
                    onClick={() => vote(award.id, car.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.6rem',
                      borderRadius: '12px',
                      border: '1px solid #ddd',
                      background: '#fff',
                      cursor: submitting === award.id ? 'wait' : 'pointer',
                    }}
                  >
                    {car.carImageUrl ? (
                      <img
                        src={car.carImageUrl}
                        alt=""
                        style={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          objectFit: 'cover',
                          borderRadius: '8px',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          borderRadius: '8px',
                          background: '#f0f0f0',
                        }}
                      />
                    )}
                    <strong>
                      {car.carNumber != null ? `#${car.carNumber}` : 'Unnumbered'}
                    </strong>
                    {car.carName && (
                      <span style={{ fontSize: '0.85rem', color: '#666' }}>
                        {car.carName}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
    </div>
  );
}
