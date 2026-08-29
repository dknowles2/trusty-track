import { gql } from 'urql';

export const GET_TRACKS = gql`
  query GetTracks {
    tracks {
      id
      name
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

export const INITIAL_CONFIG_QUERY = `
  query GetInitialConfig {
    initialConfig {
      initialized
      version
      debugMode
      pinRequired
      isOperator
      demoMode
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
