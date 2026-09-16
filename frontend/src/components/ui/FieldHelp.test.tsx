// @vitest-environment jsdom
import '../../setupTests';
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FieldHelp from './FieldHelp';

/**
 * `useNarrowViewport` reads `window.innerWidth` inside a `resize` listener
 * — the same helper `ScheduleManagement.test.tsx`'s own "heats render as
 * cards under 600px" suite uses, so a test has to fire the event a real
 * browser would rather than just assigning the property. Wrapped in `act`
 * since a component from a previous test can still be mounted when the
 * teardown below fires.
 */
function resizeTo(width: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  });
}

describe('FieldHelp', () => {
  afterEach(() => {
    resizeTo(1024);
  });

  describe('at 1024px (jsdom default, and >= 600px)', () => {
    it('renders exactly what the old inline <p> rendered — same element, same style, no toggle', () => {
      const { container } = render(
        <FieldHelp id="the-help" as="p" style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>
          Guards against an accidental edit.
        </FieldHelp>,
      );

      const p = container.querySelector('p#the-help');
      expect(p).not.toBeNull();
      expect(p).toHaveTextContent('Guards against an accidental edit.');
      expect(p?.getAttribute('style')).toContain('font-size: 0.8rem');
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders as <small> when asked to, matching the option-description blocks', () => {
      const { container } = render(
        <FieldHelp id="option-help" as="small">
          Tied cars share the place.
        </FieldHelp>,
      );
      expect(container.querySelector('small#option-help')).not.toBeNull();
    });
  });

  describe('under 600px, with no summary', () => {
    it('is closed by default, showing only the toggle', () => {
      resizeTo(390);
      render(<FieldHelp id="the-help">Guards against an accidental edit.</FieldHelp>);

      expect(screen.queryByText('Guards against an accidental edit.')).not.toBeVisible();
      const toggle = screen.getByRole('button', { name: 'More about this' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('aria-controls', 'the-help');
    });

    it('opens the sentence in place on click, and aria-expanded toggles', async () => {
      resizeTo(390);
      const user = userEvent.setup();
      render(<FieldHelp id="the-help">Guards against an accidental edit.</FieldHelp>);

      const toggle = screen.getByRole('button', { name: 'More about this' });
      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Guards against an accidental edit.')).toBeVisible();

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('Guards against an accidental edit.')).not.toBeVisible();
    });

    it('keeps the same id on the text whether collapsed or expanded, so aria-describedby still resolves', () => {
      resizeTo(390);
      const { container } = render(<FieldHelp id="the-help">Guards against an accidental edit.</FieldHelp>);
      expect(container.querySelector('#the-help')).not.toBeNull();
    });
  });

  describe('summary — collapsible at every width (the Lock race box)', () => {
    it('shows the summary and keeps the rest collapsed even at 1024px', () => {
      render(
        <FieldHelp id="lock-help" summary="Guards a finished race against accidental edits; it can still be deleted.">
          The rest of the explanation.
        </FieldHelp>,
      );

      expect(
        screen.getByText('Guards a finished race against accidental edits; it can still be deleted.'),
      ).toBeVisible();
      expect(screen.queryByText('The rest of the explanation.')).not.toBeVisible();
      expect(screen.getByRole('button', { name: 'More about this' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('still opens on click at 1024px', async () => {
      const user = userEvent.setup();
      render(
        <FieldHelp id="lock-help" summary="One line.">
          The rest.
        </FieldHelp>,
      );

      await user.click(screen.getByRole('button', { name: 'More about this' }));
      expect(screen.getByText('The rest.')).toBeVisible();
    });
  });

  describe('forceOpen — the first-run wizard', () => {
    it('ignores width and renders everything expanded, with no toggle', () => {
      resizeTo(390);
      render(
        <FieldHelp id="wizard-help" forceOpen>
          Always visible here.
        </FieldHelp>,
      );

      expect(screen.getByText('Always visible here.')).toBeVisible();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('ignores a summary too — nothing is collapsed on the wizard', () => {
      resizeTo(390);
      const { container } = render(
        <FieldHelp id="wizard-help" forceOpen summary="Short line.">
          The rest of it.
        </FieldHelp>,
      );

      expect(container.textContent).toContain('Short line.');
      expect(container.textContent).toContain('The rest of it.');
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
