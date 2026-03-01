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
