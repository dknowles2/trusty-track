import { useSubscription } from 'urql';
import { TIMER_STATUS_SUBSCRIPTION } from '../graphql/queries';
import './TimerStatusBadge.css';

interface TimerStatusBadgeProps {
  trackId: number;
}

interface TimerStatusData {
  timerStatus: {
    status: {
      state: string;
      deviceName: string | null;
      activeHeatId: number | null;
      lastError: string | null;
    };
  };
}

function getStatusDisplay(state: string | undefined): { colorClass: string; label: string } {
  switch (state) {
    case 'CONNECTED':
      return { colorClass: 'yellow', label: 'Timer: Connecting…' };
    case 'IDLE':
      return { colorClass: 'green', label: 'Timer: Ready' };
    // ARMED means the lane mask has been sent. READY means the timer has also
    // told us the start gate is latched, which only devices that report the
    // gate can reach — so ARMED keeps the neutral label and READY is the extra
    // reassurance rather than the baseline.
    case 'ARMED':
      return { colorClass: 'blue', label: 'Timer: Staged' };
    case 'READY':
      return { colorClass: 'blue', label: 'Timer: Ready to race' };
    case 'RUNNING':
      return { colorClass: 'pulse', label: 'Timer: Racing…' };
    case 'RESULTS_OVERDUE':
      return { colorClass: 'red', label: 'Timer: Results overdue' };
    // FAULT is not the same claim as DISCONNECTED, and #764 is about the two
    // being run together. Since #342, a database write failure lands the
    // manager in FAULT with the port perfectly healthy — its own error text
    // says "the timer link is fine; enter the times with Override" — so a
    // label that says "disconnected" sends the operator to check a cable
    // that was never the problem. This gets its own word, and `lastError`
    // (already fetched below, never shown until now) goes on the badge as a
    // title so the actual reason — a locked database, or a real hardware
    // fault — is one hover away instead of invisible.
    case 'FAULT':
      return { colorClass: 'red', label: 'Timer: Needs attention' };
    case 'DISCONNECTED':
    default:
      return { colorClass: 'grey', label: 'Timer disconnected' };
  }
}

export function TimerStatusBadge({ trackId }: TimerStatusBadgeProps) {
  const [{ data }] = useSubscription<TimerStatusData>({
    query: TIMER_STATUS_SUBSCRIPTION,
    variables: { trackId },
  });

  const state = data?.timerStatus?.status?.state;
  const lastError = data?.timerStatus?.status?.lastError ?? null;
  const { colorClass, label } = getStatusDisplay(state);

  return (
    <span className="timer-status-badge" title={lastError ?? undefined}>
      <span className={`timer-status-dot timer-status-dot--${colorClass}`} />
      <span className="timer-status-label">{label}</span>
    </span>
  );
}
