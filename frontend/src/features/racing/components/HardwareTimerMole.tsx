import React, { useState, useRef, useEffect } from 'react';
import Icon from '@mdi/react';
import { mdiUsb, mdiChevronUp, mdiChevronDown } from '@mdi/js';
import { useSubscription, useMutation } from 'urql';
import { TIMER_STATUS_SUBSCRIPTION, RECONNECT_TIMER } from '../graphql/queries';
import { useAlert } from '../../../context/AlertContext';

interface SerialLogEntry {
    direction: string;
    data: string;
    timestamp: string;
}

interface DisplayLine {
    direction: string;
    data: string;
}

// Group raw serial log entries into display lines, flushing on \n or \r\n
// (_format_serial_bytes emits these as the literal two-char sequences \n and \r\n).
function buildDisplayLines(entries: SerialLogEntry[]): DisplayLine[] {
    const lines: DisplayLine[] = [];
    let currentDir = '';
    let currentData = '';

    const flush = () => {
        if (currentDir) lines.push({ direction: currentDir, data: currentData });
        currentData = '';
    };

    for (const entry of entries) {
        if (entry.direction !== currentDir) {
            flush();
            currentDir = entry.direction;
        }
        // Split on literal \r\n, \r, \n sequences, keeping the delimiter in each part
        // We match literal backslash followed by r or n.
        const parts = entry.data.split(/(\\\\r\\\\n|\\\\n)/);
        for (const part of parts) {
            currentData += part;
            if (part === '\\r\\n' || part === '\\n') flush();
        }
    }

    if (currentData) flush();
    return lines;
}

function renderData(data: string): React.ReactNode {
    return data.split(/(\\\\r\\\\n|\\\\r|\\\\n)/).map((part, i) =>
        part === '\\r\\n' || part === '\\r' || part === '\\n'
            ? <span key={i} style={{ color: '#bbb' }}>{part}</span>
            : <span key={i}>{part}</span>
    );
}

interface HardwareTimerMoleProps {
    trackId: number;
    timerType?: string | null;
}

export const HardwareTimerMole: React.FC<HardwareTimerMoleProps> = ({ trackId, timerType }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const logEndRef = useRef<HTMLDivElement>(null);
    const { showAlert } = useAlert();
    const [, reconnectTimer] = useMutation(RECONNECT_TIMER);

    const [subResult] = useSubscription({
        query: TIMER_STATUS_SUBSCRIPTION,
        variables: { trackId },
        pause: !trackId,
    });

    const timerState: string = subResult.data?.timerStatus?.status?.state ?? 'DISCONNECTED';
    const serialLog: SerialLogEntry[] = subResult.data?.timerStatus?.status?.serialLog ?? [];

    useEffect(() => {
        if (isExpanded && logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [serialLog.length, isExpanded]);

    const isDisconnected = ['DISCONNECTED', 'FAULT'].includes(timerState);
    const isConnected = !isDisconnected;
    const borderColor = isConnected ? '#2196f3' : '#9e9e9e';
    const showConnectButton = isDisconnected && timerType === 'AUTO_DETECT_BACKEND';

    const handleConnect = async () => {
        const result = await reconnectTimer({ trackId });
        if (result.error) {
            showAlert(result.error.message || 'Failed to connect.', 'Error');
        }
    };

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '30px',
                right: '30px',
                background: 'white',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 5px 20px rgba(0,0,0,0.2)',
                zIndex: 1000,
                minWidth: '260px',
                maxWidth: '420px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                border: `2px solid ${borderColor}`,
            }}
        >
            <h3
                onClick={() => setIsExpanded(prev => !prev)}
                style={{ margin: '0 0 5px 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
            >
                <Icon path={mdiUsb} size={0.9} color={borderColor} />
                Hardware Timer
                <span style={{ flex: 1 }} />
                <span style={{
                    fontSize: '0.72rem',
                    color: borderColor,
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                }}>
                    {timerState}
                </span>
                <Icon path={isExpanded ? mdiChevronDown : mdiChevronUp} size={0.7} color="#666" />
            </h3>

            {showConnectButton && (
                <button
                    onClick={handleConnect}
                    style={{
                        width: '100%',
                        padding: '10px',
                        background: '#e0e0e0',
                        border: 'none',
                        borderRadius: '4px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                    }}
                >
                    Connect
                </button>
            )}

            {/* Serial log */}
            {isExpanded && (
                <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                    {serialLog.length === 0 ? (
                        <div style={{ color: '#999', fontSize: '0.8rem', fontStyle: 'italic' }}>
                            No serial data yet.
                        </div>
                    ) : (
                        <div style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                            {buildDisplayLines(serialLog).map((line, i) => (
                                <div
                                    key={i}
                                    style={{
                                        padding: '2px 4px 2px 8px',
                                        display: 'flex',
                                        gap: '8px',
                                        alignItems: 'baseline',
                                        borderLeft: `3px solid ${line.direction === 'RX' ? '#4caf50' : '#2196f3'}`,
                                        marginBottom: '1px',
                                    }}
                                >
                                    <span style={{
                                        color: line.direction === 'RX' ? '#4caf50' : '#2196f3',
                                        fontWeight: 'bold',
                                        minWidth: '22px',
                                        fontSize: '0.7rem',
                                    }}>
                                        {line.direction}
                                    </span>
                                    <span style={{ color: '#333', wordBreak: 'break-all' }}>
                                        {renderData(line.data)}
                                    </span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
