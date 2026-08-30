import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import Navigation from './features/core/components/Navigation';
import PageTitle from './features/core/components/PageTitle';
import { ChromeProvider } from './context/ChromeContext';
import SystemSettings from './features/settings/pages/SystemSettings';
import Home from './features/management/pages/Home';
import { useQuery } from 'urql';
import { AlertProvider } from './context/AlertContext';
import { SerialProxyProvider } from './context/SerialProxyContext';
import { TerminologyProvider } from './context/TerminologyContext';

import RaceDetails from './features/management/pages/RaceDetails';
import RaceControl from './features/racing/pages/RaceControl';

/** Race Control, remounted whenever the race changes.
 *
 * The screen holds a good deal of per-race state — the heat on the track, the
 * one selected, a round summary, and which rounds had already been decided
 * when we first looked. Keying it means a different race is a different
 * component, rather than a list of things to remember to clear.
 */
function KeyedRaceControl() {
    const { raceId } = useParams<{ raceId: string }>();
    return <RaceControl key={raceId} />;
}
import Observation from './features/observation/pages/Observation';
import Standings from './features/stats/pages/Standings';
import RaceStats from './features/stats/pages/RaceStats';
import Awards from './features/awards/pages/Awards';
import AwardCeremony from './features/awards/pages/AwardCeremony';
import VotingBallot from './features/awards/pages/VotingBallot';
import Printables from './features/printables/pages/Printables';
import HeatSheet from './features/printables/pages/HeatSheet';
import ResultsSheet from './features/printables/pages/ResultsSheet';
import Certificate from './features/printables/pages/Certificate';
import TimerDiagnostics from './features/settings/pages/TimerDiagnostics';
import ActivityLog from './features/settings/pages/ActivityLog';

import { INITIAL_CONFIG_QUERY, RACE_TERMINOLOGY_QUERY } from './features/core/graphql/queries';
import { DemoSessionGate } from './features/core/components/DemoSessionGate';
import type { GetInitialConfigStatusQuery, GetRaceTerminologyQuery } from './gql/operations';

/** Seeds the organization's default terminology for the whole app —
 * `initialConfig.terminology` is the organization default resolved against
 * the built-in Scouting words, with no race in view (#496 stage 4). Home,
 * System Settings and anything else outside `/race/:raceId` read this and
 * nothing else. Shares the cache with `ProtectedRoute` and `DemoSession`,
 * which run the identical query. */
function AppTerminologyProvider({ children }: { children: React.ReactNode }) {
  const [{ data }] = useQuery<GetInitialConfigStatusQuery>({ query: INITIAL_CONFIG_QUERY });
  return (
    <TerminologyProvider value={data?.initialConfig?.terminology}>
      {children}
    </TerminologyProvider>
  );
}

/** Overrides the app-wide default with this race's own resolved terms —
 * `Race.terminology` already layers the organization default underneath a
 * race override on the server, so there is nothing to merge here (#496
 * stage 4). While the query is in flight `TerminologyProvider` keeps
 * whatever `AppTerminologyProvider` already supplied, so a race with no
 * override of its own never flashes the built-in words before settling on
 * the identical organization ones. */
function RaceTerminologyGate({ children }: { children: React.ReactNode }) {
  const { raceId } = useParams<{ raceId: string }>();
  const [{ data }] = useQuery<GetRaceTerminologyQuery>({
    query: RACE_TERMINOLOGY_QUERY,
    variables: { raceId: Number(raceId) },
    pause: !raceId,
  });
  return (
    <TerminologyProvider value={data?.race?.terminology}>
      {children}
    </TerminologyProvider>
  );
}

/** Wraps a race-scoped route's element in both the first-run gate and the
 * race's own terminology, so the route table below stays a flat list. */
