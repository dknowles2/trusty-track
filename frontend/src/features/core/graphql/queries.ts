import { gql } from 'urql';

export const GET_TRACKS = gql`
  query GetTracks {
    tracks {
      id
      name
      # RaceForm reads this to know whether a tiebreaker method that needs
      # recorded times can ever fire on the track a race would use (#540) —
      # a POINTS race on a NONE-timer track told BEST_TIME will never fire.
      timerType
    }
  }
`;

export const GET_RACES_NAV = gql`
  query GetRacesNav {
    races {
      id
      name
    }
  }
`;

// A bare signal, not the list itself (#300) — a create, rename or delete of
// any race, from any tab, is a nudge to re-run GET_RACES_NAV rather than a
// second copy of the list to keep in step with that query.
export const RACES_CHANGED = gql`
  subscription RacesChanged {
    racesChanged
  }
`;

// Named `GetInitialConfigStatus` rather than `GetInitialConfig` — that name
// is already taken by a `gql`-tagged document in `graphqlClient.test.ts`, and
// codegen requires every operation name in the tree to be unique.
export const INITIAL_CONFIG_QUERY = gql`
  query GetInitialConfigStatus {
    initialConfig {
      initialized
      version
      debugMode
      pinRequired
      isOperator
      demoMode
      terminology {
        racingGroupSingular
        racingGroupPlural
        organizationSingular
        organizationPlural
      }
    }
  }
`;

// The one query `RaceTerminologyGate` runs per race, so every page under
// `/race/:raceId` reads `useTerminology()` rather than asking the server
// itself (#496 stage 4). Kept separate from each page's own race query —
// those already vary in shape, and this field is cheap and identical
// everywhere it is needed.
export const RACE_TERMINOLOGY_QUERY = gql`
  query GetRaceTerminology($raceId: Int!) {
    race(raceId: $raceId) {
      id
      terminology {
        racingGroupSingular
        racingGroupPlural
        organizationSingular
        organizationPlural
      }
    }
  }
`;

/**
 * Selecting the `heat` and `racer` payloads is what lets the normalized cache
 * merge a change instead of the page re-querying itself. The fields listed here
 * are the ones the pages actually render, so a merge leaves no gaps.
 *
 * `lanes` has to be here for the same reason: the cache merges this heat into
 * the one it already holds, so a field left out keeps its previous value. A
 * payload carrying a new result but stale lanes would render the result against
 * the wrong schedule.
 */
export const RACE_STATE_CHANGED_SUBSCRIPTION = `
  subscription RaceStateChanged($raceId: Int!) {
    raceStateChanged(raceId: $raceId) {
      raceId
      changedAt
      kind
      roundId
      heat {
        id
        raceId
        roundId
        heatNumber
        roundNumber
        roundName
        lanes {
          lane
          racerId
          placeholderSlot
          time
          place
          skipped
        }
      }
      racer {
        id
        raceId
        firstName
        lastName
        carNumber
        carName
        carWeight
        carPassedInspection
        racerImageUrl
        carImageUrl
        racingGroupId
      }
    }
  }
`;
