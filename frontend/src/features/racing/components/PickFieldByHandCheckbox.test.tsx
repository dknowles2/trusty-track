import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { PickFieldByHandCheckbox } from './PickFieldByHandCheckbox';

describe('PickFieldByHandCheckbox', () => {
  it('starts unchecked and reports a change', () => {
    const onChange = vi.fn();
    render(
      <PickFieldByHandCheckbox
        checked={false}
        onChange={onChange}
        mutedColor="var(--text-muted-color)"
      />
    );
    const checkbox = screen.getByLabelText(/I'll choose who races myself/);
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders checked when asked to', () => {
    render(
      <PickFieldByHandCheckbox
        checked
        onChange={vi.fn()}
        mutedColor="var(--text-muted-color)"
      />
    );
    expect(screen.getByLabelText(/I'll choose who races myself/)).toBeChecked();
  });
});
