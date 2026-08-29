import React from 'react';
import { Icon } from '@mdi/react';
import { mdiUsb, mdiAlertCircle, mdiCheckCircle } from '@mdi/js';
import { useSerialProxy } from '../../../context/SerialProxyContext';
import './SerialProxyConnector.css';

interface SerialProxyConnectorProps {
  trackId: number;
}

export const SerialProxyConnector: React.FC<SerialProxyConnectorProps> = ({ trackId }) => {
  const { status, errorMsg, connect, isSupported } = useSerialProxy();

  const handleConnect = () => {
    connect(trackId);
  };

  if (!isSupported) {
    return (
      <div className="proxy-connector-unsupported">
        <Icon path={mdiAlertCircle} size={1} color="var(--danger-accent-color)" />
        <span>Web Serial not supported. Use Chrome or Edge.</span>
      </div>
    );
  }

  if (status === 'connected') {
    return (
      <div className="proxy-connector-status connected">
        <Icon path={mdiCheckCircle} size={0.8} color="var(--success-accent-color)" />
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
        onClick={handleConnect}
        disabled={status === 'connecting'}
      >
        <Icon path={mdiUsb} size={0.8} />
        {status === 'connecting' ? 'Connecting...' : 'Connect Hardware Timer'}
      </button>
    </div>
  );
};
