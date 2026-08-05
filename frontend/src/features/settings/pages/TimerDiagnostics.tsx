/**
 * Is the timer talking?
 *
 * The serial log already existed, but only behind a panel on the race
 * execution screen — so answering "is my timer working" meant creating a
 * group, a track, a race, a round and a heat first. That is a lot of ceremony
 * for a question you want to ask once, on the kitchen table, the week before
 * the derby.
 *
 * This is that question on its own page. It adds no capability the backend did
 * not already have; it makes the capability reachable.
 */
import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useSubscription, useMutation } from 'urql';
import { gql } from 'urql';
import { buildDisplayLines } from '../../racing/serialLog';
import type { SerialLogEntry } from '../../racing/serialLog';
import { useAlert } from '../../../context/AlertContext';

const DIAGNOSTIC_TRACKS = gql`
  query DiagnosticTracks {
    tracks {
      id
      name
      timerType
      serialPort
      laneCount
    }
  }
`;

const DIAGNOSTIC_TIMER_STATUS = gql`
  subscription DiagnosticTimerStatus($trackId: Int!) {
    timerStatus(trackId: $trackId) {
      trackId
      status {
        state
        deviceName
        deviceProvenance
        port
        laneCount
        lastError
        serialLog {
          direction
          data
          timestamp
        }
      }
    }
  }
`;

const DIAGNOSTIC_RECONNECT = gql`
  mutation DiagnosticReconnectTimer($trackId: Int!) {
    reconnectTimer(trackId: $trackId)
  }
`;

const DIAGNOSTIC_RESET = gql`
  mutation DiagnosticResetTimer($trackId: Int!) {
    resetTimer(trackId: $trackId)
  }
`;

interface Track {
    id: number;
    name: string;
    timerType: string;
    serialPort: string | null;
    laneCount: number;
}

/**
 * What each state means, in the operator's terms rather than the protocol's.
 *
 * `CONNECTED` is called out deliberately. It means the port is open but the
 * device has not identified itself, and until #93 a perfectly healthy timer
 * could sit there all event — so an operator seeing it needs to know whether
 * to wait or to start unplugging things.
 */
