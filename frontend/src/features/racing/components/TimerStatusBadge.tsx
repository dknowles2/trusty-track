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
      return { colorClass: 'yellow', label: 'Connecting\u2026' };
    case 'IDLE':
      return { colorClass: 'green', label: 'Ready' };
    // ARMED means the lane mask has been sent. READY means the timer has also
    // told us the start gate is latched, which only devices that report the
    // gate can reach — so ARMED keeps the neutral label and READY is the extra
    // reassurance rather than the baseline.
    case 'ARMED':
      return { colorClass: 'blue', label: 'Staged' };
    case 'READY':
      return { colorClass: 'blue', label: 'Ready to race' };
    case 'RUNNING':
      return { colorClass: 'pulse', label: 'Racing\u2026' };
    case 'RESULTS_OVERDUE':
      return { colorClass: 'red', label: 'Results overdue' };
    case 'DISCONNECTED':
    case 'FAULT':
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
  const { colorClass, label } = getStatusDisplay(state);

  return (
    <span className="timer-status-badge">
      <span className={`timer-status-dot timer-status-dot--${colorClass}`} />
      <span className="timer-status-label">{label}</span>
    </span>
  );
}
