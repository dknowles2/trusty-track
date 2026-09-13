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

/**
 * Live's own front-page poll (#1078) — same fields and arguments as
 * `ACTIVITY_LOG_QUERY`, but its own operation name so it hashes to a
 * different urql operation key. Without that, an imperative `client.query`
 * call sharing the visible page's own `{raceId, limit, beforeId: null}`
 * variables would push its result straight into that `useQuery` too (urql
 * shares results across identical operations) and bypass the "hold new
 * entries until asked for" buffering `activityLive.ts` exists to do.
 */
export const ACTIVITY_LOG_LIVE_QUERY = gql`
  query ActivityLogLive($raceId: Int, $limit: Int!, $beforeId: Int) {
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
