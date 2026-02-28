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
      debugMode
    }
  }
`;

export const RACE_STATE_CHANGED_SUBSCRIPTION = `
  subscription RaceStateChanged($raceId: Int!) {
    raceStateChanged(raceId: $raceId) {
      raceId
      changedAt
    }
  }
`;
