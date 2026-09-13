// @vitest-environment jsdom
import '../../../setupTests';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditRaceButton from './EditRaceButton';

/**
 * #1085 — the Roster and Control pages each hand-styled their own "Edit
 * race" button, and the two drifted apart in padding, icon size and gap.
 * `EditRaceButton` is the one component both now render; this pins that it
 * carries the caller's own `data-testid` (both pages keep their pinned ids
 * — `edit-race-btn` on Roster, `race-control-edit-race` on Control — so a
 * test written against either still finds it) and that both callers end up
 * with the *same* rendered dimensions, which a same-props render already
 * guarantees but a hand-written duplicate never did.
 */
describe('EditRaceButton', () => {
  it('renders with the caller-supplied test id', () => {
    render(<EditRaceButton onClick={vi.fn()} data-testid="edit-race-btn" />);
    expect(screen.getByTestId('edit-race-btn')).toBeInTheDocument();
  });

  it('renders with a different caller-supplied test id', () => {
    render(<EditRaceButton onClick={vi.fn()} data-testid="race-control-edit-race" />);
    expect(screen.getByTestId('race-control-edit-race')).toBeInTheDocument();
  });

  it('says "Edit race"', () => {
    render(<EditRaceButton onClick={vi.fn()} data-testid="edit-race-btn" />);
    expect(screen.getByText('Edit race')).toBeInTheDocument();
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<EditRaceButton onClick={onClick} data-testid="edit-race-btn" />);
    fireEvent.click(screen.getByTestId('edit-race-btn'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled and titled when the caller says so', () => {
    render(
      <EditRaceButton
        onClick={vi.fn()}
        data-testid="edit-race-btn"
        disabled
        title="Requires the operator PIN"
      />,
    );
    const button = screen.getByTestId('edit-race-btn');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Requires the operator PIN');
  });

  it('two instances render with identical dimensions, whatever page renders them (#1085)', () => {
    render(
      <>
        <EditRaceButton onClick={vi.fn()} data-testid="edit-race-btn" />
        <EditRaceButton onClick={vi.fn()} data-testid="race-control-edit-race" />
      </>,
    );
    const roster = screen.getByTestId('edit-race-btn');
    const control = screen.getByTestId('race-control-edit-race');
    expect(roster.getAttribute('style')).toBe(control.getAttribute('style'));
  });
});
