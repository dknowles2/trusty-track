/**
 * Vote for the judged awards from a phone in the room (#305).
 *
 * The one route a phone holding no PIN may act through — `VIEWER` may run
 * exactly one mutation, `castVote`, and only while `Race.votingOpen` is true
 * (`api/auth.py`'s `VOTE_MUTATIONS`). This page is the whole reason that
 * exception exists: no login, just an address shared around the room.
 *
 * **Cars only, never children.** The query behind this page
 * (`VOTING_BALLOT_QUERY`) asks for `carNumber`, `carName`, `carImageUrl` and
 * the racer's `racingGroup { color }` — a den's chosen colour, not a
 * child's name — and nothing else: no racer name, no `racerImageUrl`.
 * Enforcing that here, in what this page asks for, is deliberate: queries
 * carry no role check anywhere in this app, so anonymity is a property of
 * this one query, not of the server. The group colour exists to fill a
 * photo-less car's tile (#1006) — see `tileFill` below.
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
import StatusBanner from '../../../components/ui/StatusBanner';
import { useChrome } from '../../../context/ChromeContext';
import { useAlert } from '../../../context/AlertContext';
import { useTerminology } from '../../../context/TerminologyContext';
import { useRunMutation } from '../../../context/runMutation';
import { errorText } from '../../../utils/errors';
import { getDeterministicColor } from '../../../utils/avatarUtils';
import { getContrastColor } from '../../../utils/colors';
import { forBallot } from '../awardText';
import { CAST_VOTE_MUTATION, VOTING_BALLOT_QUERY } from '../graphql/queries';

type BallotCar = {
  id: number;
  carNumber?: number | null;
  carName?: string | null;
  carImageUrl?: string | null;
  racingGroup?: { color?: string | null } | null;
};

/**
 * The tile fill for a car with no photo (#1006) — the roster's own
 * initials-avatar treatment (`RacerAvatar`), adapted for a page that
 * deliberately carries no racer name to key a colour off. The den's own
 * colour is what a voter recognises beside the physical car at the table,
 * so it wins whenever the car has one; a racer with no den falls back to a
 * colour keyed on the car number — the only other stable, name-free thing
 * this page has. Text colour follows `getContrastColor` so the number
 * stays legible against whichever colour that turns out to be, on every
 * theme — the tile's own background is user data (a den's chosen colour),
 * not a theme token, so contrast has to be computed rather than assumed.
 */
// No explicit return type here on purpose — spelling it out needs either a
// generic (`ReturnType<typeof getContrastColor>`, whose `<...>` reads as a
// stray JSX tag to `terminologyGuard.test.ts`'s scanner and swallows every
// plain-code line up to the next real `<` as if it were JSX text) or a
// repeated `'black' | 'white'` literal (which trips `tokenSystem.test.ts`'s
// colour-literal sweep the same way spelling out the union anywhere else in
// this tree would). Every other caller of `getContrastColor` in this app
// just consumes its return value without re-declaring the type, for the
// same reason — inference gives the identical type with neither problem.
function tileFill(entry: BallotCar) {
  const background = entry.racingGroup?.color || getDeterministicColor(entry.carNumber ?? entry.id);
  return { background, color: getContrastColor(background) };
}

type BallotAward = {
  id: number;
  name: string;
  kind: string;
  votable?: boolean | null;
};

/** How to name an entry back to the voter — the label for "Thanks for voting
 * for ___!". A stray tap is invisible without this: the confirmation is the
 * only thing that tells the voter (or a stray-tap victim) which one the vote
 * landed on, so it has to identify it even when there is no number and no
 * name to go on.
 *
 * `vehicleWord` is the resolved, lowercase term (#551) — "this rocket" for a
 * Space Derby, defaulting to the built-in Scouting word so a caller with no
 * terminology in scope still reads exactly as before. */
function votedCarLabel(entry: BallotCar, vehicleWord = 'car'): string {
  const number = entry.carNumber != null ? `#${entry.carNumber}` : null;
  if (number && entry.carName) return `${number} ${entry.carName}`;
  if (number) return number;
  if (entry.carName) return entry.carName;
  return `this ${vehicleWord}`;
}

function newBallotKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // A browser old enough to lack `randomUUID` still needs *a* fresh key per
  // vote — this is not a security boundary, only an idempotency token.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function VotingBallot() {
  const { raceId } = useParams<{ raceId: string }>();
  const id = parseInt(raceId || '0');
  const { showToast } = useAlert();
  const { vehicleLower } = useTerminology();

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
  const runMutation = useRunMutation();

  // Which car each just-cast vote landed on, keyed by award, so the
  // confirmation is scoped to that award rather than the whole page and can
  // name the car the tap actually hit (#418) — a stray tap is invisible
  // otherwise. Not persisted anywhere — a reload, or picking a different
  // award, is a clean slate.
  const [justVoted, setJustVoted] = useState<Record<number, BallotCar>>({});
  const [submitting, setSubmitting] = useState<number | null>(null);

  const race = result.data?.race;
  const votingOpen: boolean = race?.votingOpen ?? false;
  const awards: BallotAward[] = race?.awards ?? [];
  const entries: BallotCar[] = useMemo(() => forBallot(race?.racers ?? []), [race]);
  const votable = awards.filter((a) => a.kind === 'SPECIAL' && a.votable);

  if (!raceId || isNaN(id)) return <div style={{ padding: '2rem' }}>Invalid race.</div>;

  const vote = async (awardId: number, entry: BallotCar) => {
    setSubmitting(awardId);
    const response = await runMutation(
      castVote,
      { awardId, racerId: entry.id, ballotKey: newBallotKey() },
      'Your vote could not be sent.',
    );
    setSubmitting(null);
    if (!response) return;
    if (response.data?.castVote) {
      // A refusal the server explains in a sentence — voting closed between
      // this page loading and the tap, most likely.
      showToast(response.data.castVote, 'error');
      return;
    }
    setJustVoted((current) => ({ ...current, [awardId]: entry }));
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
        <p style={{ color: 'var(--error)' }}>
          {errorText(result.error, 'This page could not be loaded.')}
        </p>
      )}

      {!result.fetching && !result.error && !votingOpen && (
        <p style={{ color: 'var(--text-muted-color)', marginTop: '1.5rem' }}>
          Voting is closed right now. Check back once the operator opens it.
        </p>
      )}

      {!result.fetching && votingOpen && votable.length === 0 && (
        <p style={{ color: 'var(--text-muted-color)', marginTop: '1.5rem' }}>
          There is nothing to vote on right now.
        </p>
      )}

      {votingOpen &&
        votable.map((award, index) => (
          // Collapsed past the first award (#1006) — three awards times a
          // roster's worth of tiles was a wall of squares nobody could find
          // the second award in without scrolling past the first. `open`
          // is only ever passed the same value across renders for a given
          // award (it depends on nothing but this award's fixed position
          // in the list), so React never re-applies it after mount and a
          // voter's own manual expand/collapse survives every re-render —
          // including the one `justVoted` triggers when they cast a vote.
          <details
            key={award.id}
            open={index === 0}
            style={{
              marginTop: '1.75rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid var(--divider-color)',
            }}
          >
            <summary style={{ cursor: 'pointer', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
              <span
                style={{
                  display: 'inline-flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  gap: '0.5rem',
                }}
              >
                <strong>{award.name}</strong>
                {justVoted[award.id] && (
                  // The summary line stays informative while the section
                  // is collapsed — a voter checking whether they already
                  // voted here should not have to reopen it to find out.
                  <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-muted-color)' }}>
                    You voted for {votedCarLabel(justVoted[award.id], vehicleLower)}
                  </span>
                )}
              </span>
            </summary>

            {justVoted[award.id] ? (
              <StatusBanner
                tone="success"
                style={{ padding: '0.85rem 1rem', justifyContent: 'space-between', gap: '1rem' }}
              >
                <span>Thanks for voting for {votedCarLabel(justVoted[award.id], vehicleLower)}!</span>
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
              </StatusBanner>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(7.5rem, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {entries.map((entry) => {
                  const fill = tileFill(entry);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={submitting === award.id}
                      onClick={() => vote(award.id, entry)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.6rem',
                        borderRadius: '12px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--surface-color)',
                        cursor: submitting === award.id ? 'wait' : 'pointer',
                      }}
                    >
                      {entry.carImageUrl ? (
                        <img
                          src={entry.carImageUrl}
                          alt=""
                          style={{
                            width: '100%',
                            aspectRatio: '1 / 1',
                            objectFit: 'cover',
                            borderRadius: '8px',
                          }}
                        />
                      ) : (
                        // No photo yet (#1006) — the roster's own
                        // initials-avatar treatment, filled with the car
                        // number rather than left an empty square nobody
                        // can tell apart from its neighbours. Bare digits
                        // here, not "#42" — the `#` form is what the label
                        // underneath already shows, and giving the two an
                        // identical string would make them indistinguishable
                        // to anything (a test, a screen reader) matching by
                        // text rather than position.
                        <div
                          aria-hidden="true"
                          style={{
                            width: '100%',
                            aspectRatio: '1 / 1',
                            borderRadius: '8px',
                            background: fill.background,
                            color: fill.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.6rem',
                            fontWeight: 700,
                          }}
                        >
                          {entry.carNumber != null ? entry.carNumber : '?'}
                        </div>
                      )}
                      <strong>
                        {entry.carNumber != null ? `#${entry.carNumber}` : 'Unnumbered'}
                      </strong>
                      {entry.carName && (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                          {entry.carName}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </details>
        ))}
    </div>
  );
}
