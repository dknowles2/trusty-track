import { gql } from 'urql';

export const CREATE_ROUND_WIZARD = gql`
  mutation CreateRoundWizard($raceId: Int!, $config: WizardConfigurationInput!) {
    createRoundWizard(raceId: $raceId, config: $config) {
      id
      roundNumber
      name
    }
  }
`;

export const FAKE_TIMER_START = gql`
  mutation FakeTimerStart($heatId: Int!, $isFreeRace: Boolean = false) {
    fakeTimerStart(heatId: $heatId, isFreeRace: $isFreeRace)
  }
`;

export const FAKE_TIMER_FINISH = gql`
  mutation FakeTimerFinish($heatId: Int!, $isFreeRace: Boolean = false) {
    fakeTimerFinish(heatId: $heatId, isFreeRace: $isFreeRace)
  }
`;

/**
 * Just enough of the timer to say whether a heat could be armed (#200).
 *
 * Deliberately not TIMER_STATUS_SUBSCRIPTION, which carries the whole serial
 * log and every pending lane time — a lot of traffic for a strip that wants a
 * state and a device name.
 */
export const TIMER_READINESS_SUBSCRIPTION = gql`
  subscription TimerReadiness($trackId: Int!) {
    timerStatus(trackId: $trackId) {
      status {
        state
        deviceName
        deviceProvenance
      }
    }
  }
`;

export const TIMER_STATUS_SUBSCRIPTION = gql`
  subscription TimerStatus($trackId: Int!) {
    timerStatus(trackId: $trackId) {
      status {
        state
        deviceName
        canRemoteStart
        laneCount
        activeHeatId
        lastError
        pendingResults {
          lane
          time
          place
          racerId
        }
        serialLog {
          direction
          data
          timestamp
        }
        racerByLane
      }
    }
  }
`;

/**
 * The live view of a track: the heat merged with the timer, assembled by the
 * server (#7).
 *
 * Replaces reconciling `timerStatus.pendingResults` against the heat's stored
 * lanes in a render function. `pending` is the field that made the merge worth
 * moving — it says a time came from the timer and is not saved yet, which an
 * abort can still take away.
 */
export const HEAT_SESSION_SUBSCRIPTION = gql`
  subscription HeatSession($trackId: Int!, $heatId: Int) {
    heatSession(trackId: $trackId, heatId: $heatId) {
      trackId
      heatId
      phase
      timerState
      lanes {
        lane
        racerId
        placeholderSlot
        time
        place
        skipped
        pending
      }
    }
  }
`;

export const PREPARE_HEAT = gql`
  mutation PrepareHeat($heatId: Int!, $isFreeRace: Boolean = false) {
    prepareHeat(heatId: $heatId, isFreeRace: $isFreeRace)
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

export const RECONNECT_TIMER = gql`
  mutation ReconnectTimer($trackId: Int!) {
    reconnectTimer(trackId: $trackId)
  }
`;

/**
 * Open the start gate on a track fitted with a solenoid to do it (#111).
 *
 * Returns null on success, or the reason it did not happen — every refusal
 * has a different operator response, so the mutation says which.
 */
export const RELEASE_START_GATE = gql`
  mutation ReleaseStartGate($trackId: Int!) {
    releaseStartGate(trackId: $trackId)
  }
`;

export const GET_RACE_CONTROL_DATA = gql`
  query GetRaceControlData($id: Int!) {
    initialConfig {
      debugMode
    }
    race(raceId: $id) {
      id
      name
      championshipTrophies
      scoringStrategy
      autoAdvanceHeat
      registeredCount
      checkedInCount
      # Whether the race is locked against further edits (#585) — gates
      # scheduling and result entry, and drives the header's "Locked" badge.
      isLocked
      # One interleaved running order across racing groups (#549) — the flag
      # ScheduleManagement reads to show the master order at all, and what
      # gates the whole execution flow's sort (runningOrder.ts).
      masterRunningOrder
      track {
        id
        laneCount
        timerType
        laneOutages
      }
      racingGroups {
        id
        name
      }
      racers {
        id
        firstName
        lastName
        carNumber
        racerImageUrl
      }
      heats {
        id
        heatNumber
        roundNumber
        roundId
        roundName
        # When this heat's result was last saved (#59) — the raw material
        # pace.ts learns this race's own turnaround time from (#591).
        recordedAt
        lanes {
          lane
          racerId
          placeholderSlot
          time
          place
          skipped
        }
      }
      rounds {
        id
        roundNumber
        name
        advancementSource
        advancementFromBottom
        schedulingStrategy
        # Which racing group this round belongs to, if any (#549 stage 4) —
        # what labels a heat in the master running order view. Resolved to a
        # name client-side against race.racingGroups, which the query
        # already fetches.
        racingGroupId
        advancementStatus {
          isReady
          requiresAdvancement
          alreadyAdvanced
          fieldIsStale
          contestedCut
          source
          numRacers
          fromBottom
          advancingRacers {
            racerId
            firstName
            lastName
            carNumber
            racingGroupName
            score
            rank
            isAdvancing
          }
        }
      }
    }
  }
`;

export const CREATE_ROUND_MUTATION = gql`
  mutation CreateRound($raceId: Int!, $roundData: RoundCreateInput!) {
    createRound(raceId: $raceId, roundData: $roundData) {
      id
    }
  }
`;

export const REGENERATE_ROUND_MUTATION = gql`
  mutation RegenerateRound($roundId: Int!) {
    regenerateRound(roundId: $roundId) {
      id
    }
  }
