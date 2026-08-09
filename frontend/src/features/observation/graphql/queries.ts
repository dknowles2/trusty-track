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

/**
 * What this screen should show (#174).
 *
 * Subscribing is also how the display registers: it holds no PIN and is a
 * VIEWER, so it can make no mutation — and the display is the thing being
 * told, not the thing asking.
 */
export const DisplayAssignmentSubscription = gql`
  subscription DisplayAssignment($displayId: String!, $raceId: Int!) {
    displayAssignment(displayId: $displayId, raceId: $raceId) {
      displayId
      name
      view
      cycleSeconds
      description
      pacedByAPerson
      connected
      assigned
      raceId
    }
  }
`;

/** The operator's list of screens, updating as they come and go. */
export const DisplaysSubscription = gql`
  subscription Displays($raceId: Int!) {
    displays(raceId: $raceId) {
      displayId
      name
      view
      cycleSeconds
      description
      pacedByAPerson
      connected
      assigned
      raceId
    }
  }
`;

export const DISPLAYS_QUERY = gql`
  query GetDisplays($raceId: Int!) {
    displays(raceId: $raceId) {
      displayId
      name
      view
      cycleSeconds
      description
      pacedByAPerson
      connected
      assigned
      raceId
    }
  }
`;

export const ASSIGN_DISPLAY = gql`
  mutation AssignDisplay($displayId: String!, $view: DisplayView!, $cycleSeconds: Int) {
    assignDisplay(displayId: $displayId, view: $view, cycleSeconds: $cycleSeconds) {
      displayId
      view
      cycleSeconds
      description
      pacedByAPerson
      connected
      name
      raceId
    }
  }
`;

export const RENAME_DISPLAY = gql`
  mutation RenameDisplay($displayId: String!, $name: String!) {
    renameDisplay(displayId: $displayId, name: $name) {
      displayId
      name
      view
      cycleSeconds
      description
      pacedByAPerson
      connected
      assigned
      raceId
    }
  }
`;

export const FORGET_DISPLAY = gql`
  mutation ForgetDisplay($displayId: String!) {
    forgetDisplay(displayId: $displayId)
  }
`;
