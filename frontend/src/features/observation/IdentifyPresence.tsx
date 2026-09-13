/**
 * The two treatments a display gives its own name (#495), rendered once so
 * every screen a display can end up on gets both (#519).
 *
 * Purely presentational — `useIdentifyOverlay` (in `useIdentifyOverlay.ts`)
 * holds the `seen`/`showConnectBadge`/`showFlash` state and is called exactly
 * once, at the top of whichever page renders this, so the state survives
 * that page switching between its own `if`-branch returns (a view change, or
 * a break starting or ending — #1071, #1072). This component can then be
 * placed at more than one of those branches — inline in one, a fixed overlay
 * in the rest — with no risk of losing history to a remount, since it holds
 * none of its own.
 */

import { useChrome } from '../../context/ChromeContext';

interface Props {
  /** This display's own name, or nullish before it has one. */
  name?: string | null;
  /** True for a few seconds right after this display's first payload. */
  showConnectBadge: boolean;
  /** True for a few seconds after an Identify command. */
  showFlash: boolean;
  /**
   * True when the caller has a spot for this badge in its own layout flow
   * (#954) — the standard, non-projector Live view, which keeps a status row
   * (the timer pill, then **Launch Projector Mode**) the badge can join on
   * the left rather than float over. Every other caller — the six
   * chrome-hidden views this page also renders, the break overlay, and
   * `AwardCeremony`, which paints itself above the navigation at its own
   * z-index rather than hiding it via `ChromeContext` — is a genuinely
   * full-screen surface with no row to join and nothing in that corner to
   * collide with, so those keep the fixed-corner treatment untouched.
   */
  inline?: boolean;
}

/**
 * Renders nothing until this display has a name to show. Place it once per
 * branch, near the root of whatever full-screen surface that branch renders —
 * the flash is always `position: fixed`, and so is the connect badge unless
 * the caller passes `inline`.
 */
export default function IdentifyPresence({ name, showConnectBadge, showFlash, inline = false }: Props) {
  // Whether the app's own header is on screen (#175). A projector has none —
  // `chromeHidden` is true — so the badge is free to sit at the very corner.
  // Everywhere else `Navigation`'s bar occupies that corner already
  // (`zIndex: 1000` against the badge's own `4900`), so it has to sit below
  // it rather than on top of it (#790).
  const { hidden: chromeHidden } = useChrome();

  if (!name) return null;

  return (
    <>
      {showConnectBadge && (inline ? (
        <div
          className="identify-connect-badge identify-connect-badge--inline"
          data-testid="identify-connect-badge"
          style={{
            // No `position` at all — an ordinary flex item beside the timer
            // status pill the caller places it next to, so it can never
            // paint over a button the way the fixed corner did (#954).
            background: 'var(--display-badge-bg-color)',
            color: 'var(--display-text-color)',
            padding: '0.4rem 0.8rem',
            borderRadius: '12px',
            fontSize: '0.85rem',
            fontWeight: 'bold',
          }}
        >
          {name}
        </div>
      ) : (
        <div
          className="identify-connect-badge"
          data-testid="identify-connect-badge"
          style={{
            position: 'fixed',
            // Below `Navigation`'s bar (roughly 56px tall) when it is on
            // screen, at the corner when there is no chrome to clash with.
            top: chromeHidden ? '16px' : '76px',
            right: '16px',
            zIndex: 4900,
            background: 'var(--display-badge-bg-color)',
            color: 'var(--display-text-color)',
            padding: '0.5rem 1rem',
            borderRadius: '20px',
            fontSize: '0.9rem',
            fontWeight: 'bold',
            pointerEvents: 'none',
          }}
        >
          {name}
        </div>
      ))}
      {showFlash && (
        <div
          className="identify-flash"
          data-testid="identify-flash"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--display-flash-bg-color)',
            color: 'var(--display-text-color)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: '9vmin', fontWeight: 'bold', textAlign: 'center', padding: '0 5vmin' }}>
            {name}
          </div>
        </div>
      )}
    </>
  );
}
