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
 *
 * The way out (#955): the app chrome is hidden here (`Navigation.tsx`'s early
 * return), so a browser with no visible Back button — a kiosk, a tablet in
 * full-screen — would otherwise have no exit at all. A "Back to awards" link
 * fades after a few seconds of no pointer movement, the way a video player's
 * controls do, and returns on movement or on keyboard focus. Escape does the
 * same thing from the keyboard, following `shortcuts.ts`'s shape: nothing
 * fires with a modifier held, and `preventDefault` only once an action is
 * decided.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useSubscription } from 'urql';
import AwardArtwork from '../artwork';
import { CeremonyAward, deltaForKey, slideFor, stepIndex } from '../ceremony';
import { RACE_AWARDS_QUERY } from '../graphql/queries';
import { displayId, startDeviceClaimHeartbeat } from '../../observation/displayIdentity';
import { DisplayAssignmentSubscription } from '../../observation/graphql/queries';
import IdentifyPresence from '../../observation/IdentifyPresence';
import { useIdentifyOverlay } from '../../observation/useIdentifyOverlay';
import IntermissionOverlay from '../../observation/components/IntermissionOverlay';
import { NONE as NO_INTERMISSION, type IntermissionData } from '../../racing/intermission';
import { useLiveIntermission } from '../../core/hooks/useLiveIntermission';
import { useRaceStateChanged } from '../../core/hooks/useRaceStateChanged';
import { resolveDisplayTheme } from '../../../theming/applyTheme';
import type { SurfaceThemeSetting } from '../../../theming/themes';
import { useTerminology } from '../../../context/TerminologyContext';
import {
  isSoundEffectEnabled,
  playAwardFanfareSound,
  readSoundSettings,
  writeSoundSettings,
} from '../../audio/soundEffects';

/** How long the back link stays up after the pointer last moved. A few
 * seconds is long enough to find and click without haste, and short enough
 * that it is gone for the photograph. */
const BACK_LINK_IDLE_MS = 4000;

