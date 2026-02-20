import { gql } from 'urql';

export const LeaderboardSubscription = gql`
  subscription LeaderboardSubscription($raceId: Int!) {
    leaderboard(raceId: $raceId) {
      racerId
      firstName
      lastName
      carNumber
      denId
      denName
      score
      heatsCompleted
      racerImageUrl
      rank
    }
  }
`;

export const OnDeckSubscription = gql`
  subscription OnDeckSubscription($raceId: Int!) {
    onDeck(raceId: $raceId) {
      id
      firstName
      lastName
      carNumber
      racerImageUrl
    }
  }
`;

export const CurrentlyRacingSubscription = gql`
  subscription CurrentlyRacingSubscription($raceId: Int!) {
    currentlyRacing(raceId: $raceId) {
      id
      heatNumber
      roundNumber
      roundName
      laneResults
    }
  }
`;

export const TimingStatsSubscription = gql`
  subscription TimingStatsSubscription($raceId: Int!) {
    timingStats(raceId: $raceId) {
      heatId
      roundName
      heatNumber
      lanes {
        laneNumber
        racerName
        carName
        time
        place
      }
    }
  }
`;

export const ActiveFreeRaceHeatSubscription = gql`
  subscription ActiveFreeRaceHeatSubscription($raceId: Int!) {
    activeFreeRaceHeat(raceId: $raceId) {
      id
      laneAssignments
      laneResults
      createdAt
    }
  }
`;
