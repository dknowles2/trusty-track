// @vitest-environment jsdom
import '../../setupTests';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
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

  // #954 — the standard Live view puts Launch Projector Mode in the exact
  // corner the fixed badge floats over at phone width. `inline` opts the
  // caller into an ordinary flex item instead, placed in whatever row the
  // caller mounts it in, with no `position` for a button to disappear under.
  it('joins the flow with no fixed position when the caller has a row for it', () => {
    useChromeMock.mockReturnValue({ hidden: false, setHidden: () => {} });
    render(<IdentifyPresence assignment={{ name: 'Playful Panther', identifySeq: 1 }} inline />);
    const badge = screen.getByTestId('identify-connect-badge');
    expect(badge.style.position).toBe('');
    expect(badge.style.top).toBe('');
    expect(badge.style.right).toBe('');
  });
});

/**
 * #954 — the identify-flash treatment (the full-screen name takeover) is
 * unaffected by `inline`; it stays a fixed overlay regardless, since it is a
 * deliberate full-attention grab, not chrome competing with a button.
 */
describe('IdentifyPresence flash', () => {
  it('still covers the screen when the caller is inline', () => {
    useChromeMock.mockReturnValue({ hidden: false, setHidden: () => {} });
    const { rerender } = render(
      <IdentifyPresence assignment={{ name: 'Playful Panther', identifySeq: 1 }} inline />,
    );
    // The first payload is a connect (`seen === null`), never a flash — the
    // command has to arrive as a rise over a `seen` this instance already
    // holds, so rerender with a higher `identifySeq` to raise one.
    act(() => {
      rerender(<IdentifyPresence assignment={{ name: 'Playful Panther', identifySeq: 2 }} inline />);
    });
    const flash = screen.getByTestId('identify-flash');
    expect(flash.style.position).toBe('fixed');
  });
});
