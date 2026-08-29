import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AwardArtwork, { ARTWORK_KEYS, hasArtwork } from './artwork';

describe('hasArtwork', () => {
  it('recognises a real key', () => {
    expect(hasArtwork('trophy')).toBe(true);
  });

  it('rejects a key from a build that never shipped it — or none at all', () => {
    expect(hasArtwork('a-key-from-the-future')).toBe(false);
    expect(hasArtwork(null)).toBe(false);
    expect(hasArtwork(undefined)).toBe(false);
  });
});

describe('AwardArtwork', () => {
  it('renders nothing for an unrecognised key, rather than a broken-image box', () => {
    const { container } = render(<AwardArtwork artworkKey="not-a-real-key" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('defaults to the light-background palette — scouting blue', () => {
    const { container } = render(<AwardArtwork artworkKey="trophy" />);
    const svg = container.querySelector('svg')!;
    expect(svg.innerHTML).toContain('var(--scouting-blue');
    expect(svg.innerHTML).not.toContain('#ffffff');
  });

  it('the certificate/Awards-list default (no variant) is identical to variant="light"', () => {
    const { container: defaulted } = render(<AwardArtwork artworkKey="medal" />);
    const { container: explicit } = render(<AwardArtwork artworkKey="medal" variant="light" />);
    expect(defaulted.querySelector('svg')!.innerHTML).toBe(
      explicit.querySelector('svg')!.innerHTML,
    );
  });

  describe('variant="dark" — the ceremony slide (#400)', () => {
    // The ceremony slide paints its background in `--scouting-blue`, the
    // same variable every shape used for its outline. Every one of the ten
    // artwork keys has to lose every trace of that variable on the dark
    // variant, or that key's turn on the projector is the bug again.
    it.each(ARTWORK_KEYS)('draws "%s" with no scouting-blue left in it', (key) => {
      const { container } = render(<AwardArtwork artworkKey={key} variant="dark" />);
      const svg = container.querySelector('svg')!;
      expect(svg.innerHTML).not.toContain('var(--scouting-blue');
    });

    it('swaps the outline for white, and keeps the gold fill', () => {
      const { container } = render(<AwardArtwork artworkKey="trophy" variant="dark" />);
      const svg = container.querySelector('svg')!;
      expect(svg.innerHTML).toContain('#ffffff');
      expect(svg.innerHTML).toContain('var(--cub-scouting-gold');
    });

    it('is otherwise the same drawing as the light variant — only the line colour moves', () => {
      const { container: light } = render(<AwardArtwork artworkKey="tortoise" variant="light" />);
      const { container: dark } = render(<AwardArtwork artworkKey="tortoise" variant="dark" />);
      const lightSvg = light.querySelector('svg')!.innerHTML;
      const darkSvg = dark.querySelector('svg')!.innerHTML;
      const normalized = darkSvg.split('#ffffff').join('var(--scouting-blue, #003F87)');
      expect(normalized).toBe(lightSvg);
    });

    it('a caller-supplied palette wins over the hardcoded white (#498) — Sawdust & Pine and Trail Colors have their own display text colour', () => {
      const { container } = render(
        <AwardArtwork
          artworkKey="trophy"
          variant="dark"
          palette={{ line: 'var(--display-text-color, #FBF2E1)', fill: 'var(--display-accent-color, #FCD116)' }}
        />,
      );
      const svg = container.querySelector('svg')!;
      expect(svg.innerHTML).toContain('var(--display-text-color');
      expect(svg.innerHTML).not.toContain('#ffffff');
    });

    it('no palette at all still falls back to the hardcoded white', () => {
      const { container } = render(<AwardArtwork artworkKey="trophy" variant="dark" />);
      const svg = container.querySelector('svg')!;
      expect(svg.innerHTML).toContain('#ffffff');
    });
  });
});
