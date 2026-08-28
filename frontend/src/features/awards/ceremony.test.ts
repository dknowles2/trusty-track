import { describe, expect, it } from 'vitest';
import { CeremonyAward, deltaForKey, slideFor, stepIndex } from './ceremony';

const ROUNDS = [{ id: 4, name: 'Finals', roundNumber: 2 }];
const DENS = [{ id: 5, name: 'Wolves' }];

const AWARDS: CeremonyAward[] = [
  {
    id: 1,
    name: 'Fastest Wolf',
    kind: 'SPEED',
    source: 'PACK',
    place: 1,
    denId: 5,
    artworkKey: 'trophy',
    recipient: {
      id: 100,
      firstName: 'Ada',
      lastName: 'Lovelace',
      carNumber: 42,
      racerImageUrl: '/static/ada.png',
    },
  },
  { id: 2, name: 'Best Paint', kind: 'SPECIAL', recipient: null },
];

describe('stepping through a ceremony', () => {
  it('moves forward and back', () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(1, -1, 3)).toBe(0);
  });

  it('stops at the last award rather than wrapping', () => {
    // Wrapping puts the first trophy back on the screen, which in a room reads
    // as "we are starting again" — and the last slide is the one that should
    // still be up while people take photographs.
    expect(stepIndex(2, 1, 3)).toBe(2);
  });

  it('stops at the first award rather than wrapping backwards', () => {
    expect(stepIndex(0, -1, 3)).toBe(0);
  });

  it('copes with a race that has no awards', () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe('which keys advance it', () => {
  it('takes the arrows, space and enter forward', () => {
    for (const key of ['ArrowRight', 'ArrowDown', ' ', 'Enter']) {
      expect(deltaForKey(key)).toBe(1);
    }
  });

  it('takes the other arrows back', () => {
    for (const key of ['ArrowLeft', 'ArrowUp']) {
      expect(deltaForKey(key)).toBe(-1);
    }
  });

  it('takes a presenter remote, which sends Page Up and Page Down', () => {
    expect(deltaForKey('PageDown')).toBe(1);
    expect(deltaForKey('PageUp')).toBe(-1);
  });

  it('ignores everything else', () => {
    expect(deltaForKey('a')).toBeNull();
    expect(deltaForKey('Escape')).toBeNull();
  });
});

describe('what goes on the screen', () => {
  it('shows the trophy, what it is for, and who won it', () => {
    expect(slideFor(AWARDS, 0, ROUNDS, DENS)).toEqual({
      awardId: 1,
      title: 'Fastest Wolf',
      subtitle: 'Fastest in Wolves',
      winner: 'Ada Lovelace (#42)',
      racerImageUrl: '/static/ada.png',
      artworkKey: 'trophy',
      position: '1 of 2',
    });
  });

  it('has no artwork for an award none was set for', () => {
    expect(slideFor(AWARDS, 1, ROUNDS, DENS)?.artworkKey).toBeNull();
  });

  it('still shows an award nobody has won', () => {
    // Most stay unresolved until the very end. An announcer reading "Best
    // Paint — and the winner is…" off a screen that had skipped it would be
    // worse than one that says the decision is still to come.
    const slide = slideFor(AWARDS, 1, ROUNDS, DENS);
    expect(slide?.title).toBe('Best Paint');
    expect(slide?.subtitle).toBe('Chosen by the judges');
    expect(slide?.winner).toBeNull();
  });

  it('has nothing to show past the end', () => {
    expect(slideFor(AWARDS, 9, ROUNDS, DENS)).toBeNull();
  });

  it('has nothing to show for a race with no awards', () => {
    expect(slideFor([], 0, ROUNDS, DENS)).toBeNull();
  });

  it('counts from one, because the audience is not counting from zero', () => {
    expect(slideFor(AWARDS, 1, ROUNDS, DENS)?.position).toBe('2 of 2');
  });
});
