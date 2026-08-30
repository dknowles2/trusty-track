/**
 * The awards, one at a time, on the big screen (#170).
 *
 * `/race/:raceId/awards/present`. A separate route rather than another tab on
 * the audience display: the other views rotate on a timer because nobody is
 * driving them, and a ceremony is paced by whoever is holding the microphone.
 *
 * Advance with the arrow keys, space, or a click anywhere. A presenter remote
 * is a keyboard that sends Page Up and Page Down, which is why those are in
 * `deltaForKey` too.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useSubscription } from 'urql';
import AwardArtwork from '../artwork';
import { CeremonyAward, deltaForKey, slideFor, stepIndex } from '../ceremony';
import { RACE_AWARDS_QUERY } from '../graphql/queries';
import { displayId } from '../../observation/displayIdentity';
import { DisplayAssignmentSubscription } from '../../observation/graphql/queries';
import IdentifyPresence from '../../observation/IdentifyPresence';
import { resolveDisplayTheme } from '../../../theming/applyTheme';
import type { SurfaceThemeSetting } from '../../../theming/themes';
import { useTerminology } from '../../../context/TerminologyContext';

export default function AwardCeremony() {
  const { raceId } = useParams<{ raceId: string }>();
  const id = parseInt(raceId || '0');
  const navigate = useNavigate();
  const { groupLower } = useTerminology();
  const [index, setIndex] = useState(0);

  // Stay on the operator's leash. A screen arrives here because it was
  // *assigned* the ceremony, and the observation page's redirect closed the
  // subscription that assignment travelled over — so without this, the row
  // on the Displays panel went "Not connected" and the screen could never be
  // told anything again: the one state the feature promises cannot happen.
  // Holding the same subscription here keeps the screen present, and an
  // assignment to any other view sends it back to the observation page to
  // carry it out.
  const thisDisplayId = useMemo(() => displayId(), []);
  const [assignmentResult] = useSubscription({
    query: DisplayAssignmentSubscription,
    variables: { displayId: thisDisplayId, raceId: id },
    pause: !id,
  });
  const assignment = assignmentResult.data?.displayAssignment ?? null;
  useEffect(() => {
    // `assigned`, not merely a payload: every connected screen receives one
    // carrying the default view, and acting on it would march a ceremony
    // somebody opened by hand off to the standings.
    if (assignment?.assigned && assignment.view !== 'AWARDS') {
      navigate(`/race/${id}/observation`, { replace: true });
    }
  }, [assignment, id, navigate]);

  const [result] = useQuery({
    query: RACE_AWARDS_QUERY,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const race = result.data?.race;
  const awards: CeremonyAward[] = race?.awards ?? [];
  const rounds = race?.rounds ?? [];
  const racingGroups = race?.racingGroups ?? [];

  // The Display surface's theme (#498) — same reasoning as Observation.tsx's
  // own root: this is the audience-facing surface, and the default option
  // (stored as 'MATCH_APP', shown as "Field Uniform (default)") resolves
  // the same way on every screen in the room (#528).
  const displayThemeSetting: SurfaceThemeSetting =
    (result.data?.initialConfig?.displayTheme as SurfaceThemeSetting | undefined) ?? 'MATCH_APP';
  const { key: displayThemeKey, theme: displayTheme } = resolveDisplayTheme(displayThemeSetting);
  const displayThemeStyle = displayTheme.tokens as React.CSSProperties;

  const step = useCallback(
    (delta: number) => setIndex((current) => stepIndex(current, delta, awards.length)),
    [awards.length],
  );

  // Steps sent from the operator's Displays panel, for a ceremony on a screen
  // the presenter is not standing at.
  //
  // A *step* rather than a slide number, because the operator's laptop cannot
  // know which trophy is up — this page owns the index and holds no PIN to
  // report it back (#15). Applying the step here is what lets the keys and a
  // presenter remote at the screen keep working: both drivers move the same
  // index, and neither overwrites the other.
  //
  // Adjusted during render rather than in an effect, the same reason
  // `RaceControl` pins its heat that way: an effect paints the old slide for
  // a frame first, and this is a projector in front of a room.
  const [obeyedSeq, setObeyedSeq] = useState<number | null>(null);
  const slideSeq: number | null = assignment?.slideSeq ?? null;
  if (slideSeq !== null && slideSeq !== obeyedSeq) {
    setObeyedSeq(slideSeq);
    // The value it arrives holding is a reconnection, not an instruction.
    // Obeying it would jump the ceremony a trophy every time the wifi
    // hiccupped — the `seen === null` rule from `roundCompletion.ts`.
    if (obeyedSeq !== null) step(assignment.slideDelta);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const delta = deltaForKey(event.key);
      if (delta === null) return;
      // Space scrolls and the arrows move the page otherwise, and a ceremony
      // that jumps a line every time the announcer clicks forward is a mess.
      event.preventDefault();
      step(delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  // A projector wants no scrollbars and no page chrome.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

  // Resolved server-side (#552); the ceremony is an audience surface, so the
  // winner's name and photo go through it — the operator's own award screens
  // do not.
  const nameDisplay = race?.resolvedNameDisplay ?? 'FULL';
  const slide = slideFor(awards, index, rounds, racingGroups, groupLower, nameDisplay);

  return (
    <div
      onClick={() => step(1)}
      role="presentation"
      data-theme={displayThemeKey}
      style={{
        position: 'fixed',
        inset: 0,
        // Above the app navigation, which is `zIndex: 1000` and would otherwise
        // paint its Details/Control/Standings menu across the top of a
        // ceremony that is on a projector in front of the whole pack. Found by
        // loading the page rather than by any test.
        zIndex: 3000,
        // Joins the rest of the Display surface (#498, stage 2) — the
        // groundwork PR left this as the App surface's navy because no theme
        // data existed yet to decide with; now that it does, the ceremony
        // slide is Observation.tsx's own projector background rather than a
        // one-off colour beside it. Field Uniform's value is #0A0A0A, not
        // #003F87 — this is the one deliberate colour change stage 2 makes
        // to an existing screen under the *default* theme, and it is why the
        // doc screenshot suite must be re-run for this change (see the PR).
        background: 'var(--display-bg-color, #0A0A0A)',
        color: 'var(--display-text-color, #ffffff)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '4vh 6vw',
        cursor: 'pointer',
        userSelect: 'none',
        ...displayThemeStyle,
      }}
    >
      {/* This page holds its own `displayAssignment` subscription (above,
          for the leash), so it gets its own copy of the naming treatments
          (#495) rather than inheriting Observation.tsx's — Identify used to
          do nothing here for exactly that reason (#519). */}
      <IdentifyPresence assignment={assignment} />

      {!slide ? (
        <p style={{ fontSize: '3vh', opacity: 0.8 }}>
          {result.fetching ? 'Loading…' : 'No awards have been set up for this race yet.'}
        </p>
      ) : (
        <>
          <h1
            style={{
              fontSize: 'clamp(2rem, 8vh, 6rem)',
              margin: 0,
              color: 'var(--display-accent-color, #FCD116)',
            }}
          >
            {slide.title}
          </h1>
          <p style={{ fontSize: 'clamp(1rem, 3vh, 2rem)', opacity: 0.85, marginTop: '1vh' }}>
            {slide.subtitle}
          </p>

          {/* The award's own artwork, not the winner's photo — that comes
              below, when there is one. A `SPECIAL` award with no ready-made
              template and no `SPEED` rule to derive one from has none, and
              the slide is exactly as it was before this existed. */}
          {slide.artworkKey && (
            <div style={{ margin: '3vh 0 1vh' }}>
              {/* dark: the slide's background is dark, the colour the artwork's
                  outlines default to (#400) — without this every line in the
                  icon matches the wall behind it. The palette is the Display
                  surface's own accent (#498's groundwork), not the App's gold
                  read directly. */}
              <AwardArtwork
                artworkKey={slide.artworkKey}
                size={140}
                variant="dark"
                palette={{
                  line: 'var(--display-text-color, #ffffff)',
                  fill: 'var(--display-accent-color, #FCD116)',
                }}
              />
            </div>
          )}

          {slide.racerImageUrl && (
            <img
              src={slide.racerImageUrl}
              alt=""
              style={{
                width: 'clamp(120px, 24vh, 320px)',
                height: 'clamp(120px, 24vh, 320px)',
                borderRadius: '50%',
                objectFit: 'cover',
                margin: '4vh 0 2vh',
                border: '4px solid var(--display-accent-color, #FCD116)',
              }}
            />
          )}

          <p
            style={{
              fontSize: 'clamp(1.5rem, 6vh, 4rem)',
              fontWeight: 'bold',
              margin: slide.racerImageUrl ? 0 : '4vh 0 0',
            }}
          >
            {/* An award with nobody yet is still a slide: most stay unresolved
                until the very end, and skipping it would leave the announcer
                reading from a screen that had moved on. */}
            {slide.winner ?? <span style={{ opacity: 0.6 }}>Still to be decided</span>}
          </p>
        </>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: '3vh',
          fontSize: '2vh',
          opacity: 0.5,
          display: 'flex',
          gap: '1.5rem',
          alignItems: 'center',
        }}
      >
        {slide && <span>{slide.position}</span>}
        <span>Click or press → for the next award</span>
      </div>
    </div>
  );
}
