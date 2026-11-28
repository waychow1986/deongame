import { describe, expect, it } from 'vitest';
import { seatLayout } from '../../src/shared/ui/seatLayout.js';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('poker seat layout (TD-018)', () => {
  it('puts my seat at the bottom centre', () => {
    for (const cap of [2, 6, 9]) {
      for (let me = 0; me < cap; me++) {
        const p = seatLayout(cap, me).find((x) => x.seat === me)!;
        expect(near(p.x, 50)).toBe(true);
        expect(p.y).toBeGreaterThan(90);
      }
    }
  });

  it('places the other seats clockwise in seat order (screen coordinates)', () => {
    const pos = seatLayout(4, 1);
    const at = (s: number) => pos.find((x) => x.seat === s)!;
    // Clockwise from the bottom on screen: bottom → left → top → right.
    expect(at(1).y).toBeGreaterThan(90);
    expect(at(2).x).toBeLessThan(10);
    expect(at(3).y).toBeLessThan(10);
    expect(at(0).x).toBeGreaterThan(90);
  });

  it('is a rotation of the same order for every viewer', () => {
    const angle = (p: { x: number; y: number }) => Math.atan2(p.y - 50, p.x - 50);
    for (const me of [0, 3, 5]) {
      const pos = seatLayout(6, me);
      const order = [...pos].sort((a, b) => {
        const da = (angle(a) - angle(pos.find((x) => x.seat === me)!) + 4 * Math.PI) % (2 * Math.PI);
        const db = (angle(b) - angle(pos.find((x) => x.seat === me)!) + 4 * Math.PI) % (2 * Math.PI);
        return da - db;
      });
      expect(order.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4, 5].map((k) => (me + k) % 6));
    }
  });

  it('returns one position per seat on the oval rim, all inside 0–100%', () => {
    const pos = seatLayout(9, 0);
    expect(pos.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const p of pos) {
      expect(near(((p.x - 50) / 50) ** 2 + ((p.y - 50) / 50) ** 2, 1)).toBe(true);
    }
  });

  it('treats a spectator (no seat) as seat 0 at the bottom', () => {
    expect(seatLayout(3, null).find((p) => p.seat === 0)!.y).toBeGreaterThan(90);
  });
});