`;

export const DELETE_ROUND_MUTATION = gql`
  mutation DeleteRound($roundId: Int!) {
    deleteRound(roundId: $roundId)
  }
`;

export const DELETE_HEAT_MUTATION = gql`
  mutation DeleteHeat($heatId: Int!) {
    deleteHeat(heatId: $heatId)
  }
`;

export const REORDER_HEATS_MUTATION = gql`
  mutation ReorderHeats($heatUpdates: [HeatReorderItemInput!]!) {
    reorderHeats(heatUpdates: $heatUpdates) {
      updatedCount
    }
  }
`;

// Interleaves the race's current rounds into one running order across
// racing groups (#549 stage 4). Writes through the same door reorderHeats
// uses, so nothing here decides what changed — the schedule refetch after
// the mutation is what shows the result, the same as a drag-and-drop reorder.
export const APPLY_MASTER_RUNNING_ORDER_MUTATION = gql`
  mutation ApplyMasterRunningOrder($raceId: Int!) {
    applyMasterRunningOrder(raceId: $raceId) {
      updatedCount
    }
  }
`;

export const UPDATE_HEAT_RESULT_MUTATION = gql`
  mutation UpdateHeatResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
    updateHeatResult(heatId: $heatId, lanes: $lanes) {
      id
    }
  }
`;

export const UPDATE_RACE_AUTO_ADVANCE_MUTATION = gql`
  mutation UpdateRaceAutoAdvance($id: Int!, $race: RaceUpdateInput!) {
    updateRace(id: $id, race: $race) {
      id
      autoAdvanceHeat
    }
  }
`;

// Run-off heats (#550): settling a tie without joining the score that
// produced it. `settlesRoundId` must match the standings view the tie was
// spotted on — `null` for the race's own overall (prelim-scoped) standings,
// a round id for that round's own — the same scope `Race.leaderboard`'s
// `roundId` argument already carries; see `RunOffControl.tsx`.
export const CREATE_RUN_OFF_HEAT_MUTATION = gql`
  mutation CreateRunOffHeat(
    $raceId: Int!
    $racerIds: [Int!]!
    $settlesRoundId: Int
  ) {
    createRunOffHeat(
      raceId: $raceId
      racerIds: $racerIds
      settlesRoundId: $settlesRoundId
    ) {
      id
      settlesRoundId
      recorded
      placement
      lanes {
        lane
        racerId
      }
    }
  }
`;

export const DELETE_RUN_OFF_HEAT_MUTATION = gql`
  mutation DeleteRunOffHeat($heatId: Int!) {
    deleteRunOffHeat(heatId: $heatId)
  }
`;

// The run-off heats a race currently holds, for the standings and schedule
// screens to filter by their own `settlesRoundId` and show what applies to
// them — see `RunOffControl.tsx`.
export const GET_RUN_OFF_HEATS = gql`
  query GetRunOffHeats($raceId: Int!) {
    race(raceId: $raceId) {
      id
      # Whether the race is locked against further edits (#585) — disables
      # the run-off control's own buttons.
      isLocked
      runOffHeats {
        id
        settlesRoundId
        recorded
        placement
        lanes {
          lane
          racerId
        }
      }
    }
  }
`;

// Intermissions (#592). All five mutations return the whole `Race` so the
// caller has the freshly resolved `intermission` with no follow-up query; the
// same fields also arrive on `raceStateChanged`'s `intermission` payload for
// a screen that only holds the subscription (see `Observation.tsx`).
export const START_INTERMISSION_MUTATION = gql`
  mutation StartIntermission($raceId: Int!, $durationSeconds: Int!, $label: String) {
    startIntermission(
      raceId: $raceId
      durationSeconds: $durationSeconds
      label: $label
    ) {
      id
      intermission {
        active
        remainingSeconds
        paused
        label
        endsAt
      }
    }
  }
`;

export const EXTEND_INTERMISSION_MUTATION = gql`
  mutation ExtendIntermission($raceId: Int!, $seconds: Int!) {
    extendIntermission(raceId: $raceId, seconds: $seconds) {
      id
      intermission {
        active
        remainingSeconds
        paused
        label
        endsAt
      }
    }
  }
`;

export const PAUSE_INTERMISSION_MUTATION = gql`
  mutation PauseIntermission($raceId: Int!) {
    pauseIntermission(raceId: $raceId) {
      id
      intermission {
        active
        remainingSeconds
        paused
        label
        endsAt
      }
    }
  }
`;

export const RESUME_INTERMISSION_MUTATION = gql`
  mutation ResumeIntermission($raceId: Int!) {
    resumeIntermission(raceId: $raceId) {
      id
      intermission {
        active
        remainingSeconds
        paused
        label
        endsAt
      }
    }
  }
`;

export const END_INTERMISSION_MUTATION = gql`
  mutation EndIntermission($raceId: Int!) {
    endIntermission(raceId: $raceId) {
      id
      intermission {
        active
        remainingSeconds
        paused
        label
        endsAt
      }
    }
  }
`;

// The control on Race Control's Displays tab reads the race's current
// intermission this way rather than waiting on a `raceStateChanged` event —
// it needs to render correctly on first load too (an operator who reloads
// mid-break).
export const GET_RACE_INTERMISSION = gql`
  query GetRaceIntermission($raceId: Int!) {
    race(raceId: $raceId) {
      id
      intermission {
        active
        remainingSeconds
        paused
        label
        endsAt
      }
    }
  }
`;
