import { gql } from 'urql';

/**
 * Only what a card shows. The roster query next door also pulls the
 * leaderboard and the schedule, and a print page that waits on those is a
 * print page the operator waits on with sixty scouts in the room.
 */
export const GET_PRINTABLES = gql`
  query GetPrintables($raceId: Int!) {
    initialConfig {
      printablesTheme
    }
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      resolvedNameDisplay
      racingGroups {
        id
        name
        color
      }
      racers {
        id
        firstName
        lastName
        carNumber
        carName
        carWeight
        racingGroupId
        racerImageUrl
      }
    }
  }
`;

/**
 * The running order, for the printed heat sheet (#173).
 *
 * Heats and their lanes rather than the roster's cards, plus the track's lane
 * count so every row has the same columns. `tracks` is a separate root field,
 * which is why it is here rather than under `race`.
 *
 * `masterRunningOrder` and `runOffHeats` are #890: without them the printed
 * sheet cannot follow the same running order the operator's Race tab and the
 * wall displays actually execute, or print a run-off heat at all.
 */
export const GET_HEAT_SHEET = gql`
  query GetHeatSheet($raceId: Int!) {
    initialConfig {
      printablesTheme
    }
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      trackId
      resolvedNameDisplay
      masterRunningOrder
      rounds {
        id
        name
        roundNumber
        advancementSource
      }
      heats {
        id
        heatNumber
        roundId
        lanes {
          lane
          racerId
          placeholderSlot
        }
      }
      runOffHeats {
        id
        settlesRoundId
        placement
        lanes {
          lane
          racerId
          placeholderSlot
        }
      }
      racers {
        id
        firstName
        lastName
        carNumber
      }
    }
    tracks {
      id
      laneCount
      # This track's configured lane colours — a small swatch beside
      # each lane header, so the announcer's printed table matches the
      # colour painted on the track in front of them. Empty when nobody has
      # opened the picker on the track's card.
      laneColors
    }
  }
`;

/**
 * The results, once the racing is over (#206).
 *
 * The standings are the preliminary ones by default, which is what #17
 * settled — a championship's placings are a consequence of these, not part of
 * them, so `leaderboard` here stays unscoped (prelim only). `rounds` is #869:
 * the page reads it to find which round(s) are championship rounds and, for
 * any that have been raced, fetches that round's own placings separately —
 * see `championshipResultsQuery` below, since a round's id is not known
 * until this query has already answered.
 */
export const GET_RESULTS_SHEET = gql`
  query GetResultsSheet($raceId: Int!) {
    initialConfig {
      printablesTheme
    }
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      scoringStrategy
      resolvedNameDisplay
      rounds {
        id
        name
        roundNumber
        advancementSource
      }
      leaderboard {
        racerId
        rank
        firstName
        lastName
        carNumber
        racingGroupName
        score
        heatsCompleted
      }
      racers {
        id
        excludedFromStandings
      }
      awards {
        id
        name
        kind
        sortOrder
        recipient {
          id
          firstName
          lastName
          carNumber
        }
      }
    }
  }
`;

/**
 * One championship round's own placings, per round id (#869) — built
 * dynamically because a round's id is only known once `GET_RESULTS_SHEET`
 * has answered, and `Race.leaderboard`'s `roundId` argument cannot be a
 * GraphQL variable for a set of ids not known in advance. Aliased so several
 * chained championship rounds are one round trip rather than one query per
 * round.
 *
 * A plain string rather than the `gql` tag, like `Leaderboard.tsx`'s own
 * round-scoped query: codegen types documents statically, and there is no
 * static document here to type — the round ids are runtime data.
 */
export function championshipResultsQuery(roundIds: readonly number[]): string {
  const fields = roundIds
    .map(
      (roundId) => `round${roundId}: leaderboard(roundId: ${roundId}) {
        racerId
        rank
        firstName
        lastName
        carNumber
        score
        heatsCompleted
      }`,
    )
    .join('\n');
  return `
    query GetChampionshipResults($raceId: Int!) {
      race(raceId: $raceId) {
        id
        ${fields}
      }
    }
  `;
}

/**
 * One certificate per award (#306).
 *
 * Only what a certificate shows — no leaderboard, no schedule. `artworkKey` is
 * what tells the page whether to draw a ready-made superlative's clipart or a
 * plain certificate.
 */
export const GET_CERTIFICATES = gql`
  query GetCertificates($raceId: Int!) {
    initialConfig {
      printablesTheme
    }
    race(raceId: $raceId) {
      id
      name
      dateTime
      location
      resolvedNameDisplay
      awards {
        id
        name
        kind
        sortOrder
        artworkKey
        recipient {
          id
          firstName
          lastName
          carNumber
        }
      }
    }
  }
`;