function raceRoute(element: React.ReactNode) {
  return (
    <ProtectedRoute>
      <RaceTerminologyGate>{element}</RaceTerminologyGate>
    </ProtectedRoute>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  // Not `network-only`, which is what this asked for and never got. `Routes`
  // renders one matched element, and every route's element is a
  // `ProtectedRoute` — so moving between routes updates this component's
  // children rather than remounting it, and a policy that only refetches on
  // mount refetches once per page load. What keeps the answer fresh is the
  // cache being told to forget it when a config mutation changes it; see
  // `forgetInitialConfig` in `api/graphqlClient.ts`.
  const [result] = useQuery<GetInitialConfigStatusQuery>({ query: INITIAL_CONFIG_QUERY });

  const { data, fetching, error } = result;

  if (fetching) return <div>Loading...</div>;

  if (error) {
    console.error("Failed to check init status", error);
  }

  const initialized = data?.initialConfig?.initialized ?? false;

  if (!initialized && location.pathname !== '/system-settings') {
    return <Navigate to="/system-settings" replace />;
  }

  return children;
}

/**
 * The demo's idle disconnect, wired to the flag the server reports.
 *
 * Its own component so the gate stays testable without a GraphQL client, and
 * inside `Router` so the overlay covers every route. The query is the same one
 * `ProtectedRoute` runs, so urql answers it from the cache rather than asking
 * twice.
 */
function DemoSession() {
  const [{ data }] = useQuery<GetInitialConfigStatusQuery>({ query: INITIAL_CONFIG_QUERY });
  return <DemoSessionGate enabled={data?.initialConfig?.demoMode ?? false} />;
}

function App() {
  return (
    <AlertProvider>
      <SerialProxyProvider>
        {/* Wraps both the navigation and the routes, because a full-screen
            view inside the routes is what tells the navigation to go away. */}
        <ChromeProvider>
        <Router>
          <AppTerminologyProvider>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <DemoSession />
            {/* Renders nothing; it names the browser tab. Here rather than in
                each page, so a new route gets a title without anybody
                remembering to add one. */}
            <PageTitle />
            <Navigation />
            <main style={{ flex: 1 }}>
              <Routes>
                <Route path="/system-settings" element={<ProtectedRoute><SystemSettings /></ProtectedRoute>} />
                <Route path="/system-config" element={<Navigate to="/system-settings" replace />} />
                <Route path="/timer-check" element={<ProtectedRoute><TimerDiagnostics /></ProtectedRoute>} />
                <Route path="/activity" element={<ProtectedRoute><ActivityLog /></ProtectedRoute>} />
                <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
                <Route path="/race/:raceId" element={raceRoute(<RaceDetails />)} />
                <Route path="/race/:raceId/standings" element={raceRoute(<Standings />)} />
                <Route path="/race/:raceId/awards" element={raceRoute(<Awards />)} />
                <Route path="/race/:raceId/awards/present" element={raceRoute(<AwardCeremony />)} />
                {/* No PIN needed to reach it — a phone in the room votes as a
                    VIEWER (#305). `ProtectedRoute` still applies: it is only
                    the first-run gate, not a role check. */}
                <Route path="/race/:raceId/vote" element={raceRoute(<VotingBallot />)} />
                <Route path="/race/:raceId/stats" element={raceRoute(<RaceStats />)} />
                <Route path="/race/:raceId/print" element={raceRoute(<Printables />)} />
                <Route path="/race/:raceId/print/heat-sheet" element={raceRoute(<HeatSheet />)} />
                <Route path="/race/:raceId/print/results" element={raceRoute(<ResultsSheet />)} />
                <Route path="/race/:raceId/print/certificates" element={raceRoute(<Certificate />)} />
                <Route path="/race/:raceId/checkin" element={<Navigate to="../" relative="path" replace />} />
                {/* Keyed on the race: switching races is a fresh screen, so no
                    state from the last one can survive into the next. */}
                <Route path="/race/:raceId/control/:tab?" element={raceRoute(<KeyedRaceControl />)} />
                <Route path="/race/:raceId/observation" element={raceRoute(<Observation />)} />

                {/* Legacy Redirects or Handle 404 */}
                <Route path="/checkin" element={<Navigate to="/" replace />} />
                <Route path="/control" element={<Navigate to="/" replace />} />
                <Route path="/observation" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
          </AppTerminologyProvider>
        </Router>
        </ChromeProvider>
      </SerialProxyProvider>
    </AlertProvider>
  );
}

export default App;
