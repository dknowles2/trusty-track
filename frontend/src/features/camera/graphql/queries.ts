import { gql } from 'urql';

/**
 * A cheap round trip for measuring the WebSocket... no — the *HTTP* round
 * trip to this backend (#177 stage 1b's sync method). The clip boundary
 * math wants "half the RTT" as a correction on top of the server's own
 * `TimerStatus.transitions[].at`; `version` is the smallest query in the
 * schema and answers from no database row at all, so timing it is timing
 * the network hop and (near enough) nothing else.
 */
export const CAMERA_PING_QUERY = gql`
  query CameraPing {
    version
  }
`;
