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
      carNumberingStrategy
      globalStartNumber
      championshipTrophies
      registeredCount
      checkedInCount
      dens {
        id
        name
        color
        rank
        carNumberRangeStart
        carNumberRangeEnd
      }
      racers {
        id
        firstName
        lastName
        carNumber
        denId
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
        denName
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

export const GET_RACE_DENS = gql`
  query GetRaceDens($raceId: Int!) {
    race(raceId: $raceId) {
      id
      dens {
        id
        name
        color
        rank
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
      carNumberingStrategy
      globalStartNumber
      championshipTrophies
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

export const CREATE_DEN = gql`
  mutation CreateDen($raceId: Int!, $den: DenInput!) {
    createDen(raceId: $raceId, den: $den) {
      id
      name
    }
  }
`;

export const UPDATE_DEN = gql`
  mutation UpdateDen($id: Int!, $den: DenInput!) {
    updateDen(id: $id, den: $den) {
      id
      name
    }
  }
`;

export const DELETE_DEN = gql`
  mutation DeleteDen($id: Int!) {
    deleteDen(id: $id)
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

export const BULK_MOVE_TO_DEN = gql`
  mutation BulkMoveToDen($racerIds: [Int!]!, $denId: Int) {
    bulkMoveToDen(racerIds: $racerIds, denId: $denId)
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
