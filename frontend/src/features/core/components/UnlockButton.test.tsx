import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPin } from '../../../api/pin';
import { verifyPin } from '../../../api/verifyPin';
import { UnlockButton } from './UnlockButton';

vi.mock('../../../api/verifyPin');

const mockVerifyPin = vi.mocked(verifyPin);

describe('UnlockButton, entering a PIN on a device holding none (#993)', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function openDialogAndType(pin: string) {
    fireEvent.click(screen.getByLabelText('Enter the PIN to make changes'));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: pin } });
    fireEvent.click(screen.getByText('Unlock'));
  }

  it('a wrong PIN never reaches localStorage, and the dialog says so', async () => {
    mockVerifyPin.mockResolvedValue('VIEWER');
    render(<UnlockButton isOperator={false} />);

    openDialogAndType('0000');

    await waitFor(() => {
      expect(screen.getByText('That PIN is not right.')).toBeInTheDocument();
    });

    expect(readPin()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    // The dialog stays open so the volunteer can just retype it.
    expect(screen.getByLabelText('Enter PIN')).toBeInTheDocument();
  });

  it('a right operator PIN is stored and the page reloads', async () => {
    mockVerifyPin.mockResolvedValue('OPERATOR');
    render(<UnlockButton isOperator={false} />);

    openDialogAndType('1234');

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(readPin()).toBe('1234');
  });

  it('a right check-in PIN is stored and the page reloads too', async () => {
    mockVerifyPin.mockResolvedValue('CHECKIN');
    render(<UnlockButton isOperator={false} />);

    openDialogAndType('5678');

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(readPin()).toBe('5678');
  });

  it('a network failure is reported without storing anything either', async () => {
    mockVerifyPin.mockRejectedValue(new Error('offline'));
    render(<UnlockButton isOperator={false} />);

    openDialogAndType('1234');

    await waitFor(() => {
      expect(screen.getByText(/Could not reach the server/)).toBeInTheDocument();
    });
    expect(readPin()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears a previous error once the volunteer starts retyping', async () => {
    mockVerifyPin.mockResolvedValue('VIEWER');
    render(<UnlockButton isOperator={false} />);

    openDialogAndType('0000');
    await waitFor(() => {
      expect(screen.getByText('That PIN is not right.')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '0001' } });
    expect(screen.queryByText('That PIN is not right.')).not.toBeInTheDocument();
  });

  it('never calls verifyPin with a PIN that was not the one submitted', async () => {
    mockVerifyPin.mockResolvedValue('OPERATOR');
    render(<UnlockButton isOperator={false} />);

    openDialogAndType('9999');

    await waitFor(() => expect(mockVerifyPin).toHaveBeenCalledWith('9999'));
  });
});
