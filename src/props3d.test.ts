import { describe, expect, it } from 'vitest';
import { BASE_HI_FLOCKED, FLOCK_SLOTS, PEN_W } from './props3d';

describe('penguin flock slots', () => {
  // each slot's waddle range, with the base penguin squeezed as it is once the flock grows
  const ranges = FLOCK_SLOTS.map((s, i) => ({ lo: s.lo, hi: i === 0 ? BASE_HI_FLOCKED : s.hi, x: s.x }));

  it('never lets two penguins overlap, wherever each waddles', () => {
    for (let i = 0; i < ranges.length; i++)
      for (let j = i + 1; j < ranges.length; j++) {
        const [a, b] = ranges[i].x < ranges[j].x ? [ranges[i], ranges[j]] : [ranges[j], ranges[i]];
        expect(b.lo - a.hi, `slots ${i} and ${j}`).toBeGreaterThanOrEqual(PEN_W);
      }
  });

  it('keeps every penguin off the board (columns span x -0.5..8.5)', () => {
    for (const r of ranges) expect(r.hi + PEN_W / 2 <= -0.5 || r.lo - PEN_W / 2 >= 8.5).toBe(true);
    expect(FLOCK_SLOTS[0].hi + PEN_W / 2).toBeLessThan(10.4 + 0.35); // solo base stays clear of the spruce trunk
  });

  it('puts the centre of each range at the slot x', () => {
    for (const s of FLOCK_SLOTS) expect(s.x).toBeGreaterThanOrEqual(s.lo), expect(s.x).toBeLessThanOrEqual(s.hi);
  });
});
