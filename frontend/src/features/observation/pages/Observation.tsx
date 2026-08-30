import { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSubscription, useQuery } from 'urql';
import { Icon } from '@mdi/react';
import RacerAvatar from '../../management/components/RacerAvatar';
import { mdiFire, mdiChevronDoubleRight, mdiTrophy, mdiTimerOutline, mdiVideo } from '@mdi/js';
import { TimerStatusBadge } from '../../racing/components/TimerStatusBadge';
import PhotoSlideshow from '../components/PhotoSlideshow';
import { displayId } from '../displayIdentity';
import { useChrome } from '../../../context/ChromeContext';
import { useTerminology } from '../../../context/TerminologyContext';
import { formatDisplayName, shouldShowRacerPhoto } from '../../core/displayName';
import { readUrl, resolveView } from '../displayView';
import { recordBreakDetail, type RecordBreak } from '../recordBreak';
import { observeHeatResult, type SeenHeatResult } from '../resultsOverlay';
import IdentifyPresence from '../IdentifyPresence';
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
      track {
        id
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
      }
      racingGroups {
        id
        name
        color
        division
      }
    }
    initialConfig {
      displayTheme
    }
  }
`;

interface Standing {
  racerId: number;
  racingGroupDivision?: string | null;
  score: number;
  heatsCompleted: number;
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
  const { vehicle } = useTerminology();

  // This screen's identity, and what it has been told to show (#174). The
  // subscription is also how the display registers itself: it holds no PIN and
  // is a VIEWER, so it can make no mutation — it is told, it does not ask.
  const thisDisplayId = useMemo(() => displayId(), []);
  const [assignmentResult] = useSubscription({
    query: DisplayAssignmentSubscription,
    variables: { displayId: thisDisplayId, raceId: id },
    pause: !id,
  });
  const assignment = assignmentResult.data?.displayAssignment ?? null;

  const urlIntent = useMemo(() => readUrl(searchParams), [searchParams]);
  const behaviour = useMemo(
    () =>
      resolveView(
        // `assigned` rather than merely having a payload: every connected
        // display receives one, carrying the default view, and treating that
        // as an instruction overrides the URL on every screen the moment it
        // connects — which is the fallback this feature depends on.
        assignment?.assigned
          ? { view: assignment.view, cycleSeconds: assignment.cycleSeconds }
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

  // The ceremony is its own route rather than a tab here, so an assignment to
  // it is a navigation.
  useEffect(() => {
    if (behaviour.redirectTo) navigate(behaviour.redirectTo, { replace: true });
  }, [behaviour.redirectTo, navigate]);

  // Ensure body scroll is hidden in the full-screen views. The slideshow is
  // one of them (#175) — it fills the viewport, and a scrollbar down the side
  // of a photo on a projector is exactly the sort of thing nobody notices
  // until the room is full.
  const isFullScreenView = isProjectorMode || behaviour.slideshow;

  // Tell the app's furniture to get out of the way. `Navigation` cannot work
  // this out for itself any more: an assigned view changes no URL, so before
  // this an operator switching a screen to Projector from across the room got
  // the navigation bar painted across the top of it (#175).
  const { setHidden: setChromeHidden } = useChrome();
  useEffect(() => {
    setChromeHidden(isFullScreenView);
    return () => setChromeHidden(false);
  }, [isFullScreenView, setChromeHidden]);

  useEffect(() => {
    if (isFullScreenView) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isFullScreenView]);

  // Initial query for static-ish data (racers)
  const [initialResult] = useQuery({
    query: GET_INITIAL_DATA,
    variables: { id },
    pause: !id || isNaN(id),
  });

  const { data: initialData } = initialResult;

  // The Display surface's theme (#498) — this whole page, projector mode or
  // not, is the audience-facing surface the spec means by "Display". Every
  // screen resolves the default option (stored as 'MATCH_APP', shown as
  // "Field Uniform (default)") the same way regardless of what any one
  // device's own App theme happens to be — see `resolveSurfaceKey`'s own
  // comment for why that is the only resolution that can be the same on
  // every wall display in the room (#528).
  const displayThemeSetting: SurfaceThemeSetting =
    (initialData?.initialConfig?.displayTheme as SurfaceThemeSetting | undefined) ?? 'MATCH_APP';
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
  if (isProjectorMode && timingStatsData?.timingStats) {
    const observation = observeHeatResult(seenHeatResult, timingStatsData.timingStats);
    if (observation.seen !== seenHeatResult) {
      setSeenHeatResult(observation.seen);
      if (observation.isNew) {
        setOverlayData(timingStatsData.timingStats);
        setShowResultsOverlay(true);
      }
    }
  }

  // Effect to handle overlay timeout
  useEffect(() => {
    if (showResultsOverlay) {
      const timer = setTimeout(() => {
        setShowResultsOverlay(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showResultsOverlay, seenHeatResult]);

  interface Racer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number;
    racerImageUrl?: string;
    carName?: string;
    racingGroupId?: number | null;
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

  // Mirrors Leaderboard.tsx's scoreLabel/formatScore: a POINTS race sums
  // placements, not seconds, so the wall must say what it means and never
  // print a POINTS total as though it were a time (#329).
  const scoringStrategy = initialData?.race?.scoringStrategy || 'TIMED';
  // How much of a racer's name this audience-facing page may show (#552) —
  // resolved server-side, never null once the race has answered; `'FULL'`
  // is exactly what every install showed before this setting existed, so
  // there is nothing to do while the query is still in flight.
  const nameDisplay = initialData?.race?.resolvedNameDisplay ?? 'FULL';
  const scoreLabel = scoringStrategy === 'TIMED' ? 'Avg Time' : 'Points';
  const formatScore = (score: number) =>
    scoringStrategy === 'TIMED' ? `${score.toFixed(4)}s` : score.toString();
  const formatProjectorScore = (score: number) =>
    scoringStrategy === 'TIMED' ? score.toFixed(3) : score.toString();

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

  const renderHeatCard = (title: string, entries: LaneEntry[], isNext: boolean = false, iconPath?: string, heatInfo?: string, exhibition?: boolean) => {
    const isEmpty = entries.length === 0;

    return (
      <div className="heat-card" style={{
        flex: 1,
        minWidth: '300px',
        background: isEmpty ? 'var(--display-bg-color)' : 'var(--display-surface-color)',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: isEmpty ? 'none' : '0 2px 8px rgba(0,0,0,0.1)',
        borderTop: `5px solid ${isNext ? 'var(--display-text-faint-color)' : 'var(--error)'}`,
        opacity: isEmpty ? 0.7 : 1,
        textAlign: isEmpty ? 'center' : 'left'
      }}>
        <h2 className="heat-card-title" style={{
          marginTop: 0,
          fontSize: '1.5rem',
          color: isNext ? 'var(--display-text-muted-color)' : 'var(--display-text-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          justifyContent: isEmpty ? 'center' : 'flex-start'
        }}>
          {iconPath && <Icon path={iconPath} size={1} color={isNext ? 'var(--display-text-muted-color)' : 'var(--error)'} />}
          <span>{title}</span>
          {exhibition && (
            <span style={{
              background: 'var(--display-accent-color)',
              color: 'var(--display-on-accent-color)',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              padding: '2px 8px',
              borderRadius: '12px',
              marginLeft: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Exhibition
            </span>
          )}
          {heatInfo && (
            <span style={{ fontSize: '1rem', fontWeight: 'normal', color: 'var(--display-text-muted-color)', marginLeft: 'auto' }}>({heatInfo})</span>
          )}
        </h2>

        {isEmpty ? (
          <p>No heat scheduled</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '15px' }}>
            {entries.map(({ lane, racer }: LaneEntry) => (
              <div key={lane} className="heat-card-racer" style={{ textAlign: 'center', padding: '10px', background: 'var(--display-card-bg-color)', borderRadius: '8px' }}>
                <div className="heat-card-lane" style={{ fontWeight: 'bold', marginBottom: '5px', color: 'var(--display-text-subtle-color)' }}>Lane {lane}</div>
                <RacerAvatar
                  racer={{
                    id: racer.id,
                    first_name: racer.firstName,
                    last_name: racer.lastName,
                    racer_image_url: shouldShowRacerPhoto(nameDisplay) ? racer.racerImageUrl : null
                  }}
                  size="80px"
                  style={{ margin: '0 auto 5px', border: '2px solid var(--display-border-color)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                />
                <div className="heat-card-racer-name" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                  {formatDisplayName(nameDisplay, racer.firstName, racer.lastName)}
                </div>
                {racer.carNumber && <div className="heat-card-car-number" style={{ fontSize: '0.8rem', color: 'var(--display-text-muted-color)' }}>{vehicle} #{racer.carNumber}</div>}
                {racingGroupDivisionFor(racer) && (
                  <div className="heat-card-racing-group-division" style={{ fontSize: '0.75rem', color: 'var(--display-text-subtle-color)' }}>
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
              <Icon path={mdiTrophy} size={2} color="var(--display-bg-color, #0A0A0A)" /> New track record!
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
              <div className="overlay-rank" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', minWidth: '300px', width: 'auto' }}>
                {lane.place === 1 && <Icon path={mdiTrophy} size={6} color="#FFD700" />}
                {lane.place === 2 && <Icon path={mdiTrophy} size={5} color="#C0C0C0" />}
                {lane.place === 3 && <Icon path={mdiTrophy} size={4} color="#CD7F32" />}
                <span style={{ fontSize: '5rem', lineHeight: 1 }}>
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
                size="120px"
                style={{ margin: '0 40px', border: '4px solid var(--display-text-color)', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
              />
              <div className="overlay-racer-info">
                <div className="overlay-racer-name">{lane.racerName}</div>
                <div className="overlay-car-name">{lane.carName || `Lane ${lane.laneNumber}`}</div>
              </div>
              <div className="overlay-time">
                {lane.time?.toFixed(3)}s
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
        <IdentifyPresence assignment={assignment} />
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

  // --- STANDARD MODE RENDER ---
  if (!isProjectorMode) {
    return (
      <div
        className="container"
        data-theme={displayThemeKey}
        style={{
          maxWidth: '100%',
          padding: '20px',
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
          minHeight: '100vh',
          ...displayThemeStyle,
        }}
      >
        {renderResultsOverlay()}
        <IdentifyPresence assignment={assignment} />
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {initialData?.race?.track?.id && (
            <TimerStatusBadge trackId={initialData.race.track.id} />
          )}
          <button
            onClick={() => window.open(`${window.location.pathname}?projector=true`, '_blank')}
            style={{
              padding: '10px 20px',
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

        <div className="heat-cards-layout" data-on-deck-count={onDeckHeats.length} style={{ display: 'flex', gap: '20px', marginBottom: '30px', flexWrap: 'wrap' }}>
          {renderHeatCard(
            "Now Racing",
            currentHeatRacers,
            false,
            mdiFire,
            isExhibition
              ? undefined
              : officialCurrentHeat
                ? `Round ${officialCurrentHeat.roundNumber}, Heat ${officialCurrentHeat.globalHeatNumber ?? officialCurrentHeat.heatNumber}`
                : undefined,
            isExhibition
          )}
          {renderHeatCard(
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
              two heats of a race do not leave an empty card on the wall. */}
          {afterThatHeat && renderHeatCard(
            "After That",
            afterThatRacers,
            true,
            mdiChevronDoubleRight,
            `Round ${afterThatHeat.roundNumber}, Heat ${afterThatHeat.globalHeatNumber ?? afterThatHeat.heatNumber}`
          )}
        </div>

        <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setActiveTab('standings')}
            aria-pressed={activeTab === 'standings'}
            style={{
              padding: '10px 20px',
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
              padding: '10px 20px',
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

        {activeTab === 'standings' ? (
          <div className="standings-table-wrapper" style={{ background: 'var(--display-surface-color)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
            <table className="standings-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ backgroundColor: 'var(--display-accent-color)', color: 'var(--display-on-accent-color)' }}>
                <tr>
                  <th style={{ padding: '15px' }}>Rank</th>
                  <th style={{ padding: '15px' }}>Racer</th>
                  <th style={{ padding: '15px', textAlign: 'right' }}>{scoreLabel}</th>
                  <th style={{ padding: '15px', textAlign: 'right' }}>Runs</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s: Standing) => {
                  const racer = racersMap[s.racerId];
                  return (
                    <tr key={s.racerId} className="standing-row" style={{ borderBottom: '1px solid var(--display-border-subtle-color)' }}>
                      <td className="standing-rank" style={{ padding: '15px', fontSize: '1.5rem', fontWeight: 'bold', color: s.rank === 1 ? '#d4af37' : s.rank === 2 ? '#c0c0c0' : s.rank === 3 ? '#cd7f32' : 'var(--display-text-color)' }}>
                        {s.rank}
                      </td>
                      <td className="standing-racer" style={{ padding: '15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                          <RacerAvatar
                            racer={{
                              id: s.racerId,
                              first_name: racer?.firstName || '',
                              last_name: racer?.lastName || '',
                              racer_image_url: shouldShowRacerPhoto(nameDisplay) ? racer?.racerImageUrl : null
                            }}
                            size="100px"
                            style={{ border: '3px solid var(--display-border-color)', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}
                          />
                          <div>
                            <div className="standing-racer-name" style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                              {racer ? formatDisplayName(nameDisplay, racer.firstName, racer.lastName) : `Racer #${s.racerId}`}
                            </div>
                            {racer?.carNumber && (
                              <div className="standing-car-number" style={{ color: 'var(--display-text-muted-color)', fontSize: '0.9rem' }}>{vehicle} #{racer.carNumber}</div>
                            )}
                            {s.racingGroupDivision && (
                              <div className="standing-racing-group-division" style={{ color: 'var(--display-text-subtle-color)', fontSize: '0.85rem' }}>{s.racingGroupDivision}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="standing-time" style={{ padding: '15px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatScore(s.score)}</td>
                      <td className="standing-runs" style={{ padding: '15px', textAlign: 'right', fontSize: '1.1rem' }}>{s.heatsCompleted}</td>
                    </tr>
                  );
                })}
                {standings.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '30px', textAlign: 'center' }}>No results yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="timing-list-wrapper" style={{ background: 'var(--display-surface-color)', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
            {lastHeatResults ? (
              <div>
                <h2 className="timing-header" style={{ textAlign: 'center', marginBottom: '30px', color: 'var(--display-text-color)' }}>
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
                      fontSize: '1.3rem',
                      textAlign: 'center',
                    }}
                  >
                    <Icon path={mdiTrophy} size={1.4} color="var(--display-bg-color, #0A0A0A)" />
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
                      <div className="timing-rank" style={{ fontSize: '2rem', fontWeight: 'bold', width: '60px', textAlign: 'center' }}>
                        {lane.place}
                      </div>
                      <div className="timing-racer-info" style={{ flex: 1 }}>
                        <div className="timing-racer-name" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{lane.racerName}</div>
                        <div className="timing-car-name" style={{ color: 'var(--display-text-muted-color)' }}>{lane.carName || `Lane ${lane.laneNumber}`}</div>
                      </div>
                      <div className="timing-time" style={{ fontSize: '2.5rem', fontWeight: 'bold', fontFamily: 'monospace' }}>
                        {lane.time?.toFixed(3)}s
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '50px', color: 'var(--display-text-muted-color)' }}>
                <Icon path={mdiTimerOutline} size={3} color="var(--display-border-subtle-color)" />
                <h3 style={{ color: 'var(--display-text-muted-color)' }}>Waiting for the first heat to complete...</h3>
              </div>
            )}
          </div>
        )}
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
      <div style={{ display: 'flex', height: '100%', gap: '2vmin' }}>
        {entries.map(({ lane, racer }: LaneEntry) => (
          <div key={lane} className="projector-racer-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--display-card-bg-color)', borderRadius: '1.5vmin', padding: '2vmin', textAlign: 'center' }}>
            {/* Priority 1: Racer Name */}
            <div className="projector-racer-name" style={{ fontWeight: 'bold', fontSize: isNowRacing ? '4.5vmin' : '3.5vmin', color: 'var(--display-text-color)', marginBottom: '1.5vmin', lineHeight: 1.1 }}>
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
              size={isNowRacing ? "16vmin" : "12vmin"}
              style={{ margin: '0 auto', border: '0.4vmin solid var(--display-text-color)', boxShadow: '0 0.5vmin 1vmin rgba(0,0,0,0.3)' }}
            />

            {/* Priority 3: Lane Number (Only prominent for Now Racing, very small or omitted for On Deck) */}
            <div className="projector-racer-lane-car" style={{ marginTop: '1.5vmin', display: 'flex', flexDirection: 'column', gap: '0.5vmin' }}>
              <div style={{ color: isNowRacing ? 'var(--display-text-dim-color)' : 'var(--display-placeholder-color)', fontSize: isNowRacing ? '2.5vmin' : '1.8vmin', fontWeight: isNowRacing ? 'bold' : 'normal' }}>
                Lane {lane}
              </div>
              {racer.carNumber && (
                <div style={{ color: 'var(--display-text-quiet-color)', fontSize: isNowRacing ? '2vmin' : '1.5vmin' }}>
                  {vehicle} #{racer.carNumber}
                </div>
              )}
              {racingGroupDivisionFor(racer) && (
                <div style={{ color: 'var(--display-text-quiet-color)', fontSize: isNowRacing ? '2vmin' : '1.5vmin' }}>
                  {racingGroupDivisionFor(racer)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const top5Standings = standings.slice(0, 5);
  const nowRacingHeatInfo = officialCurrentHeat ? `Round ${officialCurrentHeat.roundNumber}, Heat ${officialCurrentHeat.globalHeatNumber ?? officialCurrentHeat.heatNumber}` : undefined;

  return (
    <div
      className="container projector-mode"
      data-theme={displayThemeKey}
      style={{ maxWidth: '100%', padding: '2vmin', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', ...displayThemeStyle }}
    >
      {renderResultsOverlay()}
      <IdentifyPresence assignment={assignment} />

      <div className="projector-grid" style={{ display: 'flex', flex: '1', gap: '3vmin', height: '100%' }}>
        {/* Left Column: Active and Upcoming Heats */}
        <div className="projector-left-col" style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', gap: '3vmin', boxSizing: 'border-box' }}>

          {/* Now Racing */}
          <div className="projector-heat-panel" style={{ flex: '3', display: 'flex', flexDirection: 'column', background: 'var(--display-surface-alt-color)', borderRadius: '1.5vmin', padding: '2.5vmin', borderTop: '1vmin solid var(--error)', boxSizing: 'border-box' }}>
            <h2 style={{ fontSize: '4vmin', margin: 0, paddingBottom: '1.5vmin', display: 'flex', alignItems: 'center', gap: '1.5vmin', borderBottom: '2px solid var(--display-border-color)', marginBottom: '2vmin' }}>
              <Icon path={mdiFire} size="4vmin" color="var(--error)" />
              Now Racing
              {nowRacingHeatInfo && <span style={{ color: 'var(--display-text-faintest-color)', fontSize: '2.5vmin', marginLeft: 'auto', fontWeight: 'normal' }}>({nowRacingHeatInfo})</span>}
              {isExhibition && <span style={{ background: 'var(--display-accent-color)', color: 'var(--display-on-accent-color)', fontSize: '2vmin', padding: '0.5vmin 1.5vmin', borderRadius: '2vmin', marginLeft: 'auto' }}>EXHIBITION</span>}
              {initialData?.race?.track?.id && (
                <TimerStatusBadge trackId={initialData.race.track.id} />
              )}
            </h2>
            <div style={{ flex: 1 }}>
              {renderProjectorRacers(currentHeatRacers, true)}
            </div>
          </div>

          {/* On Deck */}
          <div className="projector-heat-panel" style={{ flex: '2', display: 'flex', flexDirection: 'column', background: 'var(--display-surface-alt-color)', borderRadius: '1.5vmin', padding: '2.5vmin', borderTop: '1vmin solid var(--display-accent-muted-color)', opacity: nextHeatRacers.length === 0 ? 0.7 : 1, boxSizing: 'border-box' }}>
            <h2 style={{ fontSize: '3.5vmin', margin: 0, paddingBottom: '1.5vmin', display: 'flex', alignItems: 'center', gap: '1.5vmin', borderBottom: '2px solid var(--display-border-color)', marginBottom: '2vmin', color: 'var(--display-text-muted-color)' }}>
              <Icon path={mdiChevronDoubleRight} size="3.5vmin" color="var(--display-text-muted-color)" />
              On Deck
            </h2>
            <div style={{ flex: 1 }}>
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
                  {top5Standings.map((s: Standing, idx: number) => {
                    const racer = racersMap[s.racerId];
                    return (
                      <tr key={s.racerId} style={{ borderBottom: idx < top5Standings.length - 1 ? '1px solid var(--display-border-color)' : 'none' }}>
                        <td className="projector-standings-rank-col" style={{ padding: '1.5vmin 0', width: '15%' }}>
                          <span style={{ fontSize: '4vmin', fontWeight: 'bold', color: s.rank === 1 ? '#d4af37' : s.rank === 2 ? '#c0c0c0' : s.rank === 3 ? '#cd7f32' : 'var(--display-text-faintest-color)' }}>
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
                                  <span style={{ fontSize: '2.5vmin', fontWeight: 'bold', color: 'var(--display-text-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                    {racer ? `${racer.firstName}` : `Racer`}
                                  </span>
                                  <span style={{ fontSize: '2vmin', fontWeight: 'bold', color: 'var(--display-text-subtle-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                    {racer ? `${racer.lastName}` : `#${s.racerId}`}
                                  </span>
                                </>
                              ) : (
                                // Abbreviated: one line, via the one formatter, rather than
                                // splitting first/last across two lines the way FULL does —
                                // a bare last initial reads oddly stacked under a first name.
                                <span style={{ fontSize: '2.5vmin', fontWeight: 'bold', color: 'var(--display-text-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                  {racer ? formatDisplayName(nameDisplay, racer.firstName, racer.lastName) : `Racer #${s.racerId}`}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="projector-standings-time-col" style={{ padding: '1.5vmin 0', width: '30%', textAlign: 'right' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                            <span style={{ fontSize: '3.5vmin', fontWeight: 'bold', fontFamily: 'monospace', color: 'var(--display-accent-color)', lineHeight: '1' }}>
                              {formatProjectorScore(s.score)}
                            </span>
                            <span style={{ fontSize: '1.5vmin', color: 'var(--display-text-faintest-color)', textTransform: 'uppercase', letterSpacing: '0.1vmin', marginTop: '0.5vmin' }}>
                              {scoreLabel}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--display-placeholder-color)', fontSize: '3vmin' }}>
                No results yet.
              </div>
            )}

            {/* Empty rows filler if less than 5 to keep height consistent */}
            {top5Standings.length > 0 && top5Standings.length < 5 && Array.from({ length: 5 - top5Standings.length }).map((_, i) => (
               <div key={`empty-${i}`} style={{ flex: 1, borderTop: '1px dashed var(--display-border-color)', minHeight: '8vmin' }}></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
