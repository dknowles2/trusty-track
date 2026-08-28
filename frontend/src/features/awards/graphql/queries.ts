import { gql } from 'urql';

/**
 * Everything the awards screen needs in one query.
 *
 * The rounds and dens come along because both are pickers on the form — a
 * speed award names a source and optionally a den — and asking for them
 * separately would be two round trips to draw one page.
 */
export const RACE_AWARDS_QUERY = gql`
  query RaceAwards($raceId: Int!) {
    race(raceId: $raceId) {
      id
      name
      awards {
        id
        name
        kind
        sortOrder
        source
        place
        fromBottom
        denId
        artworkKey
        den {
          id
          name
        }
        recipient {
          id
          firstName
          lastName
          carNumber
          racerImageUrl
        }
      }
      rounds {
        id
        name
        roundNumber
      }
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
      }
    }
  }
`;

export const CREATE_AWARD_MUTATION = gql`
  mutation CreateAward($raceId: Int!, $award: AwardInput!) {
    createAward(raceId: $raceId, award: $award) {
      id
    }
  }
`;

export const UPDATE_AWARD_MUTATION = gql`
  mutation UpdateAward($id: Int!, $award: AwardInput!) {
    updateAward(id: $id, award: $award) {
      id
    }
  }
`;

export const DELETE_AWARD_MUTATION = gql`
  mutation DeleteAward($id: Int!) {
    deleteAward(id: $id)
  }
`;

export const REORDER_AWARDS_MUTATION = gql`
  mutation ReorderAwards($raceId: Int!, $awardIds: [Int!]!) {
    reorderAwards(raceId: $raceId, awardIds: $awardIds) {
      id
      sortOrder
    }
  }
`;
