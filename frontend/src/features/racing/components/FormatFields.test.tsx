import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { FormatFields } from './FormatFields';

describe('FormatFields', () => {
  const defaultProps = {
    type: 'ALL' as const,
    onChooseType: vi.fn(),
    racingGroupCount: 3,
    labelStyle: {},
    mutedColor: 'var(--text-muted-color)',
  };

  it('labels the control Format, with All Pack chosen by default', () => {
    render(<FormatFields {...defaultProps} />);
    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByLabelText(/All Pack/)).toBeChecked();
    expect(screen.queryByText(/Will create/)).not.toBeInTheDocument();
  });

  it('reports the chosen format', () => {
    const onChooseType = vi.fn();
    render(<FormatFields {...defaultProps} onChooseType={onChooseType} />);
    fireEvent.click(screen.getByLabelText(/By Den/));
    expect(onChooseType).toHaveBeenCalledWith('EACH_GROUP');
  });

  it('counts the rounds "By Den" is about to create', () => {
    render(<FormatFields {...defaultProps} type="EACH_GROUP" racingGroupCount={3} />);
    expect(screen.getByLabelText(/By Den/)).toBeChecked();
    expect(screen.getByText('Will create 3 rounds (one per den).')).toBeInTheDocument();
  });
});
