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

export const INITIAL_CONFIG_QUERY = `
  query GetInitialConfig {
    initialConfig {
      initialized
      version
      debugMode
    }
  }
`;

/**
 * Selecting the `heat` and `racer` payloads is what lets the normalized cache
 * merge a change instead of the page re-querying itself. The fields listed here
 * are the ones the pages actually render, so a merge leaves no gaps.
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
        laneResults
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
        denId
      }
    }
  }
`;
