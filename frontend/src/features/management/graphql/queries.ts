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
      # The full-screen QR code display view's own text (#614) —
      # RaceForm's optional headline/Wi-Fi-note inputs read these back.
      qrHeadline
      qrWifiNote
      # One interleaved running order across racing groups, rather than a
      # block per group (#549 stage 4) — RaceForm's checkbox for it.
      masterRunningOrder
      racingGroupSingular
      racingGroupPlural
      organizationSingular
      organizationPlural
      vehicleSingular
      vehiclePlural
      vehicleArtworkKey
      # Once a championship round is decided, its winner stops counting
      # toward the standings they qualified from (#548) — the race form's
      # checkbox for it.
      excludeRoundWinnersFromQualifyingStandings
      # At most one trophy per racer (#615) — RaceForm's checkbox for it.
      oneTrophyPerRacer
      # A per-race override of how much of a racer's name a public screen
      # may show (#552), null where this race inherits the organization's
      # setting — the raw column RaceForm's checkbox reads, mirroring the
      # terminology overrides above.
      nameDisplay
      resolvedNameDisplay
      # Whether the race is locked against further edits (#585) — gates the
      # roster toolbar and drives the "Locked" badge.
      isLocked
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
        excludedFromStandings
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
      qrHeadline
      qrWifiNote
      masterRunningOrder
      racingGroupSingular
      racingGroupPlural
      organizationSingular
      organizationPlural
      vehicleSingular
      vehiclePlural
      vehicleArtworkKey
      excludeRoundWinnersFromQualifyingStandings
      oneTrophyPerRacer
      # Same shape and same reason as the terminology pair below (#552):
      # the raw column is what the form edits, and resolvedNameDisplay is
      # what every abbreviating surface actually reads — without it,
      # graphcache writes the raw column onto this Race and leaves its
      # cached resolved value exactly as it found it.
      nameDisplay
      resolvedNameDisplay
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
        vehicleArtworkKey
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

// A GrandPrix Race Manager database import (#618). Preview parses an
// uploaded file and writes nothing; confirm re-parses the identical upload
// and writes it -- there is no session on the server holding the file
// between the two calls, so `fileData` is sent again rather than trusted
// back from a previous response.
export const PREVIEW_GPRM_IMPORT = gql`
  mutation PreviewGprmImport($raceId: Int!, $fileData: String!) {
    previewGprmImport(raceId: $raceId, fileData: $fileData) {
      canImport
      groups {
        name
        division
      }
      racers {
        firstName
        lastName
        carNumber
        carName
        carWeight
        passedInspection
        group
        excludedFromStandings
        sourceId
      }
      problems {
        message
        blocking
        sourceId
      }
    }
  }
`;

export const CONFIRM_GPRM_IMPORT = gql`
  mutation ConfirmGprmImport($raceId: Int!, $fileData: String!) {
    confirmGprmImport(raceId: $raceId, fileData: $fileData)
  }
`;

// The DerbyNet twin of the pair above (#661) -- a sibling mutation pair
// rather than a `source` argument on the GPRM one, so adding a second
// importer did not mean renaming an already-shipped mutation. Same shape:
// preview writes nothing, confirm re-parses and writes the identical
// upload.
export const PREVIEW_DERBYNET_IMPORT = gql`
  mutation PreviewDerbynetImport($raceId: Int!, $fileData: String!) {
    previewDerbynetImport(raceId: $raceId, fileData: $fileData) {
      canImport
      groups {
        name
        division
      }
      racers {
        firstName
        lastName
        carNumber
        carName
        carWeight
        passedInspection
        group
        excludedFromStandings
        sourceId
      }
      problems {
        message
        blocking
        sourceId
      }
    }
  }
`;

export const CONFIRM_DERBYNET_IMPORT = gql`
  mutation ConfirmDerbynetImport($raceId: Int!, $fileData: String!) {
    confirmDerbynetImport(raceId: $raceId, fileData: $fileData)
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

export const BULK_SET_EXCLUDED_FROM_STANDINGS = gql`
  mutation BulkSetExcludedFromStandings($racerIds: [Int!]!, $excluded: Boolean!) {
    bulkSetExcludedFromStandings(racerIds: $racerIds, excluded: $excluded)
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
 *
 * Resumes the most recent rehearsal rather than building another one (#588)
 * unless `startNew` says otherwise — see Home.tsx's `handlePractice`.
 */
export const CREATE_PRACTICE_RACE = gql`
  mutation CreatePracticeRace($startNew: Boolean) {
    createPracticeRace(startNew: $startNew) {
      id
      name
    }
  }
`;
