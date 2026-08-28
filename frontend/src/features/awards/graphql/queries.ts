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
      votingOpen
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
        votable
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
        voteTally {
          racerId
          voteCount
          racer {
            id
            carNumber
            carName
          }
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

/**
 * The single-field race edit that opens or closes voting (#305).
 *
 * `updateRace` already drops any field this does not send, so toggling this
 * one thing does not touch the rest of the race — the same shape
 * `RaceControl`'s auto-advance toggle uses.
 */
export const UPDATE_RACE_VOTING_MUTATION = gql`
  mutation UpdateRaceVoting($id: Int!, $race: RaceUpdateInput!) {
    updateRace(id: $id, race: $race) {
      id
      votingOpen
    }
  }
`;

/**
 * What the ballot screen needs, and nothing about who built a car (#305).
 *
 * No `firstName`, `lastName` or `racerImageUrl` — the anonymity the ballot
 * page promises is enforced here, by what this query asks for, not by a
 * server-side check.
 */
export const VOTING_BALLOT_QUERY = gql`
  query VotingBallot($raceId: Int!) {
    race(raceId: $raceId) {
      id
      name
      votingOpen
      awards {
        id
        name
        kind
        votable
      }
      racers {
        id
        carNumber
        carName
        carImageUrl
      }
    }
  }
`;

export const CAST_VOTE_MUTATION = gql`
  mutation CastVote($awardId: Int!, $racerId: Int!, $ballotKey: String!) {
    castVote(awardId: $awardId, racerId: $racerId, ballotKey: $ballotKey)
  }
`;
