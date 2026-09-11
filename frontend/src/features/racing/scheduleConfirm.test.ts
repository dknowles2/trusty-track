import { describe, test, expect } from 'vitest';
import {
  deleteRoundConfirmMessage,
  regenerateRoundConfirmMessage,
  regenerateWouldDiscardChanges,
} from './scheduleConfirm';

describe('deleteRoundConfirmMessage', () => {
  test('names the round and the loss', () => {
    expect(deleteRoundConfirmMessage('Grand Finals', 3)).toBe(
      'Delete Grand Finals? Its 3 heats have not been run. This cannot be undone.'
    );
  });

  test('a single heat is singular', () => {
    expect(deleteRoundConfirmMessage('Semifinal', 1)).toBe(
      'Delete Semifinal? Its 1 heat has not been run. This cannot be undone.'
    );
  });
});

describe('regenerateRoundConfirmMessage', () => {
  test('names the round and the running order', () => {
    expect(regenerateRoundConfirmMessage('All Pack')).toBe(
      'Regenerate All Pack? The current running order, including any heats you dragged, will be replaced.'
    );
  });
});

describe('regenerateWouldDiscardChanges', () => {
  const inOrder = [
    { id: 101, heatNumber: 1 },
    { id: 102, heatNumber: 2 },
    { id: 103, heatNumber: 3 },
  ];

  test('a fresh, never-touched round has nothing to lose', () => {
    expect(regenerateWouldDiscardChanges(inOrder, false, false)).toBe(false);
  });

  test('a hand-picked field is always something to lose', () => {
    expect(regenerateWouldDiscardChanges(inOrder, true, false)).toBe(true);
  });

  test('a race running the master running order is always something to lose', () => {
    expect(regenerateWouldDiscardChanges(inOrder, false, true)).toBe(true);
  });

  test('heatNumber no longer rising in id order means the round was dragged', () => {
    // Heat 103 was dragged ahead of 102 — same ids, heatNumber 2 and 3 swapped.
    const dragged = [
      { id: 101, heatNumber: 1 },
      { id: 102, heatNumber: 3 },
      { id: 103, heatNumber: 2 },
    ];
    expect(regenerateWouldDiscardChanges(dragged, false, false)).toBe(true);
  });

  test('ids arriving out of creation order are still read correctly', () => {
    // The array itself is not assumed sorted by id.
    const reversed = [...inOrder].reverse();
    expect(regenerateWouldDiscardChanges(reversed, false, false)).toBe(false);
  });

  test('no heats loaded yet defaults to "may have something to lose"', () => {
    expect(regenerateWouldDiscardChanges([], false, false)).toBe(true);
  });
});
