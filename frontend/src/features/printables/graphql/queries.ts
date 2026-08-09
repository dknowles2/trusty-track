import { gql } from 'urql';

/**
 * Only what a card shows. The roster query next door also pulls the
 * leaderboard and the schedule, and a print page that waits on those is a
 * print page the operator waits on with sixty scouts in the room.
 */
export const GET_PRINTABLES = gql`
  query GetPrintables($raceId: Int!) {
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      dens {
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
        denId
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
