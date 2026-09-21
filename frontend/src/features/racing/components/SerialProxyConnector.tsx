import React from 'react';
import { Icon } from '@mdi/react';
import { mdiUsb, mdiAlertCircle, mdiCheckCircle } from '@mdi/js';
import { useSerialProxy } from '../../../context/SerialProxyContext';
import './SerialProxyConnector.css';

interface SerialProxyConnectorProps {
  trackId: number;
  /**
   * Set for a row context — Timer check's action row, beside the bare
   * Reset button (#1299). The standalone shape (`.proxy-connector-container`,
   * a column) was built for the other three mount points, where the
   * connector stands alone as a block: there, `margin-bottom` gives it
   * breathing room and a bold, oversized button is fine. In a row with
   * `align-items: center` those same choices push the button 10px above
   * Reset's centre line and give it a different height and corner radius.
   *
   * `inline` renders the button alone, sized like an ordinary button
   * (`padding: 10px 20px`, `border-radius: var(--border-radius)`, normal
   * weight) while keeping the purple hardware colour — the connector's
   * identity on every screen it appears on. The error notice, if any,
   * renders as a sibling with `flex-basis: 100%` so the row's own
   * `flexWrap: 'wrap'` drops it onto its own line beneath rather than
   * stacking it inside a column.
   *
   * Defaults to false, which is byte-identical to this component before
   * the prop existed — the three standalone mounts (Race, Free Race, Free
   * Race lane setup) pass nothing and keep today's block layout.
   */
  inline?: boolean;
}

export const SerialProxyConnector: React.FC<SerialProxyConnectorProps> = ({
  trackId,
  inline = false,
}) => {
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

  if (inline) {
    return (
      <>
        <button
          className="proxy-connect-btn proxy-connect-btn--inline"
          onClick={handleConnect}
          disabled={status === 'connecting'}
        >
          <Icon path={mdiUsb} size={0.8} />
          {status === 'connecting' ? 'Connecting...' : 'Connect Hardware Timer'}
        </button>
        {status === 'error' && (
          <div className="proxy-connector-error proxy-connector-error--inline">
            <Icon path={mdiAlertCircle} size={0.8} />
            <span>{errorMsg}</span>
          </div>
        )}
      </>
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
