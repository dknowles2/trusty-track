// @vitest-environment jsdom
import '../../../setupTests';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExcludedFromStandingsBadge from './ExcludedFromStandingsBadge';

describe('ExcludedFromStandingsBadge', () => {
  it('renders nothing for a racer who is not excluded', () => {
    render(<ExcludedFromStandingsBadge racer={{ id: 1, excludedFromStandings: false }} />);
    expect(screen.queryByText('Not ranked')).not.toBeInTheDocument();
  });

  it('says "Not ranked" for a racer excluded from standings', () => {
    render(<ExcludedFromStandingsBadge racer={{ id: 1, excludedFromStandings: true }} />);
    expect(screen.getByText('Not ranked')).toBeInTheDocument();
  });

  // #1093 — the pill's text sat high in its own box because nothing gave it
  // an explicit line-height or centred it against the box. The shared
  // `.status-pill` class (index.css) is what fixes that, for this badge and
  // for `NoHeatsBadge` beside it; this pins that the class is actually
  // applied rather than merely defined.
  it('carries the shared .status-pill class (#1093)', () => {
    render(<ExcludedFromStandingsBadge racer={{ id: 1, excludedFromStandings: true }} />);
    expect(screen.getByText('Not ranked')).toHaveClass('status-pill');
  });
});
