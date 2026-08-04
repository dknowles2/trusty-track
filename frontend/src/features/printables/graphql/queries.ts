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
