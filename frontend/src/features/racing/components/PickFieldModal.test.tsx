import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { PickFieldModal } from './PickFieldModal';

vi.mock('../../../components/ui/Modal', () => ({
  default: ({ isOpen, children, title }: any) =>
    isOpen ? (
      <div data-testid="mock-modal">
        <h1>{title}</h1>
        {children}
      </div>
    ) : null,
}));

describe('PickFieldModal', () => {
  const checkedInRacers = [
    { id: 1, firstName: 'Alice', lastName: 'Smith', carNumber: 7 },
    { id: 2, firstName: 'Bob', lastName: 'Jones', carNumber: 12 },
    { id: 3, firstName: 'Carol', lastName: 'White', carNumber: 3 },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    roundName: 'Championship Round',
    suggestionLabel: 'the top 2 from the whole pack',
    checkedInRacers,
    initialRacerIds: [] as number[],
    onSubmit: vi.fn().mockResolvedValue(undefined),
  };

  it('is not rendered while closed', () => {
    render(<PickFieldModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId('mock-modal')).not.toBeInTheDocument();
  });

  it('seeds two blank rows and the standings’ own suggestion when nothing has been picked yet', () => {
    render(<PickFieldModal {...defaultProps} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(
      screen.getByText(/The standings currently suggest the top 2 from the whole pack\./)
    ).toBeInTheDocument();
  });

  it('seeds a row per racer already picked (or already hand-picked) — #711', () => {
    render(<PickFieldModal {...defaultProps} initialRacerIds={[2, 3, 1]} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  it('Save line-up is disabled with fewer than two picks', () => {
    render(<PickFieldModal {...defaultProps} />);
    expect(screen.getByText('Save line-up')).toBeDisabled();
  });

  it('picking two racers enables submission, and Save calls onSubmit with their ids', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PickFieldModal {...defaultProps} onSubmit={onSubmit} />);

    const [first, second] = screen.getAllByRole('combobox');
    await user.click(first);
    await user.click(screen.getByText(/#7 Alice Smith/));
    await user.click(second);
    await user.click(screen.getByText(/#12 Bob Jones/));

    expect(screen.getByText('Save line-up')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Save line-up'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([1, 2]));
  });

  it('a racer picked in one row is not offered in another', async () => {
    const user = userEvent.setup();
    render(<PickFieldModal {...defaultProps} />);

    const [first, second] = screen.getAllByRole('combobox');
    await user.click(first);
    await user.click(screen.getByText(/#7 Alice Smith/));

    await user.click(second);
    expect(screen.queryByText(/#7 Alice Smith/)).not.toBeInTheDocument();
    expect(screen.getByText(/#12 Bob Jones/)).toBeInTheDocument();
  });

  it('"Add another" appends a row, and its remove button drops one back below two', async () => {
    render(<PickFieldModal {...defaultProps} initialRacerIds={[1, 2]} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);

    fireEvent.click(screen.getByText('Add another'));
    expect(screen.getAllByRole('combobox')).toHaveLength(3);

    const removeButtons = screen.getAllByLabelText('Remove from line-up');
    fireEvent.click(removeButtons[2]);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });

  it('the last row cannot be removed — a floor of two rows to pick into', () => {
    render(<PickFieldModal {...defaultProps} initialRacerIds={[]} />);
    const removeButtons = screen.getAllByLabelText('Remove from line-up');
    // Two rows, both removable down to... but not past one each: with only
    // two rows, removing either leaves the other alone rather than empty.
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    // Now at the floor: the sole remaining row's remove button is disabled.
    expect(screen.getByLabelText('Remove from line-up')).toBeDisabled();
  });

  it('shows no suggestion sentence when the standings have nothing to suggest', () => {
    render(<PickFieldModal {...defaultProps} suggestionLabel={null} />);
    expect(screen.queryByText(/standings currently suggest/)).not.toBeInTheDocument();
  });

  it('re-seeds from the round’s current pick on a genuine reopen, not on every render', () => {
    const { rerender } = render(
      <PickFieldModal {...defaultProps} initialRacerIds={[1, 2]} />
    );
    expect(screen.getAllByRole('combobox')).toHaveLength(2);

    // Closing and reopening for a *different* round re-seeds the rows.
    rerender(<PickFieldModal {...defaultProps} isOpen={false} initialRacerIds={[1, 2]} />);
    rerender(
      <PickFieldModal {...defaultProps} isOpen={true} initialRacerIds={[3, 2, 1]} />
    );
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  it('Cancel calls onClose without submitting', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<PickFieldModal {...defaultProps} onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
