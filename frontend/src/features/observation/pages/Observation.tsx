import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSubscription, useQuery } from 'urql';
import { Icon } from '@mdi/react';
import RacerAvatar from '../../management/components/RacerAvatar';
import LaneBadge from '../../../components/ui/LaneBadge';
import { colorForLane } from '../../settings/laneColors';
import { mdiFire, mdiChevronDoubleRight, mdiTrophy, mdiTimerOutline, mdiVideo } from '@mdi/js';
import { TimerStatusBadge } from '../../racing/components/TimerStatusBadge';
import PhotoSlideshow from '../components/PhotoSlideshow';
import StandingsOnlyView from '../components/StandingsOnlyView';
import CheckInDisplayView from '../components/CheckInDisplayView';
import QRCodeDisplayView from '../components/QRCodeDisplayView';
import BroadcastOverlayView from '../components/BroadcastOverlayView';
import { displayId, startDeviceClaimHeartbeat } from '../displayIdentity';
import { useMeasuredPages } from '../useMeasuredPages';
import { useDisplayDensity } from '../useDisplayDensity';
import { useChrome } from '../../../context/ChromeContext';
import { useTerminology } from '../../../context/TerminologyContext';
import { formatDisplayName, shouldShowRacerPhoto } from '../../core/displayName';
import {
  readUrl,
  resolveView,
  DEFAULT_SCROLL_BEHAVIOR,
  DEFAULT_SHOW_CHECKED_IN,
  DEFAULT_QR_TARGET,
  DEFAULT_SHOW_STANDINGS_TICKER,
} from '../displayView';
import { recordBreakDetail, type RecordBreak } from '../recordBreak';
import { observeHeatResult, type SeenHeatResult } from '../resultsOverlay';
import { isSoundEffectEnabled, playFinishSound, playRecordBreakSound } from '../../audio/soundEffects';
import { formatScaleMph } from '../scaleSpeed';
import { runOffAnnouncement } from '../../racing/runOff';
import { formatLaneTime } from '../../racing/lanes';
import {
  dnfAnnotation as dnfAnnotationShared,
  formatScore as formatScoreShared,
  scoreCell,
  scoreLabel as scoreLabelFor,
} from '../../stats/scoringStrategyText';
import IdentifyPresence from '../IdentifyPresence';
import { useIdentifyOverlay } from '../useIdentifyOverlay';
import IntermissionOverlay from '../components/IntermissionOverlay';
import RaceFinishedOverlay from '../components/RaceFinishedOverlay';
import { finalChampionshipRound, raceIsFinished } from '../raceFinished';
import { roundLabel as championshipRoundLabel } from '../../stats/disruptedRounds';
import { defaultEliminationRound, isEliminationOnlyRace } from '../../stats/eliminationScope';
import { useRaceStateChanged } from '../../core/hooks/useRaceStateChanged';
import { useLiveIntermission } from '../../core/hooks/useLiveIntermission';
import { NONE as NO_INTERMISSION, type IntermissionData } from '../../racing/intermission';
import { TIMER_STATUS_SUBSCRIPTION } from '../../racing/graphql/queries';
import { resolveDisplayTheme } from '../../../theming/applyTheme';
import type { SurfaceThemeSetting } from '../../../theming/themes';
import {
  LeaderboardSubscription,
  OnDeckSubscription,
  CurrentlyRacingSubscription,
  TimingStatsSubscription,
  ActiveFreeRaceHeatSubscription,
  DisplayAssignmentSubscription,
} from '../graphql/queries';

const GET_INITIAL_DATA = `
  query GetInitialData($id: Int!) {
    race(raceId: $id) {
      id
      scoringStrategy
      resolvedNameDisplay
      qrHeadline
      qrWifiNote
      intermission {
        active
        remainingSeconds
        paused
        label
        endsAt
      }
      track {
        id
        # This track's configured lane colours, for the badge beside every
        # lane number on the Now Racing / On Deck cards and in projector
        # mode. Empty when the operator has never opened the picker on the
        # track's card.
        laneColors
        # How dense a heat card's own grid and the on-deck depth budget need
        # to be (#1073 part 2, displayDensity.ts) — an 8-lane track
        # needs a smaller tier than a 6-lane one at the identical viewport.
        laneCount
      }
      # Whether the race is finished (#869) — every officially scheduled
      # heat recorded, with nothing next — is decided from these two
      # fields by raceFinished.ts's raceIsFinished/finalChampionshipRound,
      # not asked of the server directly: it is a plain fact about data this
      # screen already has the shape of, the same reasoning pace.ts
      # computes client-side rather than as a new resolver.
      heats {
        id
        recordedAt
      }
      rounds {
        id
        name
        roundNumber
        advancementSource
        # Whether a round is scored by survival rather than a share of the
        # aggregate — an elimination-only race's "Overall" is empty by
        # design, so this is what eliminationScope.ts reads to decide
        # whether this race's own standings live somewhere else.
        schedulingStrategy
      }
      racers {
        id
        firstName
        lastName
        carNumber
        racerImageUrl
        carImageUrl
        carName
        racingGroupId
        carPassedInspection
      }
      racingGroups {
        id
        name
        color
        division
      }
    }
  }
`;

/**
 * One championship round's own placings (#869) — a plain string rather than
 * the `gql` tag, the same reason `Leaderboard.tsx`'s own round-scoped query
 * is: the round id is runtime data, not something codegen can type ahead of
 * time. There is no live channel for this the way there is for the prelim
 * standings (`Subscription.leaderboard` carries no `roundId`), so it is a
 * one-shot fetch, paused until the race is actually finished.
 */
function championshipResultQuery(roundId: number): string {
  return `
    query GetChampionshipResult($id: Int!) {
      race(raceId: $id) {
        id
        leaderboard(roundId: ${roundId}) {
          racerId
          rank
          score
          heatsCompleted
        }
      }
    }
  `;
}

// A harmless, always-parseable document for the championship query while it
// is paused (no championship round, or the race is not finished) — `useQuery`
// still needs a valid `query` even when it never runs.
const NOOP_CHAMPIONSHIP_QUERY = 'query Noop { __typename }';

interface Standing {
  racerId: number;
  racingGroupDivision?: string | null;
  score: number;
  heatsCompleted: number;
  /** How many of `heatsCompleted` were an actual DNF rather than a genuine
   * slow finish (#898). Optional: the one-shot championship-round query
   * above does not carry it — that panel's own `RaceFinishedOverlay` was
   * left out of this issue's scope, so nothing there reads it. See
   * `dnfAnnotation`. */
  dnfCount?: number;
  rank: number;
}

interface RacingGroupInfo {
  id: number;
  name: string;
  color: string;
  division?: string | null;
}

