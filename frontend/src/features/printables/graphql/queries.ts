import { gql } from 'urql';

/**
 * Only what a card shows. The roster query next door also pulls the
 * leaderboard and the schedule, and a print page that waits on those is a
 * print page the operator waits on with sixty scouts in the room.
 */
export const GET_PRINTABLES = gql`
  query GetPrintables($raceId: Int!) {
    initialConfig {
      printablesTheme
    }
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      racingGroups {
        id
        name
        color
      }
      racers {
        id
        firstName
        lastName
        carNumber
        carName
        racingGroupId
        racerImageUrl
      }
    }
  }
`;

/**
 * The running order, for the printed heat sheet (#173).
 *
 * Heats and their lanes rather than the roster's cards, plus the track's lane
 * count so every row has the same columns. `tracks` is a separate root field,
 * which is why it is here rather than under `race`.
 */
export const GET_HEAT_SHEET = gql`
  query GetHeatSheet($raceId: Int!) {
    initialConfig {
      printablesTheme
    }
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      trackId
      rounds {
        id
        name
        roundNumber
        advancementSource
      }
      heats {
        id
        heatNumber
        roundId
        lanes {
          lane
          racerId
          placeholderSlot
        }
      }
      racers {
        id
        firstName
        lastName
        carNumber
      }
    }
    tracks {
      id
      laneCount
    }
  }
`;

/**
 * The results, once the racing is over (#206).
 *
 * The standings are the preliminary ones by default, which is what #17
 * settled — a championship's placings are a consequence of these, not part of
 * them, and the trophies for it come through `awards` instead.
 */
export const GET_RESULTS_SHEET = gql`
  query GetResultsSheet($raceId: Int!) {
    initialConfig {
      printablesTheme
    }
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      scoringStrategy
      leaderboard {
        racerId
        rank
        firstName
        lastName
        carNumber
        racingGroupName
        score
        heatsCompleted
      }
      racers {
        id
        excludedFromStandings
      }
      awards {
        id
        name
        kind
        sortOrder
        recipient {
          id
          firstName
          lastName
          carNumber
        }
      }
    }
  }
`;

/**
 * One certificate per award (#306).
 *
 * Only what a certificate shows — no leaderboard, no schedule. `artworkKey` is
 * what tells the page whether to draw a ready-made superlative's clipart or a
 * plain certificate.
 */
export const GET_CERTIFICATES = gql`
  query GetCertificates($raceId: Int!) {
    initialConfig {
      printablesTheme
    }
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      awards {
        id
        name
        kind
        sortOrder
        artworkKey
        recipient {
          id
          firstName
          lastName
          carNumber
        }
      }
    }
  }
`;