const STATE_HELP: Record<string, { label: string; tone: string; detail: string }> = {
    DISCONNECTED: {
        label: 'Not connected',
        tone: '#9e9e9e',
        detail: 'No serial port is open. Check the cable, then press Connect.',
    },
    CONNECTED: {
        label: 'Port open, waiting for the timer to answer',
        tone: '#ff9800',
        detail:
            'The port opened but nothing has identified itself yet. The server keeps asking every ' +
            'few seconds. If this does not clear, the port is probably not the timer.',
    },
    IDLE: {
        label: 'Ready',
        tone: '#4caf50',
        detail: 'The timer answered and is waiting for a heat.',
    },
    ARMED: {
        label: 'Armed',
        tone: '#2196f3',
        detail: 'Lanes have been set and the timer is waiting for the start gate.',
    },
    READY: {
        label: 'Staged',
        tone: '#2196f3',
        detail: 'The start gate is closed with cars behind it.',
    },
    RUNNING: {
        label: 'Racing',
        tone: '#673ab7',
        detail: 'The gate has opened and the timer is counting.',
    },
    RESULTS_OVERDUE: {
        label: 'Results overdue',
        tone: '#f44336',
        detail:
            'The race started but the finish was never reported. Force the results from the race ' +
            'screen, or check the finish-line sensors.',
    },
    FAULT: {
        label: 'Fault',
        tone: '#f44336',
        detail: 'The serial connection failed. The error is shown below.',
    },
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function renderData(data: string): React.ReactNode {
    return data.split(/(\\r\\n|\\r|\\n)/).map((part, i) => {
        if (part === '\\r\\n' || part === '\\n') {
            return (
                <React.Fragment key={i}>
                    <span style={{ color: '#bbb' }}>{part}</span>
                    <br />
                </React.Fragment>
            );
        }
        if (part === '\\r') {
            return <span key={i} style={{ color: '#bbb' }}>{part}</span>;
        }
        return <span key={i}>{part}</span>;
    });
}

const TrackTimer: React.FC<{ track: Track }> = ({ track }) => {
    const { showAlert } = useAlert();
    const logEndRef = useRef<HTMLDivElement>(null);
    const [, reconnect] = useMutation(DIAGNOSTIC_RECONNECT);
    const [, reset] = useMutation(DIAGNOSTIC_RESET);

    const [result] = useSubscription({
        query: DIAGNOSTIC_TIMER_STATUS,
        variables: { trackId: track.id },
    });

    const status = result.data?.timerStatus?.status;
    const state: string = status?.state ?? 'DISCONNECTED';
    const serialLog: SerialLogEntry[] = status?.serialLog ?? [];
    const help = STATE_HELP[state] ?? {
        label: state,
        tone: '#9e9e9e',
        detail: '',
    };

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [serialLog.length]);

    const run = async (fn: typeof reconnect, what: string) => {
        const outcome = await fn({ trackId: track.id });
        if (outcome.error) {
            showAlert(outcome.error.message || `Could not ${what}.`, 'Error');
        }
    };

    const isFake = track.timerType === 'FAKE';
    const lines = buildDisplayLines(serialLog);

    return (
        <section
            style={{
                border: `2px solid ${help.tone}`,
                borderRadius: '12px',
                padding: '1rem 1.25rem',
                marginBottom: '1.5rem',
                background: 'white',
            }}
        >
            <header style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{track.name}</h2>
                <span style={{ color: help.tone, fontWeight: 600 }}>{help.label}</span>
                <span style={{ marginLeft: 'auto', color: '#666', fontSize: '0.85rem' }}>
                    {track.laneCount} lanes
                </span>
            </header>

            {help.detail && (
                <p style={{ margin: '0.5rem 0 0.75rem', color: '#555', fontSize: '0.9rem' }}>
                    {help.detail}
                </p>
            )}

            <dl
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'max-content 1fr',
                    gap: '0.25rem 1rem',
                    margin: '0 0 0.75rem',
                    fontSize: '0.9rem',
                }}
            >
                <dt style={{ color: '#666' }}>Connection</dt>
                <dd style={{ margin: 0 }}>
                    {isFake
                        ? 'Fake timer (no hardware)'
                        : track.timerType === 'AUTO_DETECT_BACKEND'
                          ? 'Plugged into this server'
                          : 'Plugged into the browser'}
                </dd>

                <dt style={{ color: '#666' }}>Device</dt>
                <dd style={{ margin: 0 }}>{status?.deviceName ?? 'unknown'}</dd>

                <dt style={{ color: '#666' }}>Port</dt>
                <dd style={{ margin: 0, fontFamily: MONO }}>
                    {status?.port ?? (track.serialPort || 'none yet')}
                    {!track.serialPort && status?.port && (
                        <span style={{ fontFamily: 'inherit', color: '#4caf50', marginLeft: '0.5rem' }}>
                            found automatically
                        </span>
                    )}
                </dd>
            </dl>

            {/*
              Most device descriptions are adapted from DerbyNet and have never
              been run against the hardware they describe. Saying so where the
              operator can see it beats letting a name imply support.
            */}
            {status?.deviceProvenance && (
                <p
                    style={{
                        background: '#fff8e1',
                        border: '1px solid #ffe082',
                        borderRadius: '8px',
                        padding: '0.5rem 0.75rem',
                        margin: '0 0 0.75rem',
                        fontSize: '0.85rem',
                        color: '#5d4037',
                    }}
                >
                    {status.deviceProvenance}
                </p>
            )}

            {status?.lastError && (
                <p
                    style={{
                        background: '#fdecea',
                        border: '1px solid #f5c6c3',
                        borderRadius: '8px',
                        padding: '0.5rem 0.75rem',
                        margin: '0 0 0.75rem',
                        fontSize: '0.9rem',
                    }}
                >
                    {status.lastError}
                </p>
            )}

            {!isFake && (
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    {track.timerType === 'AUTO_DETECT_BACKEND' && (
                        <button type="button" onClick={() => run(reconnect, 'connect')}>
                            {track.serialPort ? 'Connect' : 'Search for the timer'}
                        </button>
                    )}
                    <button type="button" onClick={() => run(reset, 'reset the timer')}>
                        Reset
                    </button>
                </div>
            )}

            {isFake ? (
                <p style={{ color: '#666', fontSize: '0.9rem', margin: 0 }}>
                    This track is set to the fake timer, so there is no hardware to check. Change it
                    on the <Link to="/system-settings">System Settings</Link> page.
                </p>
            ) : (
                <div>
                    <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.4rem', color: '#666' }}>
                        Serial traffic
                    </h3>
                    <div
                        style={{
                            background: '#1e1e1e',
                            color: '#dcdcdc',
                            fontFamily: MONO,
                            fontSize: '0.78rem',
                            borderRadius: '8px',
                            padding: '0.6rem 0.75rem',
                            maxHeight: '260px',
                            overflowY: 'auto',
                        }}
                    >
                        {lines.length === 0 ? (
                            <span style={{ color: '#888' }}>Nothing yet.</span>
                        ) : (
                            lines.map((line, i) => (
                                <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
                                    <span
                                        style={{
                                            color: line.direction === 'TX' ? '#6fbcff' : '#a6e22e',
                                        }}
                                    >
                                        {line.direction === 'TX' ? '→ ' : '← '}
                                    </span>
                                    {renderData(line.data)}
                                    {line.description && (
                                        <span style={{ color: '#888' }}> {line.description}</span>
                                    )}
                                </div>
                            ))
                        )}
                        <div ref={logEndRef} />
                    </div>
                </div>
            )}
        </section>
    );
};

const TimerDiagnostics: React.FC = () => {
    const [{ data, fetching, error }] = useQuery({ query: DIAGNOSTIC_TRACKS });
    const tracks: Track[] = data?.tracks ?? [];

    return (
        <div style={{ padding: '1.5rem', maxWidth: '820px', margin: '0 auto' }}>
            <h1 style={{ marginTop: 0 }}>Timer check</h1>
            <p style={{ color: '#555' }}>
                Live view of every track's timer. Use this before the event to confirm the timer is
                plugged in and talking, without setting up a race first.
            </p>

            {fetching && <p>Loading…</p>}
            {error && <p style={{ color: '#c00' }}>{error.message}</p>}
            {!fetching && tracks.length === 0 && (
                <p>
                    No tracks are configured yet. Add one on the{' '}
                    <Link to="/system-settings">System Settings</Link> page.
                </p>
            )}

            {tracks.map(track => (
                <TrackTimer key={track.id} track={track} />
            ))}

            <p style={{ fontSize: '0.9rem' }}>
                <Link to="/system-settings">Back to System Settings</Link>
            </p>
        </div>
    );
};

export default TimerDiagnostics;