export default function Observation() {
  const { raceId } = useParams<{ raceId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = parseInt(raceId || '0');
  const { vehicle, group } = useTerminology();

  // This screen's identity, and what it has been told to show (#174). The
  // subscription is also how the display registers itself: it holds no PIN and
  // is a VIEWER, so it can make no mutation — it is told, it does not ask.
  //
  // `?displayId=` names a specific screen (#590) — how Race Control's "Open a
  // new display window" button gives a second monitor an id of its own
  // rather than sharing this computer's single stored one.
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
  // #1072): this component's own function body does not unmount when its
  // *return value* changes shape, so `seen`/`showConnectBadge`/`showFlash`
  // survive switching between the view branches below — including into and
  // out of the break overlay, which used to reset them by unmounting
  // whichever `IdentifyPresence` instance the previous branch had rendered.
  const identify = useIdentifyOverlay(assignment);

  const urlIntent = useMemo(() => readUrl(searchParams), [searchParams]);
  const behaviour = useMemo(
    () =>
      resolveView(
        // `assigned` rather than merely having a payload: every connected
        // display receives one, carrying the default view, and treating that
        // as an instruction overrides the URL on every screen the moment it
        // connects — which is the fallback this feature depends on.
        assignment?.assigned
          ? {
              view: assignment.view,
              cycleSeconds: assignment.cycleSeconds,
              scrollBehavior: assignment.scrollBehavior ?? DEFAULT_SCROLL_BEHAVIOR,
              showCheckedIn: assignment.showCheckedIn ?? DEFAULT_SHOW_CHECKED_IN,
              qrTarget: assignment.qrTarget ?? DEFAULT_QR_TARGET,
              showStandingsTicker:
                assignment.showStandingsTicker ?? DEFAULT_SHOW_STANDINGS_TICKER,
            }
          : null,
        urlIntent,
        id,
      ),
    [assignment, urlIntent, id],
  );

  const isProjectorMode = behaviour.projector;
  const shouldCycle = behaviour.cycle;
  const cycleInterval = behaviour.cycleMs;

  const [activeTab, setActiveTab] = useState<'standings' | 'timing'>(behaviour.tab);

  const [showResultsOverlay, setShowResultsOverlay] = useState(false);
  const [overlayData, setOverlayData] = useState<{
    lanes: {
      laneNumber: number;
      place: number | null;
      racerName: string;
      racerImageUrl?: string;
      carName?: string;
      time: number | null;
      scaleMph?: number | null;
    }[];
    recordBreak?: RecordBreak | null;
  } | null>(null);
  const [seenHeatResult, setSeenHeatResult] = useState<SeenHeatResult>(null);

  // Auto-cycling logic (disabled in projector mode)
  useEffect(() => {
    if (!shouldCycle || isProjectorMode) return;

    const interval = setInterval(() => {
      setActiveTab(prev => prev === 'standings' ? 'timing' : 'standings');
    }, cycleInterval);

    return () => clearInterval(interval);
  }, [shouldCycle, cycleInterval, isProjectorMode]);

  // Follow whatever decides the tab — the URL until an assignment arrives, and
  // the assignment after that. Adjusted during render rather than in an
  // effect, for the reason RaceControl pins its heat the same way: an effect
  // shows the old tab for a frame and then corrects it, which on a projector
  // is a visible flick.
  const [prevTab, setPrevTab] = useState(behaviour.tab);
  if (behaviour.tab !== prevTab) {
    setPrevTab(behaviour.tab);
    setActiveTab(behaviour.tab);
  }

  // Ensure body scroll is hidden in the full-screen views. The slideshow is
  // one of them (#175) — it fills the viewport, and a scrollbar down the side
  // of a photo on a projector is exactly the sort of thing nobody notices
  // until the room is full.
  const isFullScreenView =
    isProjectorMode ||
    behaviour.slideshow ||
    behaviour.standingsOnly ||
    behaviour.checkin ||
    behaviour.qrcode ||
    behaviour.overlay;

  // Tell the app's furniture to get out of the way. `Navigation` cannot work
  // this out for itself any more: an assigned view changes no URL, so before
  // this an operator switching a screen to Projector from across the room got
  // the navigation bar painted across the top of it (#175).
  //
  // Unconditional now, not only for the full-screen views above (#958). Every
  // path onto this page is a display: the operator's own list registers it
  // the moment the `displayAssignment` subscription below connects, the
  // shareable "type this address into a screen" address a wall display is
  // handed carries no query string at all (`ConnectDisplayAddress`), and even
  // a screen mid-ceremony round-trips back here with a bare in-app `navigate`
  // (`AwardCeremony.tsx`). There is no remaining path onto `/observation`
  // that is the operator's own operating page, so there is nothing left for
  // the ordinary Standings/Timing/Cycle views to keep the chrome for — the
  // "Live" link that used to reach this page still wearing it is gone from
  // the race row for the same reason (see `Navigation.tsx`'s `links`).
  const { setHidden: setChromeHidden } = useChrome();
  useEffect(() => {
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [setChromeHidden]);

  useEffect(() => {
    if (isFullScreenView) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isFullScreenView]);

  // Initial query for static-ish data (racers)
  const [initialResult, reExecuteInitial] = useQuery({
    query: GET_INITIAL_DATA,
    variables: { id },
    pause: !id || isNaN(id),
  });

  const { data: initialData } = initialResult;

  // What a screen this size — and this heat's own lane count — can afford
  // to show (#1073 part 2) — read once here and passed down to every render
  // below that has a secondary line to drop or a card to size, the same
  // "resolve once, pass down" shape `nameDisplay` and `laneColors` already
  // use on this page. Needs the track's own lane count (an 8-lane track
  // needs a denser heat-card tier than a 6-lane one at the same viewport —
  // see `displayDensity.ts`'s own comment), so it is declared here rather
  // than above `initialData`, and falls back to 4 (`TrackInput`'s own
  // default) before the query has answered.
  const trackLaneCount = initialData?.race?.track?.laneCount ?? 4;
  const density = useDisplayDensity(trackLaneCount);

  // A race whose only round is elimination (#1020) can never populate the
  // ordinary "Overall" aggregate — `services/scoring._scoring_heats`
  // excludes elimination heats from that scope by design
  // (`.claude/rules/scheduling.md`) — so the live standings views below and
  // the "Race complete!" screen both need this round's own standings
  // instead of a subscription that stays empty however completely the race
  // is raced. Computed here, off nothing but the race's own rounds, so it
  // is ready whether or not the race has finished.
  const eliminationOnlyRace = isEliminationOnlyRace(initialData?.race?.rounds ?? []);
  const fallbackEliminationRound = eliminationOnlyRace
    ? defaultEliminationRound(initialData?.race?.rounds ?? [])
    : null;
  // A one-shot query, the same shape the championship round's own result
  // uses below — there is no `roundId`-scoped subscription channel to ride
  // on (see `Subscription.leaderboard`), so a new heat's result reaches
  // this only through the explicit re-fetch in `useRaceStateChanged` below.
  const eliminationFallbackQuery = fallbackEliminationRound
    ? championshipResultQuery(fallbackEliminationRound.id)
    : NOOP_CHAMPIONSHIP_QUERY;
  const [{ data: eliminationFallbackData }, reExecuteEliminationFallback] = useQuery({
    query: eliminationFallbackQuery,
    variables: { id },
    pause: !fallbackEliminationRound,
  });

  // Intermissions (#592) ride the same `race_state:{raceId}` channel every
  // other race-level change already publishes on — no new subscription
  // socket for this screen, just this page's usual "something changed,
  // re-read" hook pointed at the query that already carries `intermission`.
  useRaceStateChanged(id, () => {
    reExecuteInitial({ requestPolicy: 'network-only' });
    if (fallbackEliminationRound) {
      reExecuteEliminationFallback({ requestPolicy: 'network-only' });
    }
  });

  const intermission: IntermissionData = initialData?.race?.intermission ?? NO_INTERMISSION;
  // Ticks the overlay's countdown once a second while it is actually
  // running, and reports whether the break is live right now — shared with
  // `AwardCeremony.tsx` rather than copied (#1072), so the two pages cannot
  // quietly disagree about when a break has ended.
  const intermissionActive = useLiveIntermission(intermission);

  // The ceremony is its own route rather than a tab here, so an assignment to
  // it is a navigation — but not while a break has this screen (#592,
  // #1072): applying the Awards preset mid-countdown must not drop the
  // overlay out from under the room the instant the payload arrives.
  // `intermissionActive` is a dependency precisely so the redirect that was
  // skipped fires the moment the break ends, rather than waiting on
  // `behaviour.redirectTo` to change again.
  useEffect(() => {
    if (behaviour.redirectTo && !intermissionActive) navigate(behaviour.redirectTo, { replace: true });
  }, [behaviour.redirectTo, intermissionActive, navigate]);

  // The Display surface's theme (#498) — this whole page, projector mode or
  // not, is the audience-facing surface the spec means by "Display". Every
  // screen resolves the default option (stored as 'MATCH_APP', shown as
  // "Field Uniform (default)") the same way regardless of what any one
  // device's own App theme happens to be — see `resolveSurfaceKey`'s own
  // comment for why that is the only resolution that can be the same on
  // every wall display in the room (#528).
  //
  // Read off the `displayAssignment` subscription rather than a one-shot
  // query (#586): that subscription is the leash this screen already holds
  // open for the whole event, and `updateInitialConfig` nudges every
  // connected display's own channel when the operator changes the theme in
  // System Settings — so re-deriving from each new payload is what makes a
  // theme change reach an already-open screen with no reload. Before the
  // first payload arrives this falls back to the default, same as before.
  const displayThemeSetting: SurfaceThemeSetting =
    (assignment?.displayThemeSetting as SurfaceThemeSetting | undefined) ?? 'MATCH_APP';
  const { key: displayThemeKey, theme: displayTheme } = resolveDisplayTheme(displayThemeSetting);
  const displayThemeStyle = displayTheme.tokens as React.CSSProperties;

  // Subscriptions for real-time data
  const [{ data: leaderboardData }] = useSubscription({
    query: LeaderboardSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const [{ data: onDeckData }] = useSubscription({
    query: OnDeckSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const [{ data: currentlyRacingData }] = useSubscription({
    query: CurrentlyRacingSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const [{ data: timingStatsData }] = useSubscription({
    query: TimingStatsSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const [{ data: activeFreeRaceData }] = useSubscription({
    query: ActiveFreeRaceHeatSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  // Which heat the timer is armed for — the only thing that knows what is
  // physically on the track. The same subscription `TimerStatusBadge` already
  // opens, so this costs nothing extra.
  const trackId: number | undefined = initialResult.data?.race?.track?.id;
  const [{ data: timerData }] = useSubscription({
    query: TIMER_STATUS_SUBSCRIPTION,
    variables: { trackId: trackId ?? 0 },
    pause: !trackId,
  });

  // Sync results overlay state during render. `observeHeatResult` is the
  // `seen === null` rule from `roundCompletion.ts`: the subscription's
  // opening payload (on load, or on reconnect) is history, not news, and the
  // key includes `recordedAt` so a re-recorded heat — which reuses its round
  // name and heat number — is news a second time (#335).
  if ((isProjectorMode || behaviour.overlay) && timingStatsData?.timingStats) {
    const observation = observeHeatResult(seenHeatResult, timingStatsData.timingStats);
    if (observation.seen !== seenHeatResult) {
      setSeenHeatResult(observation.seen);
      if (observation.isNew) {
        setOverlayData(timingStatsData.timingStats);
        setShowResultsOverlay(true);
      }
    }
  }

  // Effect to handle overlay timeout. The broadcast overlay lingers longer
  // (#616, issue's own "10 seconds") than the Projector view's own results
  // overlay — a viewer joining a stream mid-heat has had no chance to see
  // the schedule build up to it the way someone standing in the room has,
  // so the finish banner gets more time to actually be read.
  useEffect(() => {
    if (showResultsOverlay) {
      const timer = setTimeout(() => {
        setShowResultsOverlay(false);
      }, behaviour.overlay ? 10000 : 5000);
      return () => clearTimeout(timer);
    }
  }, [showResultsOverlay, seenHeatResult, behaviour.overlay]);

  // Play sound effects for heat finish or track record break (#554).
  // Off by default on audience displays, remembered per device.
  useEffect(() => {
    if (showResultsOverlay && overlayData) {
      if (overlayData.recordBreak && isSoundEffectEnabled('recordBreak')) {
        playRecordBreakSound();
      } else if (isSoundEffectEnabled('finish')) {
        playFinishSound();
      }
    }
  }, [showResultsOverlay, seenHeatResult, overlayData]);

  interface Racer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number;
    racerImageUrl?: string;
    carName?: string;
    racingGroupId?: number | null;
    carPassedInspection?: boolean;
  }

  const racersMap = useMemo(() => {
    const map: Record<number, Racer> = {};
    initialData?.race?.racers.forEach((r: Racer) => map[r.id] = r);
    return map;
  }, [initialData]);

  // Racing group category, for the branding SPEC.md asked for (#298) — a
  // racing group's category shown as a label wherever a racer's racingGroup
  // is otherwise implicit on this screen.
  const racingGroupsMap = useMemo(() => {
    const map: Record<number, RacingGroupInfo> = {};
    initialData?.race?.racingGroups?.forEach((d: RacingGroupInfo) => map[d.id] = d);
    return map;
  }, [initialData]);

  const racingGroupDivisionFor = (racer: Racer | undefined): string | null => {
    if (!racer || racer.racingGroupId == null) return null;
    return racingGroupsMap[racer.racingGroupId]?.division ?? null;
  };

  const officialCurrentHeat = currentlyRacingData?.currentlyRacing;
  // Two heats now, nearest first (#209). One was not enough to stage with: the
  // child it names is in the bleachers rather than watching the screen, so by
  // the time their heat is on it the announcer is already calling them.
  const onDeckHeats = onDeckData?.onDeck ?? [];
  const onDeckHeat = onDeckHeats[0];
  const afterThatHeat = onDeckHeats[1];
  const standings = (leaderboardData?.leaderboard || []) as Standing[];
  const lastHeatResults = timingStatsData?.timingStats;
  const activeFreeRace = activeFreeRaceData?.activeFreeRaceHeat;

  // Through Leaderboard.tsx's own scoreLabel/formatScore (#763) — this used
  // to be a private reimplementation of both, with a comment claiming to
  // mirror them while actually printing a TIMED average to four decimals
  // where every other screen (the projector view below, and the operator's
  // own Standings page) prints three. One rule, in one module, is what
  // keeps "3.4141s" on this wall and "3.414s" on that one from happening
  // again.
  const scoringStrategy = initialData?.race?.scoringStrategy || 'TIMED';
  // How much of a racer's name this audience-facing page may show (#552) —
  // resolved server-side, never null once the race has answered; `'FULL'`
  // is exactly what every install showed before this setting existed, so
  // there is nothing to do while the query is still in flight.
  const nameDisplay = initialData?.race?.resolvedNameDisplay ?? 'FULL';
  // This track's configured lane colours (#611) — read once here and passed
  // to both `renderHeatCard` and `renderProjectorRacers` rather than each
  // re-deriving it, the same "resolve once, pass down" shape `nameDisplay`
  // itself uses on this page.
  const laneColors = initialData?.race?.track?.laneColors ?? [];
  const scoreLabel = scoreLabelFor(scoringStrategy);
  const formatScore = (score: number) => formatScoreShared(score, scoringStrategy);
  // The projector's own row already carries `scoreLabel` as a second line
  // beneath the number (see the render below), so it needs the bare value
  // with no trailing unit rather than a second copy of the same word.
  const formatProjectorScore = (score: number) =>
    formatScoreShared(score, scoringStrategy, { unit: false });
  // The DNF note beside a score (#898) — one function for every standings
  // surface this page renders (the audience Standings tab, the projector's
  // top-5 panel, and the Standings-only and Broadcast Overlay views below),
  // the same "resolve once, pass down" shape `formatScore` itself uses.
  const dnfAnnotation = (dnfCount: number) => dnfAnnotationShared(dnfCount, scoringStrategy);

  // "The race is finished" (#869) — every officially scheduled heat
  // recorded, nothing on the track, nothing on deck, no exhibition run
  // armed. `raceFinished.ts` decides this purely off data the page already
  // has the shape of, the same reasoning `pace.ts` computes client-side
  // rather than as a new resolver.
  const finished = raceIsFinished(
    initialData?.race?.heats ?? [],
    !!officialCurrentHeat,
    !!onDeckHeat,
    !!activeFreeRace,
  );
  // The *last* championship round, if the race ran one (#549's chained
  // finals wire each round after the first to the previous, so this is the
  // one whose result the room actually cares about) — `null` falls back to
  // the overall standings below. Cheap enough (a filter and a reduce over a
  // handful of rounds) to compute plainly rather than memoize.
  const finalRound = finalChampionshipRound(initialData?.race?.rounds ?? []);
  // A one-shot query for that round's own placings — only run once the race
  // is actually finished, since it is a snapshot rather than a live
  // subscription (there is no `roundId`-scoped leaderboard channel to
  // subscribe to; see `Subscription.leaderboard` on the backend). urql keys
  // an operation on the query's own text, so a fresh string with identical
  // content each render is not a fresh request.
  const finalRoundQuery = finalRound ? championshipResultQuery(finalRound.id) : NOOP_CHAMPIONSHIP_QUERY;
  const [{ data: finalRoundData }] = useQuery({
    query: finalRoundQuery,
    variables: { id },
    pause: !finished || !finalRound,
  });
  const finalRoundEntries = (finalRoundData?.race?.leaderboard ?? []) as Standing[];
  // Only a round that has actually been raced supplies its own table — the
  // same "nobody's raced yet is nobody's business" rule the printed results
  // sheet's `championshipSections` follows (#869), so a championship round
  // that exists but is still all placeholders never headlines this panel.
  const hasFinalRoundResult = finalRoundEntries.some((s) => s.heatsCompleted > 0);
  // The elimination round's own standings (#1020) — the fallback for a race
  // with no championship round at all, where `standings` (the ordinary
  // prelim aggregate) is empty by design rather than for lack of racing.
  const eliminationFallbackEntries = (eliminationFallbackData?.race?.leaderboard ?? []) as Standing[];
  const hasEliminationFallbackResult = eliminationFallbackEntries.some((s) => s.heatsCompleted > 0);
  const usingChampionshipResult = hasFinalRoundResult && !!finalRound;
  const usingEliminationResult =
    !usingChampionshipResult && eliminationOnlyRace && hasEliminationFallbackResult;
  const finishedStandingsSource = usingChampionshipResult
    ? finalRoundEntries
    : usingEliminationResult
      ? eliminationFallbackEntries
      : standings;
  const finishedStandings = finishedStandingsSource.map((s) => {
    const racer = racersMap[s.racerId];
    return {
      racerId: s.racerId,
      rank: s.rank,
      firstName: racer?.firstName ?? '',
      lastName: racer?.lastName ?? '',
      carNumber: racer?.carNumber,
      racerImageUrl: racer?.racerImageUrl,
      score: s.score,
    };
  });
  const finishedRoundLabel = usingChampionshipResult && finalRound
    ? championshipRoundLabel(finalRound)
    : usingEliminationResult && fallbackEliminationRound
      ? championshipRoundLabel(fallbackEliminationRound)
      : null;
  // A loss count, never a time — the same "Losses" column/formatting
  // `Leaderboard.tsx`'s own `isEliminationRound` branch uses, applied
  // wherever this page is showing an elimination round's own standings
  // rather than the race's ordinary scoring strategy.
  const finishedScoreLabel = usingEliminationResult ? 'Losses' : scoreLabel;
  const finishedFormatScore = usingEliminationResult
    ? (score: number) => `${Math.round(score)}`
    : formatScore;

  // What the live (not-yet-finished) standings views show — the Standings
  // tab in standard mode and the STANDINGS_ONLY view. `standings` (the
  // prelim aggregate subscription) stays empty for the whole of an
  // elimination-only race, so those two read the same fallback the
  // finished screen above uses, rather than a permanently blank table.
  const effectiveStandings = eliminationOnlyRace ? eliminationFallbackEntries : standings;
  const effectiveScoreLabel = eliminationOnlyRace ? 'Losses' : scoreLabel;
  const effectiveFormatScore = eliminationOnlyRace
    ? (score: number) => `${Math.round(score)}`
    : formatScore;

  // The Standings tab pages through the leaderboard rather than growing the
  // page underneath it (#1073 part 2) — nobody scrolls an audience display,
  // so a roster that does not fit one screen used to mean rank 9 onward was
  // simply never seen at a small viewport. `useMeasuredPages` is the same
  // mechanism `StandingsOnlyView` already uses for the full-screen
  // `STANDINGS_ONLY` view, reused here for the tab; the operator's existing
  // per-display "seconds" and paging/auto-scroll settings (`behaviour.
  // cycleMs`/`behaviour.scrollBehavior`) are the cadence, unchanged and with
  // no new control to learn — see `displays.md`'s "What a small screen
  // drops". Declared here, ahead of every early `return` below (the
  // slideshow, `STANDINGS_ONLY`, check-in, QR code, overlay, projector and
  // race-finished branches all return before "STANDARD MODE RENDER"), so
  // these hooks still run on every render regardless of which view is
  // showing — conditionally calling a hook is what the standard-mode-only
  // shape below would otherwise be.
  const standingsWrapperRef = useRef<HTMLDivElement>(null);
  const standingsTableRef = useRef<HTMLTableElement>(null);
  const standingsHeadRef = useRef<HTMLTableSectionElement>(null);
  const standingsRowRef = useRef<HTMLTableRowElement>(null);
  const [standingsHeadHeightPx, setStandingsHeadHeightPx] = useState(0);
  // A measured row height, once one has actually rendered, in place of
  // `useMeasuredPages`'s own default guess (#1073 part 2) — that default is
  // tuned to `StandingsOnlyView`'s more compact row, and this table's own
  // row is a different (if now much closer) size.
  const [standingsRowHeightPx, setStandingsRowHeightPx] = useState<number | undefined>(undefined);

  // The `<thead>` and first `.standing-row`'s own real heights, fed to
  // `useMeasuredPages` below as `reservePx`/`approxRowHeightPx` (#1073 part
  // 2) — the wrapper's own height is now a CSS-guaranteed remainder (see the
  // render below), so this effect's only job is measuring what is *inside*
  // it accurately enough to turn that height into a correct row count,
  // rather than the wrapper's height itself. A `ResizeObserver` on the
  // wrapper (rather than only this effect's own dependencies) is what
  // catches a freshly-rendered first row, or a racer's avatar image
  // finishing its load and nudging the row's own height, after the fact. A
  // no-op whenever the standard-mode Standings tab is not actually on
  // screen — `activeTab` covers "not on the Standings tab", and
  // `standingsWrapperRef.current` being `null` covers every other view
  // entirely, since only the standard mode's own JSX attaches this ref.
  useEffect(() => {
    if (activeTab !== 'standings') return;
    const measure = () => {
      const head = standingsHeadRef.current;
      if (head) setStandingsHeadHeightPx(head.getBoundingClientRect().height);
      const row = standingsRowRef.current;
      if (row) setStandingsRowHeightPx(row.getBoundingClientRect().height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || !standingsWrapperRef.current) {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(standingsWrapperRef.current);
    return () => observer.disconnect();
  }, [activeTab]);

  const standingsPages = useMeasuredPages(standingsWrapperRef, standingsTableRef, effectiveStandings, {
    behavior: behaviour.scrollBehavior,
    cycleMs: behaviour.cycleMs,
    reservePx: standingsHeadHeightPx,
    // Falls back to the hook's own default guess until a real row has
    // rendered and been measured — same "guess, then measure" shape as
    // `standingsHeadHeightPx` and `standingsMaxHeightPx` above.
    ...(standingsRowHeightPx !== undefined ? { approxRowHeightPx: standingsRowHeightPx } : {}),
  });

  // The projector's own *stacked* layout (#1143, `density.projectorStacked`)
  // measures its Current Standings panel the same way the standard mode's
  // Standings tab does above — a container with `flex: 1, minHeight: 0,
  // overflow: hidden` gets a real, CSS-guaranteed remainder under the heat
  // cards' own fixed ceiling (`density.projectorHeatCardsMaxHeightVh`), and
  // `useMeasuredPages` turns that measured height into a row count. Unlike
  // the Standings tab, this panel never pages or scrolls through the rest
  // of the roster — `cycleMs` is set far beyond anything that could elapse
  // during a race, so `pageForElapsed` always answers page 0, and only
  // `pageSize` (how many rows fit) is actually read below; `visible`/`page`/
  // `offset` are unused. A row here is a different, vmin-sized shape than
  // the Standings tab's own (an avatar plus a two-line name, sized off this
  // page's own `vmin` units rather than the standard mode's px-based
  // layout), so it gets its own `approxRowHeightPx` — ~15.5vmin measured
  // directly against `displayResolutions.spec.ts`'s own 820×1180 and
  // 768×1024 cases, rounded up to 17 for the DNF-annotation line (#1145)
  // that can add a third line to a row this guess does not otherwise
  // account for. `Math.min(window.innerWidth, window.innerHeight)` is this
  // page's own `1vmin` in pixels; `useDisplayDensity`'s own resize listener
  // is what makes reading `window` here safe to do plainly rather than
  // through a second listener of this hook's own.
  const projectorStandingsWrapperRef = useRef<HTMLDivElement>(null);
  const projectorStandingsTableRef = useRef<HTMLTableElement>(null);
  const projectorVminPx =
    typeof window !== 'undefined' ? Math.min(window.innerWidth, window.innerHeight) / 100 : 8;
  const PROJECTOR_STANDINGS_ROW_HEIGHT_VMIN = 17;
  const projectorStandingsPages = useMeasuredPages(
    projectorStandingsWrapperRef,
    projectorStandingsTableRef,
    effectiveStandings,
    {
      behavior: 'PAGING',
      cycleMs: Number.MAX_SAFE_INTEGER,
      approxRowHeightPx: PROJECTOR_STANDINGS_ROW_HEIGHT_VMIN * projectorVminPx,
    },
  );

  // The projector layout's own "Current Standings" panel (below) prints the
  // bare number with no unit, same reasoning as `formatProjectorScore`
  // above — an elimination round's own loss count needs the identical
  // no-unit rounding, not a second copy of `formatScoreShared`'s time
  // formatting.
  const effectiveFormatProjectorScore = eliminationOnlyRace
    ? (score: number) => `${Math.round(score)}`
    : formatProjectorScore;

  /** Is the thing on the track an exhibition run? (#142)
   *
   * The timer decides, because the timer is what the operator armed. This used
   * to be `!officialCurrentHeat && activeFreeRace`, and `currentlyRacing`
   * returns the first *unfinished* official heat — so it was truthy for the
   * whole event, and a free race only reached the wall before a schedule
   * existed or after the last heat had run. Which is to say: never, during the
   * event, which is the only time anyone wants one.
   *
   * `activeFreeRaceHeat` alone is not enough either. A free heat created and
   * abandoned stays "active" until it is run or deleted, and it is not on the
   * track just because nobody tidied it up.
   */
  const armedHeatId: number | null = timerData?.timerStatus?.status?.activeHeatId ?? null;
  const isExhibition = !!activeFreeRace && armedHeatId === activeFreeRace.id;

  /** A car on the track, with the lane it is actually in.
   *
   * The lane travels with the racer (#141). Dropping it and numbering by
   * position is only right when every lane is full: a vacated lane — a racer
   * deleted after the schedule was generated — or an undecided championship
   * slot closes the gap, and every car after it gets announced one lane low.
   */
  interface LaneEntry {
    lane: number;
    racer: Racer;
  }

  // A lane with no `racerId` is either empty or an undecided championship slot;
  // either way there is no one to put on the screen, so both drop out here.
  const racersInLanes = (
    lanes: readonly { lane: number; racerId?: number | null }[],
  ): LaneEntry[] =>
    lanes
      .map((l) => (l.racerId == null ? null : { lane: l.lane, racer: racersMap[l.racerId] }))
      .filter((entry): entry is LaneEntry => entry !== null && entry.racer !== undefined);

  const currentHeatRacers = useMemo(() => {
    // The exhibition first: if the timer is armed for it, it is the thing on
    // the track, and the scheduled heat is merely next.
    if (isExhibition && activeFreeRace) return racersInLanes(activeFreeRace.lanes);
    if (officialCurrentHeat) return racersInLanes(officialCurrentHeat.lanes);
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officialCurrentHeat, isExhibition, activeFreeRace, racersMap]);

  const nextHeatRacers = useMemo(
    () => (onDeckHeat ? racersInLanes(onDeckHeat.lanes) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDeckHeat, racersMap],
  );

  const afterThatRacers = useMemo(
    () => (afterThatHeat ? racersInLanes(afterThatHeat.lanes) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [afterThatHeat, racersMap],
  );

  if (!id || isNaN(id)) return <div className="container" style={{ padding: '20px' }}>Invalid Race ID</div>;

  // The break screen takes over the whole display, whatever view it was
  // assigned (#592) — a break is a fact about the race, not about which of
  // standings/timing/projector/slideshow/standings-only a screen happened to
  // be showing when the operator called it. `IdentifyPresence` renders here
  // too (#1071) — Identify is exactly the command an operator reaches for
  // during a break, when there is time to work out which screen is which,
  // and the flash is a brief, operator-initiated 4s overlay rather than a
  // standing distraction from the countdown.
  if (intermissionActive) {
    return (
      // `padding: 0` (#1073) — every sibling full-screen branch below either
      // sets its own padding explicitly or has `boxSizing: 'border-box'`
      // somewhere in the chain; this one had neither, so the *generic*
      // `.container` class's own `padding: 20px` (`index.css`) applied
      // unopposed — `.projector-mode .container`'s override only matches a
      // `.container` *nested inside* a `.projector-mode` ancestor, never an
      // element carrying both classes at once, which is what this div does.
      // With `min-height: 100vh` and the default `box-sizing: content-box`,
      // that 20px top and bottom padding added a full 40px past the
      // viewport's own height — invisible on an ordinary monitor with room
      // to spare, and exactly what pushed this page into needing to scroll
      // at 800×600. `IntermissionOverlay` and `RaceFinishedOverlay` below
      // both paint themselves full-bleed (`position: fixed; inset: 0`), so
      // this wrapper needs no padding of its own at all.
      <div className="container projector-mode" data-theme={displayThemeKey} style={{ padding: 0, ...displayThemeStyle }}>
        <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />
        <IntermissionOverlay
          intermission={intermission}
          nextUpRacers={nextHeatRacers.map(({ lane, racer }) => ({
            lane,
            firstName: racer.firstName,
            lastName: racer.lastName,
            carNumber: racer.carNumber,
          }))}
          nextUpInfo={onDeckHeat ? `Round ${onDeckHeat.roundNumber}, Heat ${onDeckHeat.globalHeatNumber ?? onDeckHeat.heatNumber}` : null}
          vehicleLabel={vehicle}
        />
      </div>
    );
  }

  const renderHeatCard = (title: string, entries: LaneEntry[], isNext: boolean = false, iconPath?: string, heatInfo?: string, exhibition?: boolean) => {
    const isEmpty = entries.length === 0;

    // The phone tier (#1144): a 2-column lane grid in `rem`s rather than the
    // vmin-sized single row below. `rem` because this tier is read a foot
    // from someone's face rather than from across a gym, so a size that
    // reads correctly on a phone regardless of exactly how tall it is
    // (unlike `vmin`/`vh`, which the desktop card is deliberately sized in)
    // is the right unit here. Two columns, not one row of however many lanes
    // this heat holds — a four- or six-lane heat in one row at 390px wide
    // is exactly the 9px-name failure #1144 reported; wrapping at two lets
    // every card stay above the legibility floor with real margin. Reuses
    // the desktop render's own class names (`heat-card`, `heat-card-racer`,
    // …) so a selector written against one tier still finds the other.
    if (density.phoneTier) {
      return (
        <div className="heat-card" style={{ marginBottom: '1.25rem' }}>
          <h2
            className="heat-card-title"
            style={{
              margin: '0 0 0.6rem',
              fontSize: '1.1rem',
              color: isNext ? 'var(--display-text-muted-color)' : 'var(--display-text-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              flexWrap: 'wrap',
            }}
          >
            {iconPath && <Icon path={iconPath} size="1rem" color={isNext ? 'var(--display-text-muted-color)' : 'var(--error)'} />}
            <span>{title}</span>
            {exhibition && (
              <span
                style={{
                  background: 'var(--display-accent-color)',
                  color: 'var(--display-on-accent-color)',
                  fontSize: '0.7rem',
                  fontWeight: 'bold',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Exhibition
              </span>
            )}
            {heatInfo && (
              <span style={{ fontSize: '0.85rem', fontWeight: 'normal', color: 'var(--display-text-muted-color)' }}>
                ({heatInfo})
              </span>
            )}
          </h2>
          {isEmpty ? (
            <p style={{ margin: 0 }}>No heat scheduled</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.6rem' }}>
              {entries.map(({ lane, racer }: LaneEntry) => (
                <div
                  key={lane}
                  className="heat-card-racer"
                  style={{
                    textAlign: 'center',
                    padding: '0.6rem',
                    background: 'var(--display-card-bg-color)',
                    borderRadius: '8px',
                    minWidth: 0,
                  }}
                >
                  <LaneBadge
                    color={colorForLane(laneColors, lane)}
                    className="heat-card-lane"
                    style={{ justifyContent: 'center', fontWeight: 'bold', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--display-text-subtle-color)' }}
                  >
                    Lane {lane}
                  </LaneBadge>
                  <RacerAvatar
                    racer={{
                      id: racer.id,
                      first_name: racer.firstName,
                      last_name: racer.lastName,
                      racer_image_url: shouldShowRacerPhoto(nameDisplay) ? racer.racerImageUrl : null,
                    }}
                    size="3.2rem"
                    style={{ margin: '0 auto 0.3rem', border: '2px solid var(--display-border-color)' }}
                  />
                  <div className="heat-card-racer-name" style={{ fontWeight: 'bold', fontSize: '1rem', overflowWrap: 'break-word' }}>
                    {formatDisplayName(nameDisplay, racer.firstName, racer.lastName)}
                  </div>
                  {racer.carNumber && (
                    <div className="heat-card-car-number" style={{ fontSize: '0.85rem', color: 'var(--display-text-muted-color)' }}>
                      {vehicle} #{racer.carNumber}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // Every lane in one row, always — never wrapped onto a second row of
    // avatars (#1073 part 2). A fixed column count (not `auto-fit`, which
    // is what used to wrap) is what guarantees it: `minmax(0, 1fr)` lets a
    // column shrink past its content's own natural width, so a long name
    // wraps *within* its column instead of forcing the grid onto a second
    // line. Measured directly rather than assumed: capping columns at
    // three and letting six lanes wrap to two rows — the tempting fix for
    // a card sharing the row with a sibling, where six columns are
    // narrower still — cost *more* height than six narrow columns of
    // wrapped text did, because it doubles the one thing that actually
    // multiplies a card's height (the avatar row count) to save the one
    // thing that only adds a line or two (a wrapped name). One row, however
    // narrow its columns, beats two rows of wider ones.
    // The grid still renders exactly as many columns as *this* heat's own
    // occupied lanes (a heat can hold fewer than the track's full count —
    // the last one of an uneven round, a lane out of service), but sizing
    // — avatar, font, padding, all of it — is tiered off `density.
    // heatCardCompactness`, which is the *track's* configured lane count,
    // not this one heat's. Every card in the row (Now Racing, On Deck,
    // After That) is sized as if it were full, deliberately: a schedule
    // where one heat happens to be short a racer must not size that one
    // card larger than its siblings, and the on-deck-depth budget below
    // already assumes the worst (full) case for the whole row.
    const columns = Math.max(entries.length, 1);
    // The avatar (and the text beneath it) shrink as more lanes share a row
    // — a six-lane card's columns are a sixth (or, sharing the row, a
    // third) of the available width, and an avatar sized for two lanes
    // would be wider than that column has to give it. Tiered, not a
    // continuous formula, so the sizes at issue are pinned in
    // `displayResolutions.spec.ts` rather than able to drift by a fraction
    // of a `vh` with no test noticing. Every tier stays at or above 2.0vmin
    // for the name/car-number text — the legibility floor is 2% of
    // viewport height and `vmin` equals `vh` at every viewport this app
    // targets (landscape, `CLAUDE.md`'s own table), so this keeps a safety
    // margin above it rather than sitting exactly on the line. Tier 3 (more
    // than six lanes — an 8-lane track's own ceiling) keeps that same text
    // size and shrinks everything else instead, since text cannot go lower
    // without crossing the floor; see `AFTER_THAT_MAX_LANE_COUNT` in
    // `displayDensity.ts` for what happens when even that is not enough.
    const compactness = density.heatCardCompactness;
    const heatCardAvatarVh = [9, 6, 3.8, 3.0][compactness];
    const heatCardNameVmin = [2.6, 2.2, 2.0, 2.0][compactness];
    const heatCardCarNumberVmin = [2.3, 2.0, 2.0, 2.0][compactness];
    const heatCardGridGapPx = [15, 8, 5, 3][compactness];
    const heatCardCellPaddingPx = [10, 6, 4, 3][compactness];
    // The card's own outer padding and title size shrink on the same tiers
    // (#1073 part 2) — a fixed 20px/3.2vmin was tuned for the two-or-fewer-
    // lane case and, multiplied by nothing more than "this card exists" (it
    // does not scale with lane count the way the grid above does), still
    // cost enough at six lanes to leave the Standings table short of its
    // own guaranteed rows even after the grid itself stopped multiplying.
    // Every tier stays comfortably clear of the legibility floor — this is
    // a heading, not one of the floor's own name/car-number/place/time
    // cells.
    const heatCardPaddingPx = [20, 12, 6, 5][compactness];
    const heatCardTitleVmin = [3.2, 2.6, 2.2, 2.0][compactness];

    return (
      <div className="heat-card" style={{
        flex: 1,
        minWidth: '300px',
        background: isEmpty ? 'var(--display-bg-color)' : 'var(--display-surface-color)',
        borderRadius: '8px',
        padding: `${heatCardPaddingPx}px`,
        boxShadow: isEmpty ? 'none' : '0 2px 8px rgba(0,0,0,0.1)',
        borderTop: `5px solid ${isNext ? 'var(--display-text-faint-color)' : 'var(--error)'}`,
        opacity: isEmpty ? 0.7 : 1,
        textAlign: isEmpty ? 'center' : 'left'
      }}>
        <h2 className="heat-card-title" style={{
          marginTop: 0,
          // `vmin`, not `rem` (#1073) — this is the Display surface, read
          // from across a room at every viewport from an 800×600 projector
          // up; a fixed `rem` looks fine at the one size it was tuned at and
          // falls under the legibility floor everywhere taller.
          fontSize: `${heatCardTitleVmin}vmin`,
          color: isNext ? 'var(--display-text-muted-color)' : 'var(--display-text-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '1vmin',
          justifyContent: isEmpty ? 'center' : 'flex-start'
        }}>
          {iconPath && <Icon path={iconPath} size={`${heatCardTitleVmin}vmin`} color={isNext ? 'var(--display-text-muted-color)' : 'var(--error)'} />}
          <span>{title}</span>
          {exhibition && (
            <span style={{
              background: 'var(--display-accent-color)',
              color: 'var(--display-on-accent-color)',
              fontSize: '1.8vmin',
              fontWeight: 'bold',
              padding: '0.4vmin 1vmin',
              borderRadius: '12px',
              marginLeft: '1vmin',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Exhibition
            </span>
          )}
          {heatInfo && (
            <span style={{ fontSize: '2vmin', fontWeight: 'normal', color: 'var(--display-text-muted-color)', marginLeft: 'auto' }}>({heatInfo})</span>
          )}
        </h2>

        {isEmpty ? (
          <p>No heat scheduled</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: `${heatCardGridGapPx}px`,
            }}
          >
            {entries.map(({ lane, racer }: LaneEntry) => (
              <div
                key={lane}
                className="heat-card-racer"
                style={{
                  textAlign: 'center',
                  padding: `${heatCardCellPaddingPx}px`,
                  background: 'var(--display-card-bg-color)',
                  borderRadius: '8px',
                  // `minWidth: 0` lets this cell (and the text inside it)
                  // actually shrink to the grid column's own width rather
                  // than forcing the column wider — the default `min-width:
                  // auto` on a grid item is its content's own min-content
                  // size, which for an unbroken long name is wide enough to
                  // defeat the fixed column count above.
                  minWidth: 0,
                }}
              >
                <LaneBadge
                  color={colorForLane(laneColors, lane)}
                  className="heat-card-lane"
                  style={{
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    marginBottom: compactness === 0 ? '5px' : '2px',
                    fontSize: compactness === 0 ? '1.8vmin' : '1.5vmin',
                    color: 'var(--display-text-subtle-color)',
                  }}
                >
                  Lane {lane}
                </LaneBadge>
                <RacerAvatar
                  racer={{
                    id: racer.id,
                    first_name: racer.firstName,
                    last_name: racer.lastName,
                    racer_image_url: shouldShowRacerPhoto(nameDisplay) ? racer.racerImageUrl : null
                  }}
                  size={`${heatCardAvatarVh}vh`}
                  style={{ margin: compactness === 0 ? '0 auto 5px' : '0 auto 2px', border: '2px solid var(--display-border-color)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                />
                <div className="heat-card-racer-name" style={{ fontWeight: 'bold', fontSize: `${heatCardNameVmin}vmin`, overflowWrap: 'break-word' }}>
                  {formatDisplayName(nameDisplay, racer.firstName, racer.lastName)}
                </div>
                {racer.carNumber && <div className="heat-card-car-number" style={{ fontSize: `${heatCardCarNumberVmin}vmin`, color: 'var(--display-text-muted-color)' }}>{vehicle} #{racer.carNumber}</div>}
                {/* Dropped below the legibility threshold (#1073 part 2) —
                    `displayDensity.ts`: on a narrow projector this second
                    line costs a row the audience would rather have, and the
                    racer's name and car number (kept unconditionally above)
                    are what the room actually reads a heat card for. */}
                {density.showSecondaryText && racingGroupDivisionFor(racer) && (
                  <div className="heat-card-racing-group-division" style={{ fontSize: '2vmin', color: 'var(--display-text-subtle-color)' }}>
                    {racingGroupDivisionFor(racer)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderResultsOverlay = () => {
    if (!showResultsOverlay || !overlayData) return null;

    const sortedLanes = [...overlayData.lanes].sort((a, b) => (a.place || 99) - (b.place || 99));

    return (
      <div className="results-overlay">
        {overlayData.recordBreak && (
          <div className="overlay-record-banner" data-testid="record-banner">
            <div className="overlay-record-headline">
              <Icon path={mdiTrophy} size="4vmin" color="var(--display-bg-color, #0A0A0A)" /> New track record!
            </div>
            <div className="overlay-record-detail">
              {recordBreakDetail(overlayData.recordBreak)}
            </div>
          </div>
        )}
        <h1 className="overlay-title">Heat Results</h1>
        <div className="overlay-results-list">
          {sortedLanes.map((lane, idx) => (
            <div
              key={lane.laneNumber}
              className={`overlay-result-item ${lane.place === 1 ? 'first-place' : lane.place === 2 ? 'second-place' : lane.place === 3 ? 'third-place' : ''}`}
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              {/* `vmin`, not `px`/`rem` (#1073) — this row used to be a fixed
                  300px wide with a 5rem numeral regardless of viewport, which
                  is what made the results overlay crop at 800×600 rather
                  than merely look small; the numeral now inherits
                  `.overlay-rank`'s own `5.5vmin` (index.css) instead of
                  overriding it. */}
              <div className="overlay-rank" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '2vmin', minWidth: '18vmin', width: 'auto' }}>
                {lane.place === 1 && <Icon path={mdiTrophy} size="7vmin" color="#FFD700" />}
                {lane.place === 2 && <Icon path={mdiTrophy} size="6vmin" color="#C0C0C0" />}
                {lane.place === 3 && <Icon path={mdiTrophy} size="5vmin" color="#CD7F32" />}
                <span style={{ lineHeight: 1 }}>
                  {lane.place === 1 ? '1st' : lane.place === 2 ? '2nd' : lane.place === 3 ? '3rd' : (lane.place || '-')}
                </span>
              </div>
              <RacerAvatar
                racer={{
                  id: 0,
                  first_name: lane.racerName,
                  last_name: '',
                  // `lane.racerName` is already resolved server-side
                  // (#552's `Subscription.timing_stats` — there is no raw
                  // first/last pair here for the frontend to reformat), so
                  // only the photo needs gating here.
                  racer_image_url: shouldShowRacerPhoto(nameDisplay) ? lane.racerImageUrl : undefined
                }}
                size="14vmin"
                style={{ margin: '0 3vmin', border: '0.4vmin solid var(--display-text-color)', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
              />
              <div className="overlay-racer-info">
                <div className="overlay-racer-name">{lane.racerName}</div>
                <div className="overlay-car-name">{lane.carName || `Lane ${lane.laneNumber}`}</div>
              </div>
              <div className="overlay-time">
                {formatLaneTime(lane.time)}
                {formatScaleMph(lane.scaleMph) && (
                  <span className="overlay-scale-mph"> · {formatScaleMph(lane.scaleMph)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // --- SLIDESHOW (#175) ---
  // Ahead of both other modes: it is a full-screen view of its own rather than
  // a tab, and it deliberately shows none of the race furniture — the point is
  // the photographs, on a screen across a room.
  if (behaviour.slideshow) {
    return (
      <div
        className="container projector-mode"
        data-theme={displayThemeKey}
        style={{ maxWidth: '100%', padding: 0, background: 'var(--display-surface-alt-color)', ...displayThemeStyle }}
      >
        <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />
        <PhotoSlideshow
          racers={initialData?.race?.racers ?? []}
          racingGroups={initialData?.race?.racingGroups ?? []}
          intervalMs={behaviour.cycleMs}
          loading={initialResult.fetching && !initialData}
          nameDisplay={nameDisplay}
        />
      </div>
    );
  }

  // --- STANDINGS ONLY (#663) ---
  // The leaderboard, full-screen — no Now Racing / On Deck panels, for a pack
  // whose standings do not fit alongside them. Ahead of the standard mode
  // render for the same reason the slideshow is: this is a view of its own,
  // not a tab within the usual layout.
  if (behaviour.standingsOnly) {
    return (
      <div
        className="container projector-mode"
        data-theme={displayThemeKey}
        style={{
          maxWidth: '100%',
          padding: 0,
          background: 'var(--display-bg-color)',
          color: 'var(--display-text-color)',
          ...displayThemeStyle,
        }}
      >
        {/* The phone tier (#1144): the badge moves into the flow, above the
            title, rather than its ordinary fixed top-right corner — at
            390px wide that corner sits on top of the standings table's own
            "Runs" header, which is the collision the issue reported. Every
            wider screen keeps the fixed-corner treatment unchanged. */}
        {density.phoneTier ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.75rem 0.75rem 0' }}>
            <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} inline />
          </div>
        ) : (
          <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />
        )}
        <StandingsOnlyView
          standings={effectiveStandings}
          racersMap={racersMap}
          nameDisplay={nameDisplay}
          scoreLabel={effectiveScoreLabel}
          formatScore={effectiveFormatScore}
          dnfAnnotation={dnfAnnotation}
          vehicle={vehicle}
          scrollBehavior={behaviour.scrollBehavior}
          cycleMs={behaviour.cycleMs}
          phoneTier={density.phoneTier}
        />
      </div>
    );
  }

  // --- CHECK-IN (#612) ---
  // Who has checked in and who has not, grouped by racing group — for the
  // entrance or the gym wall before racing starts. Ahead of the standard mode
  // render for the same reason every other full-screen view here is: this is
  // a view of its own, not a tab within the usual layout.
  if (behaviour.checkin) {
    return (
      <div
        className="container projector-mode"
        data-theme={displayThemeKey}
        style={{
          maxWidth: '100%',
          padding: 0,
          background: 'var(--display-bg-color)',
          color: 'var(--display-text-color)',
          ...displayThemeStyle,
        }}
      >
        <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />
        <CheckInDisplayView
          racers={(initialData?.race?.racers ?? []).map((r: Racer) => ({
            id: r.id,
            firstName: r.firstName,
            lastName: r.lastName,
            carNumber: r.carNumber ?? null,
            carPassedInspection: !!r.carPassedInspection,
            racingGroupId: r.racingGroupId,
          }))}
          racingGroups={initialData?.race?.racingGroups ?? []}
          nameDisplay={nameDisplay}
          groupWord={group}
          showCheckedIn={behaviour.showCheckedIn}
          // Racing "beginning" is the first heat's result landing — the same
          // signal `timingStats` (`lastHeatResults`) already carries for the
          // Last Heat's Times tab, so this costs no extra query. Once true
          // the screen de-emphasizes itself rather than hiding: a latecomer
          // can still check in (#172), and nothing on a VIEWER-held screen
          // can call `assignDisplay` to switch itself away (#15).
          racingHasBegun={!!lastHeatResults}
          loading={initialResult.fetching && !initialData}
          phoneTier={density.phoneTier}
        />
      </div>
    );
  }

  // --- QR CODE (#614) ---
  // A large, scannable code that opens this race on a phone — for a gym wall
  // or an auxiliary TV during check-in or intermission. Ahead of the standard
  // mode render for the same reason every other full-screen view here is:
  // this is a view of its own, not a tab within the usual layout.
  if (behaviour.qrcode) {
    return (
      <div
        className="container projector-mode"
        data-theme={displayThemeKey}
        style={{
          maxWidth: '100%',
          padding: 0,
          background: 'var(--display-bg-color)',
          color: 'var(--display-text-color)',
          ...displayThemeStyle,
        }}
      >
        <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />
        <QRCodeDisplayView
          raceId={id}
          target={behaviour.qrTarget}
          headline={initialData?.race?.qrHeadline}
          wifiNote={initialData?.race?.qrWifiNote}
        />
      </div>
    );
  }

  // --- BROADCAST OVERLAY (#616) ---
  // A transparent graphic for an OBS Studio Browser Source — composited over
  // camera video rather than shown on its own. Ahead of the standard mode
  // render for the same reason every other full-screen view here is: this is
  // a view of its own, not a tab within the usual layout. Unlike every
  // sibling above, its root deliberately does *not* paint
  // `var(--display-bg-color)` — see `BroadcastOverlayView.tsx`'s own
  // docstring for why transparency here is the whole feature, and why the
  // rest of the Display theme's tokens (the accent color on filled badges)
  // still apply.
  if (behaviour.overlay) {
    const overlayHeatLabel = isExhibition
      ? `${vehicle} exhibition run`
      : officialCurrentHeat
        ? (runOffAnnouncement(officialCurrentHeat.runOffPlacement) ??
          `Round ${officialCurrentHeat.roundNumber}, Heat ${officialCurrentHeat.globalHeatNumber ?? officialCurrentHeat.heatNumber}`)
        : null;
    return (
      <div
        className="container projector-mode"
        data-theme={displayThemeKey}
        style={{
          maxWidth: '100%',
          padding: 0,
          // The one deliberate departure from every sibling view above:
          // no `--display-bg-color`. A camera feed composited underneath
          // this in OBS must show through everywhere this view is not
          // actively drawing a panel of its own.
          background: 'transparent',
          ...displayThemeStyle,
        }}
      >
        <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />
        <BroadcastOverlayView
          trackId={initialData?.race?.track?.id}
          heatLabel={overlayHeatLabel}
          isExhibition={isExhibition}
          lanes={currentHeatRacers}
          laneColors={laneColors}
          nameDisplay={nameDisplay}
          vehicle={vehicle}
          standings={standings}
          racersMap={racersMap}
          scoreLabel={scoreLabel}
          formatScore={formatScore}
          dnfAnnotation={dnfAnnotation}
          showStandingsTicker={behaviour.showStandingsTicker}
          finishBanner={showResultsOverlay && overlayData ? overlayData : null}
        />
      </div>
    );
  }

  // --- RACE FINISHED (#869) ---
  // Takes over the standard and projector layouts once nothing is on the
  // track and nothing is next — the two places that used to fall back to
  // "No heat scheduled" whether racing had not started or had already
  // finished, with no result announced either way. Scoped to these two
  // views only: the slideshow, check-in, QR code and broadcast-overlay
  // views above have their own reason to keep running, and none of them
  // shows the panels this replaces.
  if (finished) {
    return (
      <div className="container projector-mode" data-theme={displayThemeKey} style={{ padding: 0, ...displayThemeStyle }}>
        <RaceFinishedOverlay
          roundLabel={finishedRoundLabel}
          standings={finishedStandings}
          formatScore={finishedFormatScore}
          scoreLabel={finishedScoreLabel}
          nameDisplay={nameDisplay}
          vehicle={vehicle}
        />
      </div>
    );
  }

  // --- STANDARD MODE RENDER ---
  if (!isProjectorMode) {
    // The phone tier (#1144): rem-sized text, one column, and — deliberately,
    // the one place an audience display is allowed to (see `displays.md`) —
    // scrolling. The desktop render below budgets the whole viewport
    // (`height: 100vh`, `overflow: hidden`, `heatCardsMaxHeightVh`) so
    // nothing ever needs to scroll on a wall display; that budget has no
    // room left for a heat card plus five real standings rows at 390px wide
    // without either scrolling or shrinking under the legibility floor a
    // second time, which is exactly what the issue found (9px heat-card
    // names, 26px/8px-text standings rows). No "Launch Projector Mode"
    // button here — a phone invited by the Displays panel's own QR code has
    // no use for it, and it is the one control this tier drops rather than
    // resizes (#1144's own "hide Launch Projector Mode" requirement).
    if (density.phoneTier) {
      return (
        <div
          className="container observation-phone"
          data-theme={displayThemeKey}
          data-testid="observation-standard-phone"
          style={{
            maxWidth: '100%',
            padding: '1rem',
            boxSizing: 'border-box',
            minHeight: '100vh',
            background: 'var(--display-bg-color)',
            color: 'var(--display-text-color)',
            ...displayThemeStyle,
          }}
        >
          {renderResultsOverlay()}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {initialData?.race?.track?.id && (
              <TimerStatusBadge trackId={initialData.race.track.id} />
            )}
            <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} inline />
          </div>

          {renderHeatCard(
            "Now Racing",
            currentHeatRacers,
            false,
            mdiFire,
            isExhibition
              ? undefined
              : officialCurrentHeat
                ? (runOffAnnouncement(officialCurrentHeat.runOffPlacement) ??
                  `Round ${officialCurrentHeat.roundNumber}, Heat ${officialCurrentHeat.globalHeatNumber ?? officialCurrentHeat.heatNumber}`)
                : undefined,
            isExhibition
          )}
          {density.onDeckDepth > 0 && renderHeatCard(
            "On Deck",
            nextHeatRacers,
            true,
            mdiChevronDoubleRight,
            onDeckHeat ? `Round ${onDeckHeat.roundNumber}, Heat ${onDeckHeat.globalHeatNumber ?? onDeckHeat.heatNumber}` : undefined
          )}

          <div style={{ marginTop: '0.5rem' }}>
            <h2 style={{ margin: '0 0 0.6rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Icon path={mdiTrophy} size="1rem" />
              Standings
            </h2>
            <table className="standings-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ backgroundColor: 'var(--display-accent-color)', color: 'var(--display-on-accent-color)' }}>
                <tr>
                  <th style={{ padding: '0.4rem', fontSize: '0.8rem' }}>Rank</th>
                  <th style={{ padding: '0.4rem', fontSize: '0.8rem' }}>Racer</th>
                  <th style={{ padding: '0.4rem', textAlign: 'right', fontSize: '0.8rem' }}>{effectiveScoreLabel}</th>
                  <th style={{ padding: '0.4rem', textAlign: 'right', fontSize: '0.8rem' }}>Runs</th>
                </tr>
              </thead>
              <tbody>
                {effectiveStandings.map((s: Standing) => {
                  const racer = racersMap[s.racerId];
                  return (
                    <tr key={s.racerId} className="standing-row" style={{ borderBottom: '1px solid var(--display-border-subtle-color)' }}>
                      <td
                        className="standing-rank"
                        style={{
                          padding: '0.5rem 0.4rem',
                          fontSize: '1rem',
                          fontWeight: 'bold',
                          color: s.rank === 1 ? '#d4af37' : s.rank === 2 ? '#c0c0c0' : s.rank === 3 ? '#cd7f32' : 'var(--display-text-color)',
                        }}
                      >
                        {s.rank}
                      </td>
                      <td className="standing-racer" style={{ padding: '0.5rem 0.4rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <RacerAvatar
                            racer={{
                              id: s.racerId,
                              first_name: racer?.firstName || '',
                              last_name: racer?.lastName || '',
                              racer_image_url: shouldShowRacerPhoto(nameDisplay) ? racer?.racerImageUrl : null,
                            }}
                            size="2.4rem"
                            style={{ border: '2px solid var(--display-border-color)' }}
                          />
                          <div>
                            {/* ≥14px (#1144's own requirement) — 1rem at the
                                default root size. */}
                            <div className="standing-racer-name" style={{ fontWeight: 'bold', fontSize: '1rem' }}>
                              {racer ? formatDisplayName(nameDisplay, racer.firstName, racer.lastName) : `Racer #${s.racerId}`}
                            </div>
                            {racer?.carNumber && (
                              <div className="standing-car-number" style={{ color: 'var(--display-text-muted-color)', fontSize: '0.85rem' }}>{vehicle} #{racer.carNumber}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="standing-time" style={{ padding: '0.5rem 0.4rem', textAlign: 'right', fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontSize: '1rem', fontWeight: 'bold' }}>
                        {scoreCell(s, effectiveFormatScore)}
                        {dnfAnnotation(s.dnfCount ?? 0) && (
                          <div className="standing-dnf-note" style={{ fontSize: '0.7rem', fontWeight: 'normal', fontFamily: 'var(--font-body)', color: 'var(--display-text-muted-color)' }}>
                            {dnfAnnotation(s.dnfCount ?? 0)}
                          </div>
                        )}
                      </td>
                      <td className="standing-runs" style={{ padding: '0.5rem 0.4rem', textAlign: 'right', fontSize: '0.85rem' }}>{s.heatsCompleted}</td>
                    </tr>
                  );
                })}
                {effectiveStandings.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '1.5rem', textAlign: 'center' }}>No results yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    return (
      <div
        className="container"
        data-theme={displayThemeKey}
        style={{
          maxWidth: '100%',
          // Tightened from 20px (#1073 part 2) — one of several small, purely
          // vertical savings (this one, and the three `marginBottom`s below,
          // each shrunk) that together are what make a guaranteed five
          // Standings rows reachable at the SVGA floor; none is individually
          // large, and none costs the room its own legibility floor.
          padding: '15px',
          // This screen is the Display surface whether or not it happens to
          // be full-screen (#527) — it is exactly what a wall display
          // assigned STANDINGS, TIMING or CYCLE shows. Without an explicit
          // background/color here, elements below that set their own
          // background but not their own color (there are several) inherit
          // `body`'s App-surface text colour instead — dark-on-dark, the
          // same failure shape as the white-on-white the token fixes below
          // address, just reached by inheritance rather than a direct read.
          background: 'var(--display-bg-color)',
          color: 'var(--display-text-color)',
          // `box-sizing: border-box` here is what makes `height: 100vh`
          // below actually mean the viewport, padding included — the
          // default `content-box` would add this padding *on top of*
          // 100vh, 40px this page's own scrollable height never had before
          // `overflow: hidden` made it matter (a border-box element's own
          // rendered size is capped at the height given it; a content-box
          // one is not, and 40px of that difference is exactly what
          // `displayResolutions.spec.ts`'s view-agnostic overflow check
          // caught on `.container` itself).
          boxSizing: 'border-box',
          // A fixed-height flex column only for the Standings tab (#1073
          // part 2) — this is the "budget the viewport" layout: the chrome
          // above the table (`flexShrink: 0`, immediately below) keeps its
          // own natural size, `heat-cards-layout` additionally caps itself
          // at `displayDensity.ts`'s own ceiling, and the Standings area
          // (`flex: 1, minHeight: 0`, below) always gets whatever is left —
          // a real, CSS-guaranteed remainder rather than a JS measurement
          // of one. The Timing tab was never asked to guarantee a row
          // count the way Standings was, and its own row count is bounded
          // by the track's lane count rather than the whole roster — it
          // keeps the original `minHeight: 100vh` (the page scrolls if it
          // ever needs to, same as before this issue) rather than being
          // bound by a budget nothing has sized it against.
          ...(activeTab === 'standings'
            ? { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
            : { minHeight: '100vh' }),
          ...displayThemeStyle,
        }}
      >
        {renderResultsOverlay()}
        <div style={{ flexShrink: 0 }}>
        <div
          style={{
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {initialData?.race?.track?.id && (
              <TimerStatusBadge trackId={initialData.race.track.id} />
            )}
            {/* In the flow, beside the timer pill, rather than the fixed
                corner every other caller uses — that corner is exactly
                where Launch Projector Mode sits on this view (#954). */}
            <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} inline />
          </div>
          <button
            onClick={() => window.open(`${window.location.pathname}?projector=true`, '_blank', 'noopener')}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: '2px solid var(--display-accent-color)',
              background: 'transparent',
              color: 'var(--display-accent-color)',
              cursor: 'pointer',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Icon path={mdiVideo} size={0.8} />
            Launch Projector Mode
          </button>
        </div>

        <div
          className="heat-cards-layout"
          data-on-deck-count={onDeckHeats.length}
          style={{
            display: 'flex',
            gap: '20px',
            marginBottom: '15px',
            flexWrap: 'wrap',
            // The heat cards' own share of the viewport (#1073 part 2,
            // `displayDensity.ts`) — a ceiling the cards are sized to sit
            // comfortably under (see `renderHeatCard`'s own comment), not a
            // target reached every heat. `overflow: hidden` backs it: the
            // alternative, letting content past the ceiling paint over
            // whatever is below it, is worse than the (in practice
            // unreached) risk of clipping a pathological one.
            maxHeight: `${density.heatCardsMaxHeightVh}vh`,
            overflow: 'hidden',
          }}
        >
          {renderHeatCard(
            "Now Racing",
            currentHeatRacers,
            false,
            mdiFire,
            isExhibition
              ? undefined
              : officialCurrentHeat
                ? // A run-off heat (#550) has no round or schedule position
                  // worth announcing — `runOffAnnouncement` takes over the
                  // whole line when it has something to say.
                  (runOffAnnouncement(officialCurrentHeat.runOffPlacement) ??
                  `Round ${officialCurrentHeat.roundNumber}, Heat ${officialCurrentHeat.globalHeatNumber ?? officialCurrentHeat.heatNumber}`)
                : undefined,
            isExhibition
          )}
          {/* "On Deck" drops out below `displayDensity.ts`'s own height
              threshold (#1073 part 2) — a card sharing the row with a
              sibling is a *narrower* card, and a long name wraps to more
              lines inside a narrower column even at the identical avatar
              and font size; "Now Racing" alone, at the row's full width,
              needs fewer wrapped lines and so a shorter row, which is what
              actually buys the Standings table its guaranteed rows back at
              the SVGA floor. */}
          {density.onDeckDepth > 0 && renderHeatCard(
            "On Deck",
            nextHeatRacers,
            true,
            mdiChevronDoubleRight,
            // Free now that the subscription carries the heat rather than a
            // bare racer list: the panel exists so cars can be staged, and
            // which heat they are staging for is part of that.
            onDeckHeat ? `Round ${onDeckHeat.roundNumber}, Heat ${onDeckHeat.globalHeatNumber ?? onDeckHeat.heatNumber}` : undefined
          )}
          {/* "After That" rather than the derby term "in the hole", which is
              vocabulary a first-time announcer reading this screen aloud does
              not have. It is only rendered when there *is* one, so the last
              two heats of a race do not leave an empty card on the wall — and
              (#1073 part 2) only when the row still has room for three cards
              side by side: below `displayDensity.ts`'s threshold, three
              300px-floor cards wrap onto their own lines and, at the SVGA
              floor with a six-lane heat, ran taller than the viewport itself
              before the Standings table below them had drawn a single row. */}
          {density.onDeckDepth > 1 && afterThatHeat && renderHeatCard(
            "After That",
            afterThatRacers,
            true,
            mdiChevronDoubleRight,
            `Round ${afterThatHeat.roundNumber}, Heat ${afterThatHeat.globalHeatNumber ?? afterThatHeat.heatNumber}`
          )}
        </div>

        <div style={{ marginBottom: '12px', display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setActiveTab('standings')}
            aria-pressed={activeTab === 'standings'}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: 'none',
              background: activeTab === 'standings' ? 'var(--display-accent-color)' : 'var(--display-border-subtle-color)',
              color: activeTab === 'standings' ? 'var(--display-on-accent-color)' : 'var(--display-text-color)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold'
            }}
          >
            <Icon path={mdiTrophy} size={0.8} />
            Standings
          </button>
          <button
            onClick={() => setActiveTab('timing')}
            aria-pressed={activeTab === 'timing'}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: 'none',
              background: activeTab === 'timing' ? 'var(--display-accent-color)' : 'var(--display-border-subtle-color)',
              color: activeTab === 'timing' ? 'var(--display-on-accent-color)' : 'var(--display-text-color)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold'
            }}
          >
            <Icon path={mdiTimerOutline} size={0.8} />
            Timing Stats
          </button>
        </div>
        </div>

        {/* The remainder of the viewport's own budget (#1073 part 2) — a
            flex column of its own so the page indicator below can claim its
            small, fixed share (`flexShrink: 0`) before the actual content
            wrapper takes `flex: 1` of what is left, rather than the
            indicator's height being subtracted from a JS-measured guess. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'standings' ? (
          <div
            ref={standingsWrapperRef}
            className="standings-table-wrapper"
            style={{
              background: 'var(--display-surface-color)',
              borderRadius: '8px',
              // `flex: 1` inside the fixed-height column above (#1073 part
              // 2) is what gives this a real, CSS-guaranteed remainder —
              // `minHeight: 0` is what lets a flex item shrink *below* its
              // own content's height at all (a flex item's default
              // `min-height: auto` is its content's own size, which would
              // otherwise let this grow past the space actually left and
              // push the page into needing to scroll, exactly the bug this
              // issue exists to fix). `overflow: hidden` is unconditional
              // now — the viewport budget in `displayDensity.ts` (the heat
              // cards' own ceiling, and the on-deck depth that keeps them
              // under it) is what guarantees there is always a real,
              // positive remainder to clip to, so this never has to fall
              // back to `visible` and hide the table entirely.
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            }}
          >
            <table
              ref={standingsTableRef}
              className="standings-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                transform:
                  behaviour.scrollBehavior === 'SMOOTH' ? `translateY(-${standingsPages.offset}px)` : undefined,
                // Matches `StandingsOnlyView`'s own transition length — short
                // enough that discrete jumps every 50ms read as continuous
                // motion rather than a stutter.
                transition: behaviour.scrollBehavior === 'SMOOTH' ? 'transform 60ms linear' : undefined,
              }}
            >
              <thead ref={standingsHeadRef} style={{ backgroundColor: 'var(--display-accent-color)', color: 'var(--display-on-accent-color)' }}>
                <tr>
                  <th style={{ padding: '4px', fontSize: '2vmin' }}>Rank</th>
                  <th style={{ padding: '4px', fontSize: '2vmin' }}>Racer</th>
                  <th style={{ padding: '4px', textAlign: 'right', fontSize: '2vmin' }}>{effectiveScoreLabel}</th>
                  <th style={{ padding: '4px', textAlign: 'right', fontSize: '2vmin' }}>Runs</th>
                </tr>
              </thead>
              <tbody>
                {standingsPages.visible.map((s: Standing, idx: number) => {
                  const racer = racersMap[s.racerId];
                  return (
                    <tr
                      key={s.racerId}
                      ref={idx === 0 ? standingsRowRef : undefined}
                      className="standing-row"
                      style={{ borderBottom: '1px solid var(--display-border-subtle-color)' }}
                    >
                      {/* `vmin`, not `rem` (#1073) — see `renderHeatCard`'s
                          own comment; every size in this table used to be a
                          fixed `rem`, which reads fine at the one viewport it
                          was tuned at and falls under the legibility floor on
                          any taller one. Padding and avatar size are smaller
                          than they were (#1073 part 2) — a row this compact,
                          not a fixed `rem`, is what a guaranteed five rows at
                          the SVGA floor actually needs; both still clear the
                          legibility floor with margin (see `renderHeatCard`'s
                          own comment on the same tradeoff). */}
                      <td className="standing-rank" style={{ padding: '3px', fontSize: '2.4vmin', fontWeight: 'bold', color: s.rank === 1 ? '#d4af37' : s.rank === 2 ? '#c0c0c0' : s.rank === 3 ? '#cd7f32' : 'var(--display-text-color)' }}>
                        {s.rank}
                      </td>
                      <td className="standing-racer" style={{ padding: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <RacerAvatar
                            racer={{
                              id: s.racerId,
                              first_name: racer?.firstName || '',
                              last_name: racer?.lastName || '',
                              racer_image_url: shouldShowRacerPhoto(nameDisplay) ? racer?.racerImageUrl : null
                            }}
                            size="3.4vmin"
                            style={{ border: '2px solid var(--display-border-color)', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}
                          />
                          <div>
                            <div className="standing-racer-name" style={{ fontWeight: 'bold', fontSize: '2.2vmin' }}>
                              {racer ? formatDisplayName(nameDisplay, racer.firstName, racer.lastName) : `Racer #${s.racerId}`}
                            </div>
                            {racer?.carNumber && (
                              <div className="standing-car-number" style={{ color: 'var(--display-text-muted-color)', fontSize: '2vmin' }}>{vehicle} #{racer.carNumber}</div>
                            )}
                            {/* Dropped below the legibility threshold
                                (#1073 part 2, `displayDensity.ts`) — the
                                rank, racer, score and runs columns this tab
                                is deliberately narrow to (see
                                `docs/observation-displays.md`) stay; this
                                second line does not. */}
                            {density.showSecondaryText && s.racingGroupDivision && (
                              <div className="standing-racing-group-division" style={{ color: 'var(--display-text-subtle-color)', fontSize: '2vmin' }}>{s.racingGroupDivision}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="standing-time" style={{ padding: '3px', textAlign: 'right', fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontSize: '2.4vmin', fontWeight: 'bold' }}>
                        {scoreCell(s, effectiveFormatScore)}
                        {dnfAnnotation(s.dnfCount ?? 0) && (
                          <div className="standing-dnf-note" style={{ fontSize: '1.6vmin', fontWeight: 'normal', fontFamily: 'var(--font-body)', color: 'var(--display-text-muted-color)' }}>
                            {dnfAnnotation(s.dnfCount ?? 0)}
                          </div>
                        )}
                      </td>
                      <td className="standing-runs" style={{ padding: '3px', textAlign: 'right', fontSize: '2vmin' }}>{s.heatsCompleted}</td>
                    </tr>
                  );
                })}
                {effectiveStandings.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '30px', textAlign: 'center' }}>No results yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        {/* The tab's own page indicator — same shape as
            `StandingsOnlyView`'s `standings-only-page-indicator`, a
            different name because it is a different element on a different
            view, not because the rule differs (#1073 part 2). A sibling of
            the bounded, `overflow: hidden` wrapper above inside their shared
            flex column, `flexShrink: 0` — its own small height is what the
            wrapper's `flex: 1` yields to, rather than a row the wrapper
            could ever clip. */}
        {activeTab === 'standings' && behaviour.scrollBehavior === 'PAGING' && standingsPages.pageCount > 1 && (
          <div
            data-testid="standings-tab-page-indicator"
            style={{
              flexShrink: 0,
              textAlign: 'center',
              marginTop: '10px',
              color: 'var(--display-text-faint-color)',
              fontSize: '1.8vmin',
            }}
          >
            Page {standingsPages.page + 1} of {standingsPages.pageCount}
          </div>
        )}
        {activeTab === 'timing' && (
          <div
            className="timing-list-wrapper"
            style={{
              background: 'var(--display-surface-color)',
              borderRadius: '8px',
              padding: '30px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              // Not bounded like the Standings tab's own wrapper (#1073
              // part 2) — this tab shows one lane per column, bounded by
              // the track's own lane count rather than the whole roster, so
              // it has never needed to page. `overflow: auto` was tried and
              // reverted: `displayResolutions.spec.ts`'s own view-agnostic
              // overflow check treats *any* scrollable region as a clipping
              // bug unless named on its exemption list, and a real scrollbar
              // here would be new, untested behaviour for what is, in
              // practice, always a handful of rows. `flexShrink: 0` keeps
              // this at its natural height inside the fixed-height column
              // above; nothing below it in that column can be pushed off
              // by a tall one, since it is the last thing in it.
              flexShrink: 0,
            }}
          >
            {lastHeatResults ? (
              <div>
                <h2 className="timing-header" style={{ textAlign: 'center', marginBottom: '30px', fontSize: '3.2vmin', color: 'var(--display-text-color)' }}>
                  Last Completed: {lastHeatResults.roundName} / Heat {lastHeatResults.globalHeatNumber ?? lastHeatResults.heatNumber}
                </h2>
                {lastHeatResults.recordBreak && (
                  <div
                    className="timing-record-banner"
                    data-testid="timing-record-banner"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      marginBottom: '25px',
                      padding: '15px 20px',
                      borderRadius: '12px',
                      background: 'var(--display-accent-color, #FCD116)',
                      // No "text on Display accent" role exists in the token
                      // vocabulary (#498); --display-bg-color is dark enough
                      // against every theme's own accent to clear 4.5:1 —
                      // see themes.test.ts's "display-bg-color reads as text
                      // on the display accent fill" check.
                      color: 'var(--display-bg-color, #0A0A0A)',
                      fontWeight: 'bold',
                      // `vmin`, not `rem` (#1073) — see `renderHeatCard`'s
                      // own comment.
                      fontSize: '2.4vmin',
                      textAlign: 'center',
                    }}
                  >
                    <Icon path={mdiTrophy} size="2.6vmin" color="var(--display-bg-color, #0A0A0A)" />
                    <span>
                      New track record! {recordBreakDetail(lastHeatResults.recordBreak)}
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {[...lastHeatResults.lanes]
                    .sort((a, b) => (a.place || 99) - (b.place || 99))
                    .map((lane) => (
                    <div
                      key={lane.laneNumber}
                      className="timing-list-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '20px',
                        background: lane.place === 1 ? 'var(--display-highlight-gold-tint-color)' : 'var(--display-card-bg-color)',
                        borderRadius: '12px',
                        borderLeft: `10px solid ${lane.place === 1 ? '#d4af37' : 'var(--display-border-color)'}`
                      }}
                    >
                      <div className="timing-rank" style={{ fontSize: '4vmin', fontWeight: 'bold', width: '10vmin', textAlign: 'center' }}>
                        {lane.place}
                      </div>
                      <div className="timing-racer-info" style={{ flex: 1 }}>
                        <div className="timing-racer-name" style={{ fontSize: '3vmin', fontWeight: 'bold' }}>{lane.racerName}</div>
                        {/* Dropped below the legibility threshold (#1073
                            part 2, `displayDensity.ts`) — the issue's own
                            framing of this view calls the car's name a
                            secondary column next to place, name and time.
                            The lane-number fallback rides on the same line
                            and goes with it; place and name are already on
                            screen without it. */}
                        {density.showSecondaryText && (
                          <div className="timing-car-name" style={{ fontSize: '2vmin', color: 'var(--display-text-muted-color)' }}>{lane.carName || `Lane ${lane.laneNumber}`}</div>
                        )}
                      </div>
                      <div className="timing-time" style={{ fontSize: '4.5vmin', fontWeight: 'bold', fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatLaneTime(lane.time)}
                        {formatScaleMph(lane.scaleMph) && (
                          <span
                            className="timing-scale-mph"
                            style={{ fontSize: '2vmin', fontWeight: 'normal', color: 'var(--display-text-muted-color)' }}
                          >
                            {' '}
                            · {formatScaleMph(lane.scaleMph)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '50px', color: 'var(--display-text-muted-color)' }}>
                <Icon path={mdiTimerOutline} size="6vmin" color="var(--display-border-subtle-color)" />
                <h3 style={{ fontSize: '2.4vmin', color: 'var(--display-text-muted-color)' }}>Waiting for the first heat to complete...</h3>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    );
  }

  // --- PROJECTOR MODE RENDER ---
  const renderProjectorRacers = (entries: LaneEntry[], isNowRacing: boolean) => {
    if (entries.length === 0) {
      return (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--display-placeholder-color)', fontSize: '3vmin' }}>
          No heat scheduled
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', height: '100%', minHeight: 0, gap: '2vmin' }}>
        {entries.map(({ lane, racer }: LaneEntry) => (
          <div key={lane} className="projector-racer-card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--display-card-bg-color)', borderRadius: '1.5vmin', padding: isNowRacing ? '1.6vmin' : '0.8vmin', textAlign: 'center', overflow: 'hidden' }}>
            {/* Priority 1: Racer Name.
                On Deck's own coefficients are deliberately smaller than Now
                Racing's, not just for visual hierarchy — six lanes'
                worth of these cards, side by side, is the busiest case
                `.projector-heat-panel`'s own `flex: 2` share of an 800×600
                screen has to hold without growing past it (#1073). */}
            <div className="projector-racer-name" style={{ fontWeight: 'bold', fontSize: isNowRacing ? '4.5vh' : '2.8vh', color: 'var(--display-text-color)', marginBottom: isNowRacing ? (density.projectorStacked ? '1vmin' : '1.5vmin') : '0.5vmin', lineHeight: 1.1 }}>
              {formatDisplayName(nameDisplay, racer.firstName, racer.lastName)}
            </div>

            {/* Priority 2: Picture */}
            <RacerAvatar
              racer={{
                id: racer.id,
                first_name: racer.firstName,
                last_name: racer.lastName,
                racer_image_url: shouldShowRacerPhoto(nameDisplay) ? racer.racerImageUrl : null
              }}
              size={isNowRacing ? "14.5vmin" : "8vmin"}
              style={{ margin: '0 auto', border: '0.4vmin solid var(--display-text-color)', boxShadow: '0 0.5vmin 1vmin rgba(0,0,0,0.3)', flexShrink: 0 }}
            />

            {/* Priority 3: Lane Number (Only prominent for Now Racing, very small or omitted for On Deck) */}
            <div className="projector-racer-lane-car" style={{ marginTop: isNowRacing ? '1.5vmin' : '0.8vmin', display: 'flex', flexDirection: 'column', gap: '0.5vmin' }}>
              <LaneBadge
                color={colorForLane(laneColors, lane)}
                // `lineHeight` pinned rather than left to the browser
                // default (#1073): at these small sizes the default line
                // box is a couple of pixels taller than the flex layout
                // reserves for it, which read as this badge silently
                // clipping its own text at 800×600 with a busy (six-lane)
                // heat, even though nothing was visibly cut off.
                style={{ justifyContent: 'center', lineHeight: 1.3, color: isNowRacing ? 'var(--display-text-dim-color)' : 'var(--display-placeholder-color)', fontSize: isNowRacing ? '2.5vh' : '1.6vh', fontWeight: isNowRacing ? 'bold' : 'normal' }}
              >
                Lane {lane}
              </LaneBadge>
              {racer.carNumber && (
                // Never below 2% of viewport height (#1073's own legibility
                // floor) — `vh` rather than `vmin`, since #1143's stacked
                // projector layout (a portrait tablet) is the first caller
                // where the two units diverge: `vmin` follows whichever
                // dimension is smaller, which is width in portrait, and a
                // car number sized off width alone read far below this
                // floor there even though the identical number sized off
                // `vh` reads exactly the same in every landscape viewport
                // this file already tests (`vmin` and `vh` are the same
                // value whenever width ≥ height, which is every one of
                // them) — a car number is one of the things this floor
                // exists to protect, even in On Deck's smaller secondary
                // card.
                <div style={{ color: 'var(--display-text-quiet-color)', fontSize: isNowRacing ? '2.2vh' : '2vh' }}>
                  {vehicle} #{racer.carNumber}
                </div>
              )}
              {racingGroupDivisionFor(racer) && (
                <div style={{ color: 'var(--display-text-quiet-color)', fontSize: isNowRacing ? '2vh' : '1.4vh' }}>
                  {racingGroupDivisionFor(racer)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // One Current Standings row, shared by the ordinary two-column layout's
  // own right column and the stacked layout's own standings panel (#1143)
  // — extracted rather than duplicated so the two can never drift apart on
  // what a row actually shows.
  // Font sizes below are `vh`, not `vmin` — see the matching comment on the
  // heat cards' own car-number div (#1143): `vh` and `vmin` are identical in
  // every landscape viewport this file tests (width ≥ height), so this is a
  // no-op there, and it is what keeps a rank/name/score legible once the
  // stacked layout puts this same row on a portrait screen, where `vmin`
  // alone would follow the (now much smaller) width instead of the height
  // the legibility floor is actually measured against.
  const renderProjectorStandingsRow = (s: Standing, idx: number, total: number) => {
    const racer = racersMap[s.racerId];
    return (
      <tr className="projector-standing-row" key={s.racerId} style={{ borderBottom: idx < total - 1 ? '1px solid var(--display-border-color)' : 'none' }}>
        <td className="projector-standings-rank-col" style={{ padding: '1.5vmin 0', width: '15%' }}>
          <span style={{ fontSize: '4vh', fontWeight: 'bold', color: s.rank === 1 ? '#d4af37' : s.rank === 2 ? '#c0c0c0' : s.rank === 3 ? '#cd7f32' : 'var(--display-text-faintest-color)' }}>
            {s.rank}
          </span>
        </td>
        <td className="projector-standings-racer-col" style={{ padding: '1.5vmin', width: '55%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vmin', minWidth: 0 }}>
            <RacerAvatar
              racer={{
                id: s.racerId,
                first_name: racer?.firstName || '',
                last_name: racer?.lastName || '',
                racer_image_url: shouldShowRacerPhoto(nameDisplay) ? racer?.racerImageUrl : null
              }}
              size="6vmin"
              style={{ border: '0.2vmin solid var(--display-border-subtle-color)', flexShrink: 0 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              {nameDisplay === 'FULL' ? (
                <>
                  <span style={{ fontSize: '2.5vh', fontWeight: 'bold', color: 'var(--display-text-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                    {racer ? `${racer.firstName}` : `Racer`}
                  </span>
                  <span style={{ fontSize: '2vh', fontWeight: 'bold', color: 'var(--display-text-subtle-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                    {racer ? `${racer.lastName}` : `#${s.racerId}`}
                  </span>
                </>
              ) : (
                // Abbreviated: one line, via the one formatter, rather than
                // splitting first/last across two lines the way FULL does —
                // a bare last initial reads oddly stacked under a first name.
                <span style={{ fontSize: '2.5vh', fontWeight: 'bold', color: 'var(--display-text-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                  {racer ? formatDisplayName(nameDisplay, racer.firstName, racer.lastName) : `Racer #${s.racerId}`}
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="projector-standings-time-col" style={{ padding: '1.5vmin 0', width: '30%', textAlign: 'right' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
            <span style={{ fontSize: '3.5vh', fontWeight: 'bold', fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', color: 'var(--display-accent-color)', lineHeight: '1' }}>
              {scoreCell(s, effectiveFormatProjectorScore)}
            </span>
            <span style={{ fontSize: '1.5vmin', color: 'var(--display-text-faintest-color)', textTransform: 'uppercase', letterSpacing: '0.1vmin', marginTop: '0.5vmin' }}>
              {effectiveScoreLabel}
            </span>
            {dnfAnnotation(s.dnfCount ?? 0) && (
              <span style={{ fontSize: '1.5vmin', color: 'var(--display-text-faintest-color)', marginTop: '0.3vmin' }}>
                {dnfAnnotation(s.dnfCount ?? 0)}
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // The ordinary two-column layout always shows exactly a Top 5 podium —
  // unchanged by #1143. The stacked layout (a portrait tablet, generally
  // taller than the fixed two-column layout's own 96vmin) shows however
  // many rows the measured remainder actually fits, with no further cap:
  // "Current Standings", unlike a "Top 5" panel, has no reason to leave
  // room on the table unused once a portrait screen's own height has more
  // to give.
  const top5Standings = density.projectorStacked
    ? effectiveStandings.slice(0, projectorStandingsPages.pageSize)
    : effectiveStandings.slice(0, 5);
  const nowRacingHeatInfo = officialCurrentHeat
    ? (runOffAnnouncement(officialCurrentHeat.runOffPlacement) ??
      `Round ${officialCurrentHeat.roundNumber}, Heat ${officialCurrentHeat.globalHeatNumber ?? officialCurrentHeat.heatNumber}`)
    : undefined;

  return (
    <div
      className="container projector-mode"
      data-theme={displayThemeKey}
      style={{ maxWidth: '100%', padding: '2vmin', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', ...displayThemeStyle }}
    >
      {renderResultsOverlay()}
      <IdentifyPresence name={identify.name} showConnectBadge={identify.showConnectBadge} showFlash={identify.showFlash} />

      {density.projectorStacked ? (
        // Stacked layout (#1143): a portrait tablet, or a screen turned on
        // its side, where the ordinary two-column split below pushes
        // Current Standings partially or entirely off-screen (measured
        // directly at 820×1180 and 768×1024 in `displayResolutions.spec.ts`
        // — `displayDensity.ts`'s own `projectorStacked` doc comment has
        // the exact numbers). Heat cards on top, capped to a fixed `vh`
        // ceiling; Current Standings underneath gets the CSS-guaranteed
        // remainder, exactly the "budget, not a target" shape the standard
        // mode's own Standings tab already uses for the identical reason.
        <div className="projector-stacked" style={{ display: 'flex', flexDirection: 'column', flex: '1', gap: '2vmin', minHeight: 0 }}>
          <div
            className="projector-stacked-heat-cards"
            style={{
              display: 'flex',
              flexDirection: density.projectorHeatCardsSideBySide ? 'row' : 'column',
              gap: '2vmin',
              maxHeight: `${density.projectorHeatCardsMaxHeightVh}vh`,
              flexShrink: 0,
              minHeight: 0,
            }}
          >
            <div className="projector-heat-panel" style={{ flex: '1', display: 'flex', flexDirection: 'column', background: 'var(--display-surface-alt-color)', borderRadius: '1.5vmin', padding: '2vmin', borderTop: '1vmin solid var(--error)', boxSizing: 'border-box', minHeight: 0, minWidth: 0 }}>
              <h2 style={{ fontSize: '3vmin', margin: 0, paddingBottom: '1.2vmin', display: 'flex', alignItems: 'center', gap: '1.2vmin', borderBottom: '2px solid var(--display-border-color)', marginBottom: '1.5vmin', flexWrap: 'wrap' }}>
                <Icon path={mdiFire} size="3vmin" color="var(--error)" />
                Now Racing
                {nowRacingHeatInfo && <span style={{ color: 'var(--display-text-faintest-color)', fontSize: '2vmin', marginLeft: 'auto', fontWeight: 'normal' }}>({nowRacingHeatInfo})</span>}
                {isExhibition && <span style={{ background: 'var(--display-accent-color)', color: 'var(--display-on-accent-color)', fontSize: '1.6vmin', padding: '0.4vmin 1.2vmin', borderRadius: '2vmin', marginLeft: 'auto' }}>EXHIBITION</span>}
                {initialData?.race?.track?.id && (
                  <TimerStatusBadge trackId={initialData.race.track.id} />
                )}
              </h2>
              <div style={{ flex: 1, minHeight: 0 }}>
                {renderProjectorRacers(currentHeatRacers, true)}
              </div>
            </div>

            <div className="projector-heat-panel" style={{ flex: '1', display: 'flex', flexDirection: 'column', background: 'var(--display-surface-alt-color)', borderRadius: '1.5vmin', padding: '2vmin', borderTop: '1vmin solid var(--display-accent-muted-color)', opacity: nextHeatRacers.length === 0 ? 0.7 : 1, boxSizing: 'border-box', minHeight: 0, minWidth: 0 }}>
              <h2 style={{ fontSize: '2.6vmin', margin: 0, paddingBottom: '1.2vmin', display: 'flex', alignItems: 'center', gap: '1.2vmin', borderBottom: '2px solid var(--display-border-color)', marginBottom: '1.5vmin', color: 'var(--display-text-muted-color)' }}>
                <Icon path={mdiChevronDoubleRight} size="2.6vmin" color="var(--display-text-muted-color)" />
                On Deck
              </h2>
              <div style={{ flex: 1, minHeight: 0 }}>
                {renderProjectorRacers(nextHeatRacers, false)}
              </div>
            </div>
          </div>

          <div
            className="projector-right-col projector-stacked-standings"
            style={{ flex: '1', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--display-surface-alt-color)', borderRadius: '1.5vmin', overflow: 'hidden', padding: '2.5vmin', borderTop: '1vmin solid var(--display-accent-color)', boxSizing: 'border-box' }}
          >
            <h2 style={{ fontSize: '3vmin', margin: 0, paddingBottom: '1.2vmin', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.2vmin', borderBottom: '2px solid var(--display-border-color)', marginBottom: '1.5vmin', flexShrink: 0 }}>
              <Icon path={mdiTrophy} size="3vmin" color="var(--display-accent-color)" />
              Current Standings
            </h2>
            {/* The measured remainder (#1143) — see the `useMeasuredPages`
                call above this component's projector-mode return for why
                `top5Standings` is already capped to `pageSize` here rather
                than a fixed 5. */}
            <div ref={projectorStandingsWrapperRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {top5Standings.length > 0 ? (
                <table ref={projectorStandingsTableRef} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <tbody>
                    {top5Standings.map((s: Standing, idx: number) =>
                      renderProjectorStandingsRow(s, idx, top5Standings.length),
                    )}
                  </tbody>
                </table>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--display-placeholder-color)', fontSize: '3vmin' }}>
                  No results yet.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
      <div className="projector-grid" style={{ display: 'flex', flex: '1', gap: '3vmin', height: '100%', minHeight: 0 }}>
        {/* Left Column: Active and Upcoming Heats.
            `minHeight: 0` down this whole chain (#1073) — a flex item's
            automatic minimum size defaults to its *content's* size, so
            without it a busy heat (six lanes, long names) refuses to shrink
            to its allotted share and inflates every flex ancestor above it,
            including the full-screen root that is supposed to hold this to
            exactly the viewport's height. That is what let the page need to
            scroll at 800×600 even though `.projector-mode` is `height:
            100vh; overflow: hidden`: the overflow was real, just invisible
            until the root itself was measured. */}
        <div className="projector-left-col" style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', gap: '2vmin', boxSizing: 'border-box', minHeight: 0, minWidth: 0 }}>

          {/* Now Racing */}
          <div className="projector-heat-panel" style={{ flex: '3', display: 'flex', flexDirection: 'column', background: 'var(--display-surface-alt-color)', borderRadius: '1.5vmin', padding: '2vmin', borderTop: '1vmin solid var(--error)', boxSizing: 'border-box', minHeight: 0 }}>
            <h2 style={{ fontSize: '4vmin', margin: 0, paddingBottom: '1.5vmin', display: 'flex', alignItems: 'center', gap: '1.5vmin', borderBottom: '2px solid var(--display-border-color)', marginBottom: '2vmin' }}>
              <Icon path={mdiFire} size="4vmin" color="var(--error)" />
              Now Racing
              {nowRacingHeatInfo && <span style={{ color: 'var(--display-text-faintest-color)', fontSize: '2.5vmin', marginLeft: 'auto', fontWeight: 'normal' }}>({nowRacingHeatInfo})</span>}
              {isExhibition && <span style={{ background: 'var(--display-accent-color)', color: 'var(--display-on-accent-color)', fontSize: '2vmin', padding: '0.5vmin 1.5vmin', borderRadius: '2vmin', marginLeft: 'auto' }}>EXHIBITION</span>}
              {initialData?.race?.track?.id && (
                <TimerStatusBadge trackId={initialData.race.track.id} />
              )}
            </h2>
            <div style={{ flex: 1, minHeight: 0 }}>
              {renderProjectorRacers(currentHeatRacers, true)}
            </div>
          </div>

          {/* On Deck */}
          <div className="projector-heat-panel" style={{ flex: '2', display: 'flex', flexDirection: 'column', background: 'var(--display-surface-alt-color)', borderRadius: '1.5vmin', padding: '2vmin', borderTop: '1vmin solid var(--display-accent-muted-color)', opacity: nextHeatRacers.length === 0 ? 0.7 : 1, boxSizing: 'border-box', minHeight: 0 }}>
            <h2 style={{ fontSize: '3.5vmin', margin: 0, paddingBottom: '1.5vmin', display: 'flex', alignItems: 'center', gap: '1.5vmin', borderBottom: '2px solid var(--display-border-color)', marginBottom: '2vmin', color: 'var(--display-text-muted-color)' }}>
              <Icon path={mdiChevronDoubleRight} size="3.5vmin" color="var(--display-text-muted-color)" />
              On Deck
            </h2>
            <div style={{ flex: 1, minHeight: 0 }}>
              {renderProjectorRacers(nextHeatRacers, false)}
            </div>
          </div>
        </div>

        {/* Right Column: Top 5 Standings */}
        <div className="projector-right-col" style={{ flex: '0 0 calc(35% - 3vmin)', display: 'flex', flexDirection: 'column', background: 'var(--display-surface-alt-color)', borderRadius: '1.5vmin', overflow: 'hidden', padding: '2.5vmin', borderTop: '1vmin solid var(--display-accent-color)', boxSizing: 'border-box' }}>
          <h2 style={{ fontSize: '3.5vmin', margin: 0, paddingBottom: '1.5vmin', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5vmin', borderBottom: '2px solid var(--display-border-color)', marginBottom: '2vmin' }}>
            <Icon path={mdiTrophy} size="3.5vmin" color="var(--display-accent-color)" />
            Current Standings
          </h2>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {top5Standings.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', height: '100%', tableLayout: 'fixed' }}>
                <tbody>
                  {top5Standings.map((s: Standing, idx: number) =>
                    renderProjectorStandingsRow(s, idx, top5Standings.length),
                  )}
                </tbody>
              </table>
            ) : (
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--display-placeholder-color)', fontSize: '3vmin' }}>
                No results yet.
              </div>
            )}

            {/* Empty rows filler if less than 5 to keep height consistent —
                the Top 5 podium's own padding, not applicable to the
                stacked layout's already-exact-fit row count (#1143). */}
            {!density.projectorStacked && top5Standings.length > 0 && top5Standings.length < 5 && Array.from({ length: 5 - top5Standings.length }).map((_, i) => (
               <div key={`empty-${i}`} style={{ flex: 1, borderTop: '1px dashed var(--display-border-color)', minHeight: '8vmin' }}></div>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
