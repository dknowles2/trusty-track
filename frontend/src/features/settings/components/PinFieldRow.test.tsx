import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { blankPin, type PinField } from '../pinFields';
import PinFieldRow from './PinFieldRow';

type RenderOptions = {
  isSet?: boolean;
  optional?: boolean;
  field?: PinField;
};

function renderRow({ isSet = false, optional, field = blankPin }: RenderOptions = {}) {
  const onChange = vi.fn();
  render(
    <PinFieldRow
      id="operator_pin"
      label="Operator PIN"
      optional={optional}
      isSet={isSet}
      placeholder="e.g. 1234"
      what="Runs the race."
      field={field}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('PinFieldRow', () => {
  it('shows no PIN set: no removal control, and the plain help text', () => {
    renderRow({ isSet: false, field: blankPin });

    const input = screen.getByLabelText('Operator PIN');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'e.g. 1234');
    expect(input).not.toBeDisabled();
    expect(screen.queryByTestId('operator_pin-remove')).not.toBeInTheDocument();
    // Nothing is set yet, so there is nothing to say about keeping one.
    expect(screen.getByText('Runs the race.')).toBeInTheDocument();
  });

  it('shows a PIN already set: offers removal, and says blank keeps it', () => {
    renderRow({ isSet: true, field: blankPin });

    const removeButton = screen.getByTestId('operator_pin-remove');
    expect(removeButton).toHaveTextContent('Remove');
    expect(screen.getByText(/leave blank to keep the current pin/i)).toBeInTheDocument();
  });

  it('marks the field optional when asked to', () => {
    renderRow({ optional: true });
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  it('does not mark the field optional by default', () => {
    renderRow();
    expect(screen.queryByText('(optional)')).not.toBeInTheDocument();
  });

  it('reports a typed value, leaving the removal flag untouched', () => {
    const onChange = renderRow({ isSet: true, field: blankPin });

    fireEvent.change(screen.getByLabelText('Operator PIN'), { target: { value: '1234' } });

    expect(onChange).toHaveBeenCalledWith({ value: '1234', remove: false });
  });

  it('merges a typed value onto whatever was already in the field', () => {
    const onChange = renderRow({ isSet: true, field: { value: '12', remove: false } });

    fireEvent.change(screen.getByLabelText('Operator PIN'), { target: { value: '123' } });

    expect(onChange).toHaveBeenCalledWith({ value: '123', remove: false });
  });

  it('stages removal when Remove is clicked, clearing whatever was typed', () => {
    const onChange = renderRow({ isSet: true, field: { value: '9999', remove: false } });

    fireEvent.click(screen.getByTestId('operator_pin-remove'));

    // Removal wins over a value still sitting in the box (#192): sending it
    // back would quietly re-set the PIN the operator just asked to remove.
    expect(onChange).toHaveBeenCalledWith({ value: '', remove: true });
  });

  it('cancels a staged removal when Keep is clicked', () => {
    const onChange = renderRow({ isSet: true, field: { value: '', remove: true } });

    const button = screen.getByTestId('operator_pin-remove');
    expect(button).toHaveTextContent('Keep');
    fireEvent.click(button);

    expect(onChange).toHaveBeenCalledWith({ value: '', remove: false });
  });

  it('disables the input and swaps in a removal placeholder once removal is staged', () => {
    renderRow({ isSet: true, field: { value: '', remove: true } });

    const input = screen.getByLabelText('Operator PIN');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Will be removed');
    expect(screen.getByText(/will be removed when you save/i)).toBeInTheDocument();
  });

  it('says a value will be changed, not removed, once something has been typed', () => {
    renderRow({ isSet: true, field: { value: '1234', remove: false } });

    expect(screen.getByText(/will be changed when you save/i)).toBeInTheDocument();
    expect(screen.queryByText(/removed/i)).not.toBeInTheDocument();
  });

  it('does not offer removal for a PIN that was never set', () => {
    renderRow({ isSet: false, field: { value: '1234', remove: false } });

    expect(screen.queryByTestId('operator_pin-remove')).not.toBeInTheDocument();
  });

  it('reports nothing at all when the operator leaves the field alone', () => {
    // A blank field must never itself be read as "clear the PIN" (#192) —
    // only the explicit Remove control may do that.
    const onChange = renderRow({ isSet: true, field: blankPin });

    expect(onChange).not.toHaveBeenCalled();
  });
});
