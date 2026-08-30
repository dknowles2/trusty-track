import { gql } from 'urql';

export const GET_RACE_DETAILS = gql`
  query GetRaceDetails($raceId: Int!) {
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      trackId
      scoringStrategy
      tiebreaker
      # How many of each racer's worst counted results are dropped before
      # scoring (#547 stage 2/3) — a modifier over scoringStrategy, not a
      # strategy of its own. RaceForm's number input reads this back.
      dropWorstRuns
      carNumberingStrategy
      globalStartNumber
      championshipTrophies
      weightLimitOz
      # One interleaved running order across racing groups, rather than a
      # block per group (#549 stage 4) — RaceForm's checkbox for it.
      masterRunningOrder
      racingGroupSingular
      racingGroupPlural
      organizationSingular
      organizationPlural
      vehicleSingular
      vehiclePlural
      registeredCount
      checkedInCount
      racingGroups {
        id
        name
        color
        division
        carNumberRangeStart
        carNumberRangeEnd
      }
      racers {
        id
        firstName
        lastName
        carNumber
        racingGroupId
        carName
        carPassedInspection
        carWeight
        racerImageUrl
        carImageUrl
      }
      leaderboard {
        racerId
        firstName
        lastName
        carNumber
        racingGroupName
        score
        heatsCompleted
        racerImageUrl
        rank
      }
      scheduledRacerIds
      # Only to know whether a schedule exists at all, for the setup checklist
      # (#199). scheduledRacerIds cannot answer it: a championship round holds
      # placeholders until it is advanced, so a race can have a round and
      # nobody in a heat.
      rounds {
        id
      }
    }
    tracks {
      id
      name
      laneCount
    }
  }
`;

export const GET_RACE_RACING_GROUPS = gql`
  query GetRaceRacingGroups($raceId: Int!) {
    race(raceId: $raceId) {
      id
      racingGroups {
        id
        name
        color
        division
        carNumberRangeStart
        carNumberRangeEnd
      }
    }
  }
`;

export const UPDATE_RACE = gql`
  mutation UpdateRace($id: Int!, $race: RaceUpdateInput!) {
    updateRace(id: $id, race: $race) {
      id
      name
      dateTime
      location
      trackId
      scoringStrategy
      tiebreaker
      dropWorstRuns
      carNumberingStrategy
      globalStartNumber
      championshipTrophies
      weightLimitOz
      masterRunningOrder
      racingGroupSingular
      racingGroupPlural
      organizationSingular
      organizationPlural
      vehicleSingular
      vehiclePlural
      # The raw override columns above are what the form edits;
      # terminology is the resolved value RaceTerminologyGate reads
      # (#496 stage 4, issue #531). Without it, graphcache writes the raw
      # columns onto this Race and leaves its cached terminology exactly
      # as it found it, so a race page already in the normalized cache keeps
      # showing the old words until a reload.
      terminology {
        racingGroupSingular
        racingGroupPlural
        organizationSingular
        organizationPlural
        vehicleSingular
        vehiclePlural
      }
    }
  }
`;

export const DELETE_RACE = gql`
  mutation DeleteRace($id: Int!) {
    deleteRace(id: $id)
  }
`;

export const CREATE_RACER = gql`
  mutation CreateRacer($racer: RacerInput!) {
    createRacer(racer: $racer) {
      id
    }
  }
`;

export const UPDATE_RACER = gql`
  mutation UpdateRacer($id: Int!, $racer: RacerInput!) {
    updateRacer(id: $id, racer: $racer) {
      id
    }
  }
`;

export const DELETE_RACER = gql`
  mutation DeleteRacer($id: Int!) {
    deleteRacer(id: $id)
  }
`;

export const CHECK_IN_RACER = gql`
  mutation CheckInRacer($id: Int!, $passedInspection: Boolean!, $weight: Float!, $racerImageUrl: String, $carImageUrl: String) {
    checkInRacer(id: $id, passedInspection: $passedInspection, weight: $weight, racerImageUrl: $racerImageUrl, carImageUrl: $carImageUrl) {
      id
      carPassedInspection
      carWeight
    }
  }
`;

export const IMPORT_RACERS = gql`
  mutation ImportRacers($raceId: Int!, $csvData: String!) {
    importRacers(raceId: $raceId, csvData: $csvData)
  }
`;

export const CREATE_RACING_GROUP = gql`
  mutation CreateRacingGroup($raceId: Int!, $racingGroup: RacingGroupInput!) {
    createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) {
      id
      name
    }
  }
`;

export const UPDATE_RACING_GROUP = gql`
  mutation UpdateRacingGroup($id: Int!, $racingGroup: RacingGroupInput!) {
    updateRacingGroup(id: $id, racingGroup: $racingGroup) {
      id
      name
    }
  }
`;

export const DELETE_RACING_GROUP = gql`
  mutation DeleteRacingGroup($id: Int!) {
    deleteRacingGroup(id: $id)
  }
`;

export const BULK_AUTO_NUMBER = gql`
  mutation BulkAutoNumber($racerIds: [Int!]!) {
    bulkAutoNumber(racerIds: $racerIds)
  }
`;

export const BULK_CLEAR_NUMBERS = gql`
  mutation BulkClearNumbers($racerIds: [Int!]!) {
    bulkClearNumbers(racerIds: $racerIds)
  }
`;

export const BULK_CHECK_IN = gql`
  mutation BulkCheckIn($racerIds: [Int!]!, $passedInspection: Boolean!) {
    bulkCheckIn(racerIds: $racerIds, passedInspection: $passedInspection)
  }
`;

export const BULK_MOVE_TO_RACING_GROUP = gql`
  mutation BulkMoveToRacingGroup($racerIds: [Int!]!, $racingGroupId: Int) {
    bulkMoveToRacingGroup(racerIds: $racerIds, racingGroupId: $racingGroupId)
  }
`;

export const BULK_DELETE_RACERS = gql`
  mutation BulkDeleteRacers($racerIds: [Int!]!) {
    bulkDeleteRacers(racerIds: $racerIds)
  }
`;

export const CREATE_RACE = gql`
  mutation CreateRace($race: RaceInput!) {
    createRace(race: $race) {
      id
    }
  }
`;

export const POPULATE_RACE = gql`
  mutation PopulateRace($raceId: Int!, $config: PopulateTestDataInput!) {
    populateRace(raceId: $raceId, config: $config)
  }
`;

export const UPLOAD_IMAGE = gql`
  mutation UploadImage($dataUrl: String!) {
    uploadImage(dataUrl: $dataUrl)
  }
`;

export const BULK_ASSIGN_PHOTOS = gql`
  mutation BulkAssignPhotos($assignments: [PhotoAssignmentInput!]!) {
    bulkAssignPhotos(assignments: $assignments)
  }
`;

/**
 * A whole event on a fake timer, ready to run (#201).
 *
 * One mutation rather than the five round trips a client would need — race,
 * racingGroups, roster, check-in, rounds — because a rehearsal that fails half way
 * leaves the operator with a broken race to tidy up.
 */
export const CREATE_PRACTICE_RACE = gql`
  mutation CreatePracticeRace {
    createPracticeRace {
      id
      name
    }
  }
`;
