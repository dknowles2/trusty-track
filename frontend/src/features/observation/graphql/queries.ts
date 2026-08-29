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
      denRank
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
      recordedAt
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
      recordBreak {
        newSeconds
        newHolder
        previousSeconds
        previousHolder
        previousRaceName
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
      slideSeq
      slideDelta
      identifySeq
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
      slideSeq
      slideDelta
      identifySeq
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
      slideSeq
      slideDelta
      identifySeq
    }
  }
`;

/**
 * Whether this race has any awards, for the operator's list of screens.
 *
 * Only the count matters — the ceremony is offered as a view for a screen
 * once there is something to announce. Asked for separately rather than
 * added to the Race Control query it sits inside: the panel is the only
 * thing that wants it, and it is re-read every time that tab is opened,
 * which is what makes an award added a minute ago show up here.
 */
export const RACE_AWARD_COUNT_QUERY = gql`
  query RaceAwardCount($raceId: Int!) {
    race(raceId: $raceId) {
      id
      awards {
        id
      }
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

export const ADVANCE_DISPLAY = gql`
  mutation AdvanceDisplay($displayId: String!, $delta: Int!) {
    advanceDisplay(displayId: $displayId, delta: $delta) {
      displayId
      slideSeq
      slideDelta
    }
  }
`;

/**
 * Ask a display to flash its own name (#495) — the operator's row-level
 * "which screen is this" button. A step, not a state: `identifySeq` is what
 * the screen compares itself against, the same shape as `ADVANCE_DISPLAY`.
 */
export const IDENTIFY_DISPLAY = gql`
  mutation IdentifyDisplay($displayId: String!) {
    identifyDisplay(displayId: $displayId) {
      displayId
      identifySeq
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
      slideSeq
      slideDelta
      identifySeq
    }
  }
`;

export const FORGET_DISPLAY = gql`
  mutation ForgetDisplay($displayId: String!) {
    forgetDisplay(displayId: $displayId)
  }
`;
