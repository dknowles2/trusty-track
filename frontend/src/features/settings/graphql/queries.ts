import { gql } from 'urql';

/**
 * The activity timeline (#219).
 *
 * `sourceIp` is asked for by name rather than being folded into the row,
 * because the page does not show it by default: an address against every line
 * is noise until the one evening somebody needs to know which device did
 * something.
 */
export const ACTIVITY_LOG_QUERY = gql`
  query ActivityLog($raceId: Int, $limit: Int!, $beforeId: Int) {
    auditLog(raceId: $raceId, limit: $limit, beforeId: $beforeId) {
      id
      at
      action
      role
      outcome
      summary
      noteworthy
      raceId
      sourceIp
      details
    }
  }
`;
