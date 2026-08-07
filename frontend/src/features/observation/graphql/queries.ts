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
      heatNumber
      globalHeatNumber
      roundNumber
      roundName
      lanes {
        lane
        racerId
        placeholderSlot
      }
    }
  }
`;

export const CurrentlyRacingSubscription = gql`
  subscription CurrentlyRacingSubscription($raceId: Int!) {
    currentlyRacing(raceId: $raceId) {
      id
      heatNumber
      globalHeatNumber
      roundNumber
      roundName
      lanes {
        lane
        racerId
        placeholderSlot
      }
    }
  }
`;

export const TimingStatsSubscription = gql`
  subscription TimingStatsSubscription($raceId: Int!) {
    timingStats(raceId: $raceId) {
      heatId
      roundName
      heatNumber
      globalHeatNumber
      lanes {
        laneNumber
        racerName
        carName
        time
        place
        racerImageUrl
      }
    }
  }
`;

export const ActiveFreeRaceHeatSubscription = gql`
  subscription ActiveFreeRaceHeatSubscription($raceId: Int!) {
    activeFreeRaceHeat(raceId: $raceId) {
      id
      createdAt
      lanes {
        lane
        racerId
      }
    }
  }
`;
