import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface SerialProxyContextType {
    status: ConnectionStatus;
    errorMsg: string | null;
    activeTrackId: number | null;
    connect: (trackId: number) => Promise<void>;
    disconnect: () => void;
    isSupported: boolean;
}

const SerialProxyContext = createContext<SerialProxyContextType | undefined>(undefined);

export const SerialProxyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [activeTrackId, setActiveTrackId] = useState<number | null>(null);

    const portRef = useRef<any>(null);
    const wsRef = useRef<WebSocket | null>(null);

    const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

    const startReading = useCallback(async (port: any, ws: WebSocket) => {
        while (port.readable && ws.readyState === WebSocket.OPEN) {
            const reader = port.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const decoded = new TextDecoder().decode(value);
                    console.log('Serial PROXY RX:', decoded.replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
                    ws.send(JSON.stringify({
                        type: 'serial_rx',
                        data: btoa(String.fromCharCode(...value))
                    }));
                }
            } catch (err) {
                console.error('Serial read error:', err);
                break;
            } finally {
                reader.releaseLock();
            }
        }
    }, []);

    const disconnect = useCallback(() => {
        wsRef.current?.close();
        wsRef.current = null;
        portRef.current?.close();
        portRef.current = null;
        setStatus('disconnected');
        setActiveTrackId(null);
    }, []);

    const connect = useCallback(async (trackId: number) => {
        if (!isSupported) return;

        // If already connected to the same track, do nothing
        if (status === 'connected' && activeTrackId === trackId) return;

        // If connected to a different track, disconnect first
        if (status !== 'disconnected') {
            disconnect();
        }

        try {
            setStatus('connecting');
            setErrorMsg(null);
            setActiveTrackId(trackId);

            // 1. Request port (shows browser dialog)
            const port = await (navigator as any).serial.requestPort();

            // 2. Open WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws/timer/${trackId}`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('Handshake: Proxy WebSocket opened');
            };

            ws.onmessage = async (event) => {
                console.log('Handshake: Received message:', event.data);
                const msg = JSON.parse(event.data);
                if (msg.type === 'configure') {
                    try {
                        console.log('Handshake: Configuring port with baud rate:', msg.baud_rate);
                        await port.open({ baudRate: msg.baud_rate });
                        portRef.current = port;
                        console.log('Handshake: Port opened successfully, sending ready');
                        ws.send(JSON.stringify({ type: 'ready' }));
                        setStatus('connected');
                        startReading(port, ws);
                    } catch (err: any) {
                        setErrorMsg(`Port error: ${err.message}`);
                        setStatus('error');
                        ws.close();
                    }
                } else if (msg.type === 'serial_tx') {
                    if (port.writable) {
                        const writer = port.writable.getWriter();
                        const data = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
                        const decodedTx = new TextDecoder().decode(data);
                        console.log('Serial PROXY TX:', decodedTx.replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
                        await writer.write(data);
                        writer.releaseLock();
                    }
                }
            };

            ws.onclose = () => {
                setStatus('disconnected');
                portRef.current?.close();
                portRef.current = null;
                setActiveTrackId(null);
            };

            ws.onerror = () => {
                setErrorMsg('WebSocket connection failed');
                setStatus('error');
            };

        } catch (err: any) {
            if (err.name === 'NotFoundError') {
                setStatus('disconnected');
                setActiveTrackId(null);
            } else {
                setErrorMsg(err.message || 'Connection failed');
                setStatus('error');
            }
        }
    }, [isSupported, status, activeTrackId, disconnect, startReading]);

    // Clean up on app unmount
    useEffect(() => {
        return () => {
            wsRef.current?.close();
            portRef.current?.close();
        };
    }, []);

    return (
        <SerialProxyContext.Provider value={{ status, errorMsg, activeTrackId, connect, disconnect, isSupported }}>
            {children}
        </SerialProxyContext.Provider>
    );
};

export const useSerialProxy = () => {
    const context = useContext(SerialProxyContext);
    if (context === undefined) {
        throw new Error('useSerialProxy must be used within a SerialProxyProvider');
    }
    return context;
};
