// @vitest-environment jsdom
import '../../setupTests';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import IdentifyPresence from './IdentifyPresence';

/**
 * #790, defect 1 — the connect badge is `position: fixed; top: 16px; right:
 * 16px; z-index: 4900` unconditionally, while the app header (`Navigation`,
 * `zIndex: 1000`) sits on top of the page whenever `ChromeContext`'s
 * `hidden` is false. At 1024/1280px the badge draws directly over the
 * Settings link for the four seconds it is up.
 *
 * The badge has to float high on a genuinely full-screen surface (a
 * projector, where `chromeHidden` is true and there is no header to clash
 * with) but must clear the header when the chrome is on screen. This pins
 * that the badge's own top offset differs between the two `ChromeContext`
 * states, rather than being a fixed `16px` regardless.
 */

const useChromeMock = vi.fn();
vi.mock('../../context/ChromeContext', () => ({
  useChrome: () => useChromeMock(),
}));

afterEach(() => {
  cleanup();
  useChromeMock.mockReset();
});

describe('IdentifyPresence connect badge', () => {
  it('sits clear of the header when the chrome is on screen', () => {
    useChromeMock.mockReturnValue({ hidden: false, setHidden: () => {} });
    render(<IdentifyPresence assignment={{ name: 'Playful Panther', identifySeq: 1 }} />);
    const badge = screen.getByTestId('identify-connect-badge');
    const top = parseInt(badge.style.top, 10);
    // Navigation's own bar is `position: relative`, not fixed, but it still
    // paints over anything pinned to the same corner at `top: 16px` — the
    // badge needs enough clearance to sit below it instead.
    expect(top).toBeGreaterThan(48);
  });

  it('floats at the corner when there is no chrome to clash with', () => {
    useChromeMock.mockReturnValue({ hidden: true, setHidden: () => {} });
    render(<IdentifyPresence assignment={{ name: 'Playful Panther', identifySeq: 1 }} />);
    const badge = screen.getByTestId('identify-connect-badge');
    const top = parseInt(badge.style.top, 10);
    expect(top).toBe(16);
  });
});
