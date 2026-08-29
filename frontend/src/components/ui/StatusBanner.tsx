/**
 * A rounded, coloured strip announcing the state of something — voting is
 * open, a vote just landed (#439).
 *
 * Awards and VotingBallot each grew one of these on their own, and each
 * invented its own background and text colour rather than reaching for a
 * shared idea of "this is the same kind of announcement" — the shades were
 * close enough to look like a mistake and different enough to notice. This
 * component is the one definition; a caller picks a `tone` rather than a
 * colour, and lays its own content out inside it exactly as before.
 */

import { CSSProperties, ReactNode } from 'react';

export type StatusBannerTone = 'neutral' | 'active' | 'success';

const TONE_STYLES: Record<StatusBannerTone, CSSProperties> = {
  // The default: informational, no particular urgency (voting closed).
  neutral: { background: '#fafafa', border: '1px solid #ddd' },
  // Something is under way and worth noticing (voting open).
  active: { background: '#fffbea', border: '1px solid #ddd' },
  // Confirms an action just succeeded (a vote was recorded).
  success: { background: '#f0f9f0', color: '#256029' },
};

interface StatusBannerProps {
  tone: StatusBannerTone;
  children: ReactNode;
  /** Layout is the caller's business — content differs (a button and a
   *  photo warning here, a confirmation and a "vote again" button there).
   *  Only the colour and shape are shared. */
  style?: CSSProperties;
}

export default function StatusBanner({ tone, children, style }: StatusBannerProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        borderRadius: '12px',
        ...TONE_STYLES[tone],
        ...style,
      }}
    >
      {children}
    </div>
  );
}
