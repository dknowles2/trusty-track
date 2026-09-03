// @vitest-environment jsdom
import '../../setupTests';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CameraCapture from './CameraCapture';

// #593: over an insecure origin (TRUSTYTRACK_HTTP_ONLY, or a second device
// reached by plain http://<lan-ip>), `navigator.mediaDevices` does not exist
// at all. Calling straight into it throws a bare TypeError that reads, to a
// volunteer, exactly like a permissions refusal — the wrong thing to
// troubleshoot when the real cause is the connection. These pin the two
// messages apart.

afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: undefined,
    });
});

it('explains the secure-connection requirement over an explicitly insecure origin', () => {
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: false,
    });
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
    });

    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText(/needs a secure connection/)).toBeInTheDocument();
    // Never even asked — no permissions prompt to blame.
    expect(getUserMedia).not.toHaveBeenCalled();
});

it('still reports the ordinary permissions message when the origin is secure', async () => {
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} />);

    expect(
        await screen.findByText(/Could not access camera\. Please ensure permissions/),
    ).toBeInTheDocument();
});
