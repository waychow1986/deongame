import { describe, expect, it } from 'vitest';
import { centreFraction, displayOrder, fromDisplay, markerPath, orientationFor, toDisplay } from '../../src/shared/ui/board.js';

describe('board geometry (AC-11, AC-12)', () => {
  it('red at the bottom: a0 bottom-left, i9 top-right', () => {
    expect(toDisplay('a0', 'red-bottom')).toEqual({ c: 0, r: 9 });
    expect(toDisplay('i9', 'red-bottom')).toEqual({ c: 8, r: 0 });
  });
  it('black at the bottom: the view is rotated 180°', () => {
    expect(orientationFor('black')).toBe('black-bottom');
    expect(orientationFor('red')).toBe('red-bottom');
    expect(orientationFor(null)).toBe('red-bottom');
    expect(toDisplay('a0', 'black-bottom')).toEqual({ c: 8, r: 0 });
    expect(toDisplay('e9', 'black-bottom')).toEqual({ c: 4, r: 9 });
  });
  it('pieces sit on intersections at cell centres, not between them', () => {
    expect(centreFraction('a0', 'red-bottom')).toEqual({ x: 0.5 / 9, y: 0.95 });
    expect(centreFraction('e4', 'red-bottom')).toEqual({ x: 4.5 / 9, y: 0.55 });
  });
  it('display mapping round-trips and covers all 90 points once', () => {
    for (const o of ['red-bottom', 'black-bottom'] as const) {
      const all = displayOrder(o);
      expect(new Set(all).size).toBe(90);
      for (const p of all) {
        const { c, r } = toDisplay(p, o);
        expect(fromDisplay(c, r, o)).toBe(p);
      }
    }
  });
  it('corner markers have four corners in the middle and omit the outer side on the edges', () => {
    expect(markerPath(4, 6).match(/M/g)).toHaveLength(4);
    expect(markerPath(0, 6).match(/M/g)).toHaveLength(2);
    expect(markerPath(8, 6).match(/M/g)).toHaveLength(2);
  });
});
