import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { RacerCombobox } from './RacerCombobox';

describe('RacerCombobox (#1387)', () => {
  const racers = [
    { id: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
    { id: 2, firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
  ];

  it('exposes combobox/listbox/option ARIA attributes and preserves focus outline', () => {
    render(<RacerCombobox racers={racers} onChange={vi.fn()} />);

    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.style.outline).not.toBe('none');

    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');

    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-controls', listbox.id);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent('— Empty —');
    expect(options[1]).toHaveTextContent('#42 Ada Lovelace');
    expect(options[2]).toHaveTextContent('#7 Grace Hopper');
  });
});
