// @vitest-environment jsdom
import '../../../setupTests';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import NoHeatsBadge from './NoHeatsBadge';

const inNoHeat = { id: 1, carPassedInspection: true };

describe('NoHeatsBadge', () => {
  it('renders nothing before any round has been generated', () => {
    render(<NoHeatsBadge racer={inNoHeat} scheduledRacerIds={[]} anyHeatsScheduled={false} />);
    expect(screen.queryByText('No heats')).not.toBeInTheDocument();
  });

  it('says "No heats" for a checked-in racer left out of every generated round', () => {
    render(<NoHeatsBadge racer={inNoHeat} scheduledRacerIds={[99]} anyHeatsScheduled={true} />);
    expect(screen.getByText('No heats')).toBeInTheDocument();
  });

  // #1093 — same defect and same fix as ExcludedFromStandingsBadge, which
  // sits beside this one in the roster's status cell: both used an identical
  // hand-rolled style block with no line-height, so the text sat high in the
  // pill. Pulled into the shared `.status-pill` class in index.css.
  it('carries the shared .status-pill class (#1093)', () => {
    render(<NoHeatsBadge racer={inNoHeat} scheduledRacerIds={[99]} anyHeatsScheduled={true} />);
    expect(screen.getByText('No heats')).toHaveClass('status-pill');
  });
});
