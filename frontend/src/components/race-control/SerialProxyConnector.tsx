import React, { useState, useEffect, useRef } from 'react';
import Icon from '@mdi/react';
import { mdiUsb, mdiAlertCircle, mdiCheckCircle } from '@mdi/js';
import './SerialProxyConnector.css';

interface SerialProxyConnectorProps {
  trackId: number;
}

export const SerialProxyConnector: React.FC<SerialProxyConnectorProps> = ({ trackId }) => {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const portRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const isSupported = 'serial' in navigator;

  const connect = async () => {
    if (!isSupported) return;

    try {
      setStatus('connecting');
      setErrorMsg(null);

      // 1. Request port (shows browser dialog)
      const port = await (navigator as any).serial.requestPort();

      // 2. Open WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws/timer/${trackId}`;
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
      };

      ws.onerror = () => {
        setErrorMsg('WebSocket connection failed');
        setStatus('error');
      };

    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        setStatus('disconnected');
      } else {
        setErrorMsg(err.message || 'Connection failed');
        setStatus('error');
      }
    }
  };

  const startReading = async (port: any, ws: WebSocket) => {
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
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      portRef.current?.close();
    };
  }, []);

  if (!isSupported) {
    return (
      <div className="proxy-connector-unsupported">
        <Icon path={mdiAlertCircle} size={1} color="#f44336" />
        <span>Web Serial not supported. Use Chrome or Edge.</span>
      </div>
    );
  }

  if (status === 'connected') {
    return (
      <div className="proxy-connector-status connected">
        <Icon path={mdiCheckCircle} size={0.8} color="#4caf50" />
        <span>Hardware Timer Proxy Active</span>
      </div>
    );
  }

  return (
    <div className="proxy-connector-container">
      {status === 'error' && (
        <div className="proxy-connector-error">
          <Icon path={mdiAlertCircle} size={0.8} />
          <span>{errorMsg}</span>
        </div>
      )}
      <button
        className="proxy-connect-btn"
        onClick={connect}
        disabled={status === 'connecting'}
      >
        <Icon path={mdiUsb} size={0.8} />
        {status === 'connecting' ? 'Connecting...' : 'Connect Hardware Timer'}
      </button>
    </div>
  );
};
