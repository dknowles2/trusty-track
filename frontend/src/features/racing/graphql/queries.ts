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
