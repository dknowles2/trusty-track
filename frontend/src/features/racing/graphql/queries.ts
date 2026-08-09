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