export default function AwardCeremony() {
  const { raceId } = useParams<{ raceId: string }>();
  const id = parseInt(raceId || '0');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { groupLower, vehicle } = useTerminology();
  const [index, setIndex] = useState(0);

  // Stay on the operator's leash. A screen arrives here because it was
  // *assigned* the ceremony, and the observation page's redirect closed the
  // subscription that assignment travelled over — so without this, the row
  // on the Displays panel went "Not connected" and the screen could never be
  // told anything again: the one state the feature promises cannot happen.
  // Holding the same subscription here keeps the screen present, and an
  // assignment to any other view sends it back to the observation page to
  // carry it out.
  //
  // `?displayId=` (#590) matters less here than on Observation, since a
  // redirect into this page never carries one — but a screen opened on this
  // route directly still resolves the same way, and `displayId()` is the one
  // door either way.
  const displayIdParam = searchParams.get('displayId');
  const thisDisplayId = useMemo(() => displayId(displayIdParam), [displayIdParam]);
  useEffect(() => startDeviceClaimHeartbeat(thisDisplayId), [thisDisplayId]);
  const [assignmentResult] = useSubscription({
    query: DisplayAssignmentSubscription,
    variables: { displayId: thisDisplayId, raceId: id },
    pause: !id,
  });
  const assignment = assignmentResult.data?.displayAssignment ?? null;

  // Held once, here, rather than inside `IdentifyPresence` itself (#1071,
  // #1072's shared fix) — see `useIdentifyOverlay.ts`'s own docstring for why
  // the state has to live in a component that does not unmount when its
  // return value's shape changes.
  const identify = useIdentifyOverlay(assignment);

  const [result, reExecute] = useQuery({
    query: RACE_AWARDS_QUERY,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const race = result.data?.race;
  const awards: CeremonyAward[] = race?.awards ?? [];
  const rounds = race?.rounds ?? [];
  const racingGroups = race?.racingGroups ?? [];

  // A break takes this screen over exactly like every other display (#592,
  // #1072) — this route had no intermission handling at all before, so a
  // ceremony assigned during a break never showed one, and applying the
  // Awards scene *while* a break was already up on another screen dropped
  // this one straight onto a trophy slide instead. Shared tick/derivation
  // with `Observation.tsx` (`useLiveIntermission`), so the two pages cannot
  // quietly disagree about when a break has ended.
  useRaceStateChanged(id, () => reExecute({ requestPolicy: 'network-only' }));
  const intermission: IntermissionData = race?.intermission ?? NO_INTERMISSION;
  const intermissionActive = useLiveIntermission(intermission);

  useEffect(() => {
    // `assigned`, not merely a payload: every connected screen receives one
    // carrying the default view, and acting on it would march a ceremony
    // somebody opened by hand off to the standings.
    //
    // Not while a break has this screen (#1072): a scene applied mid-break
    // reassigning this display away from the ceremony must not drop the
    // break overlay the instant the payload arrives — it takes effect once
    // the break ends instead, which is why `intermissionActive` is a
    // dependency here rather than just a guard.
    if (assignment?.assigned && assignment.view !== 'AWARDS' && !intermissionActive) {
      navigate(`/race/${id}/observation`, { replace: true });
    }
  }, [assignment, id, navigate, intermissionActive]);

  // The Display surface's theme (#498) — same reasoning as Observation.tsx's
  // own root: this is the audience-facing surface, and the default option
  // (stored as 'MATCH_APP', shown as "Field Uniform (default)") resolves
  // the same way on every screen in the room (#528).
  //
  // Read off `displayAssignment` rather than the award query's own
  // `initialConfig` (#586) — this page already holds that subscription open
  // for the whole ceremony (see the comment above it), and it is what lets a
  // theme change made in System Settings reach this screen live, the same as
  // Observation.tsx.
  const displayThemeSetting: SurfaceThemeSetting =
    (assignment?.displayThemeSetting as SurfaceThemeSetting | undefined) ?? 'MATCH_APP';
  const { key: displayThemeKey, theme: displayTheme } = resolveDisplayTheme(displayThemeSetting);
  const displayThemeStyle = displayTheme.tokens as React.CSSProperties;

  const [soundOn, setSoundOn] = useState(() => isSoundEffectEnabled('awardFanfare', window.localStorage));

  const step = useCallback(
    (delta: number) => {
      setIndex((current) => stepIndex(current, delta, awards.length));
    },
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
    if (obeyedSeq !== null) {
      if (assignment.slideDelta > 0 && index < awards.length - 1 && isSoundEffectEnabled('awardFanfare', window.localStorage)) {
        playAwardFanfareSound();
      }
      step(assignment.slideDelta);
    }
  }

  const goBack = useCallback(() => navigate(`/race/${id}/awards`), [navigate, id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A held modifier belongs to the browser, the same rule
      // `shortcuts.ts` follows on the Race tab — Cmd/Ctrl-arrow switches tabs
      // or spaces in some browsers, and quietly stealing that is worse than
      // having no shortcut.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape') {
        // The one key `deltaForKey` never claims, so this never fights the
        // ceremony's own → / ← stepping.
        event.preventDefault();
        goBack();
        return;
      }

      const delta = deltaForKey(event.key);
      if (delta === null) return;
      // Space scrolls and the arrows move the page otherwise, and a ceremony
      // that jumps a line every time the announcer clicks forward is a mess.
      event.preventDefault();
      if (delta > 0 && index < awards.length - 1 && isSoundEffectEnabled('awardFanfare', window.localStorage)) {
        playAwardFanfareSound();
      }
      step(delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, index, awards.length, goBack]);

  // A projector wants no scrollbars and no page chrome.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // The back link (#955): up on load, and again whenever the pointer moves —
  // then gone after a few seconds of neither, the way a video player's own
  // controls behave. Focus (Tab, from a keyboard with no pointer at all)
  // reveals it the same way, so it is never hidden from something that can
  // reach it only by keyboard.
  const [backLinkVisible, setBackLinkVisible] = useState(true);
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>;
    const reveal = () => {
      setBackLinkVisible(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setBackLinkVisible(false), BACK_LINK_IDLE_MS);
    };
    reveal();
    window.addEventListener('pointermove', reveal);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('pointermove', reveal);
    };
  }, []);

  if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

  // The break screen takes this route over exactly like every other display
  // (#592, #1072) — a break is a fact about the race, not about which
  // screen happened to be on the ceremony when the operator called it, and
  // this route had no such handling before. No back link, no keyboard
  // stepping surfaced here: the operator ends a break from Race Control, the
  // same as every other screen showing it, and `identify` still renders so
  // Identify keeps working while the room is on a break (#1071's own fix,
  // shared rather than duplicated).
  if (intermissionActive) {
    return (
      <div className="container projector-mode" data-theme={displayThemeKey} style={displayThemeStyle}>
        <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />
        <IntermissionOverlay intermission={intermission} vehicleLabel={vehicle} />
      </div>
    );
  }

  // Resolved server-side (#552); the ceremony is an audience surface, so the
  // winner's name and photo go through it — the operator's own award screens
  // do not.
  const nameDisplay = race?.resolvedNameDisplay ?? 'FULL';
  const slide = slideFor(awards, index, rounds, racingGroups, groupLower, nameDisplay);

  return (
    <div
      onClick={() => {
        if (index < awards.length - 1 && isSoundEffectEnabled('awardFanfare', window.localStorage)) {
          playAwardFanfareSound();
        }
        step(1);
      }}
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
      <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />

      {/* The way out (#955). Stopping propagation keeps a click on the link
          from also landing on the root's own onClick, which would advance
          the slide underneath the navigation. Not `preventDefault` — the
          `Link` still has to do its own client-side navigation, which is
          what keeps this inside the SPA rather than a full reload. */}
      <Link
        to={`/race/${id}/awards`}
        data-testid="ceremony-back-link"
        onClick={(e) => e.stopPropagation()}
        onFocus={() => setBackLinkVisible(true)}
        style={{
          position: 'absolute',
          top: '2vh',
          left: '2vw',
          color: 'var(--display-text-color, #ffffff)',
          fontSize: '1.8vh',
          textDecoration: 'none',
          opacity: backLinkVisible ? 0.7 : 0,
          transition: 'opacity 0.4s ease',
          // Never `display: none` — a link a keyboard cannot reach is not
          // a way out for someone without a pointer.
          pointerEvents: backLinkVisible ? 'auto' : 'none',
        }}
      >
        ← Back to awards
      </Link>

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
        <label
          style={{
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            userSelect: 'none',
          }}
          title="Play award fanfare sound when presenting awards"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            data-testid="ceremony-sound-toggle"
            checked={soundOn}
            onChange={(e) => {
              const checked = e.target.checked;
              const current = readSoundSettings(window.localStorage);
              const updated = {
                ...current,
                awardFanfare: checked,
              };
              writeSoundSettings(window.localStorage, updated);
              setSoundOn(checked);
              if (checked) playAwardFanfareSound();
            }}
          />
          Fanfare
        </label>
      </div>
    </div>
  );
}
