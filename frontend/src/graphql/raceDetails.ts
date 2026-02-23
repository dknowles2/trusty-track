import { gql } from 'urql';

export const GET_RACE_DETAILS = gql`
  query GetRaceDetails($raceId: Int!) {
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
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

export const CREATE_ROUND_WIZARD = gql`
  mutation CreateRoundWizard($raceId: Int!, $config: WizardConfigurationInput!) {
    createRoundWizard(raceId: $raceId, config: $config) {
      id
      roundNumber
      name
    }
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

export const RACE_STATE_CHANGED_SUBSCRIPTION = `
  subscription RaceStateChanged($raceId: Int!) {
    raceStateChanged(raceId: $raceId) {
      raceId
      changedAt
    }
  }
`;

export const GET_RACE_STATS = gql`
  query GetRaceStats($raceId: Int!) {
    raceStats(raceId: $raceId) {
      raceId
      raceName
      scoringStrategy
      totalHeatsScheduled
      totalHeatsCompleted
      totalRacers
      laneStats { lane avgTime heatCount relativeAdvantagePct }
      racerStats {
        racerId firstName lastName carNumber denName
        heatsCompleted heatsScheduled minTime maxTime meanTime stdDev
        timesPerLane { lane avgTime }
      }
      highlights { type roundName heatNumber racerName time margin }
      denStats { denId denName denColor racerCount avgScore bestRacerName }
      heatResults { roundName heatNumber lane carNumber racerFirstName racerLastName time place }
    }
  }
`;

export const FAKE_TIMER_START = gql`
  mutation FakeTimerStart($heatId: Int!) {
    fakeTimerStart(heatId: $heatId)
  }
`;

export const FAKE_TIMER_FINISH = gql`
  mutation FakeTimerFinish($heatId: Int!) {
    fakeTimerFinish(heatId: $heatId)
  }
`;

export const TIMER_STATUS_SUBSCRIPTION = gql`
  subscription TimerStatus($trackId: Int!) {
    timerStatus(trackId: $trackId) {
      status {
        state
        deviceName
        laneCount
        activeHeatId
        lastError
        pendingResults {
          lane
          time
          place
        }
      }
    }
  }
`;

export const PREPARE_HEAT = gql`
  mutation PrepareHeat($heatId: Int!) {
    prepareHeat(heatId: $heatId)
  }
`;

export const ABORT_HEAT = gql`
  mutation AbortHeat($trackId: Int!) {
    abortHeat(trackId: $trackId)
  }
`;

export const FORCE_RESULTS = gql`
  mutation ForceResults($trackId: Int!) {
    forceResults(trackId: $trackId)
  }
`;
