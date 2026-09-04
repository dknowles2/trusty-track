import { gql } from 'urql';

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
        racerId firstName lastName carNumber racingGroupName
        heatsCompleted heatsScheduled minTime maxTime meanTime stdDev
        timesPerLane { lane avgTime }
      }
      highlights { type roundName heatNumber globalHeatNumber racerName time margin }
      racingGroupStats { racingGroupId racingGroupName racingGroupColor racerCount avgScore bestRacerName }
      heatResults { roundName heatNumber globalHeatNumber lane carNumber racerFirstName racerLastName time place }
      trackRecords { timeSeconds racerName carNumber raceId raceName raceDate }
      topScaleMph
    }
  }
`;
