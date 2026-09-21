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
   * `inline` covers all three states the row can show, not just the
   * disconnected/connecting button — the connected badge and the
   * unsupported notice sit in the same row, for as long as they're on
   * screen, and a real event spends most of its time in the connected
   * state.
   *
   * - Disconnected/connecting: the button renders alone, sized like an
   *   ordinary button (`padding: 10px 20px`, `border-radius:
   *   var(--border-radius)`, normal weight) while keeping the purple
   *   hardware colour — the connector's identity on every screen it
   *   appears on. The error notice, if any, renders as a sibling with
   *   `flex-basis: 100%` so the row's own `flexWrap: 'wrap'` drops it
   *   onto its own line beneath rather than stacking it inside a column.
   * - Connected: the "Hardware Timer Proxy Active" badge gets the same
   *   padding and corner radius as Reset, with no `margin-bottom` — it
   *   keeps its own success colour and text, and `cursor: default` since
   *   it is a status, not a button (no hover).
   * - Unsupported: the "Web Serial not supported" notice loses its
   *   `margin-bottom` and gets `flex-basis: 100%`, the same shape as the
   *   error notice above — there is no button in this state, so it wraps
   *   onto its own line beneath Reset.
   *
   * Defaults to false, which is byte-identical to this component before
   * the prop existed — the three standalone mounts (Race, Free Race, Free
   * Race lane setup) pass nothing and keep today's block layout in every
   * state.
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
      <div
        className={
          inline
            ? 'proxy-connector-unsupported proxy-connector-unsupported--inline'
            : 'proxy-connector-unsupported'
        }
      >
        <Icon path={mdiAlertCircle} size={1} color="var(--danger-accent-color)" />
        <span>Web Serial not supported. Use Chrome or Edge.</span>
      </div>
    );
  }

  if (status === 'connected') {
    return (
      <div
        className={
          inline
            ? 'proxy-connector-status connected proxy-connector-status--inline'
            : 'proxy-connector-status connected'
        }
      >
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
