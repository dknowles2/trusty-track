import { useSubscription } from 'urql';

const TIMER_STATUS_SUBSCRIPTION = `
  subscription OnTimerStatus($trackId: Int!) {
    timerStatus(trackId: $trackId) {
      status {
        state
        lastError
      }
    }
  }
`;

interface TimerStatusBadgeProps {
  trackId: number;
}

export default function TimerStatusBadge({ trackId }: TimerStatusBadgeProps) {
  const [result] = useSubscription({
    query: TIMER_STATUS_SUBSCRIPTION,
    variables: { trackId }
  });

  const status = result.data?.timerStatus?.status;
  const state = status?.state || 'UNKNOWN';
  const error = status?.lastError;

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'IDLE': return '#4CAF50'; // Green
      case 'ARMED': return '#FF9800'; // Orange
      case 'RUNNING': return '#2196F3'; // Blue
      case 'FAULT': return '#F44336'; // Red
      case 'DISCONNECTED': return '#9E9E9E'; // Grey
      case 'CONNECTED': return '#8BC34A'; // Light Green
      default: return '#757575';
    }
  };

  return (
    <div className="timer-status-badge" style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.25rem 0.75rem',
      borderRadius: '20px',
      backgroundColor: getStatusColor(state),
      color: 'white',
      fontSize: '0.8rem',
      fontWeight: 'bold',
      textTransform: 'uppercase',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      transition: 'all 0.3s ease'
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: 'rgba(255,255,255,0.8)',
        display: state === 'RUNNING' || state === 'ARMED' ? 'inline-block' : 'none',
        animation: 'pulse 1.5s infinite'
      }} />
      {state}
      {error && state === 'FAULT' && (
        <span title={error} style={{ marginLeft: '4px', cursor: 'help' }}>⚠️</span>
      )}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.95); opacity: 0.9; }
          70% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}
