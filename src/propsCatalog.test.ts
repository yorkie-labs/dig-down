import { describe, expect, it } from 'vitest';
import { BAND_THEMES, SURFACE_EXTRAS, bandTheme, shaftLayout, type PropSpot } from './propsCatalog';

// keys only (non-eager): proves each file exists without loading it
const files = new Set(
  Object.keys(import.meta.glob('/public/models/polyfork/*.glb')).map((p) => p.split('/').pop()!.replace(/\.glb$/, '')),
);
const BANDS = 15;

describe('shaftLayout', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(shaftLayout(7, BANDS)).toEqual(shaftLayout(7, BANDS));
    expect(shaftLayout(7, BANDS)).not.toEqual(shaftLayout(8, BANDS));
  });

  for (const seed of [0, 1, 7, 42, 12345, 987654321]) {
    const spots = shaftLayout(seed, 30); // past the theme list too (endless cycling)
    it(`seed ${seed}: sorted by depth, first 6m clear, values in range`, () => {
      for (let i = 1; i < spots.length; i++) expect(spots[i].depth).toBeGreaterThanOrEqual(spots[i - 1].depth);
      for (const p of spots) {
        expect(p.depth).toBeGreaterThanOrEqual(6);
        expect(p.xOffset).toBeGreaterThanOrEqual(0.8);
        expect(p.xOffset).toBeLessThanOrEqual(1.6);
        expect(Math.abs(p.tilt)).toBeLessThanOrEqual(0.2);
        if (p.landmark) {
          expect(p.size).toBeGreaterThanOrEqual(2.6);
          expect(p.size).toBeLessThanOrEqual(3.2);
        }
      }
    });

    it(`seed ${seed}: no id twice in a row on a side`, () => {
      for (const side of [-1, 1]) {
        const ids = spots.filter((p) => p.side === side).map((p) => p.id);
        for (let i = 1; i < ids.length; i++) expect(ids[i], `${side}@${i}`).not.toBe(ids[i - 1]);
      }
    });

    it(`seed ${seed}: one landmark per band at its start, alternating sides, ~8 props, ≤2 per id`, () => {
      const byBand = new Map<number, PropSpot[]>();
      for (const p of spots) {
        const b = Math.floor(p.depth / 100);
        byBand.set(b, [...(byBand.get(b) ?? []), p]);
      }
      expect(byBand.size).toBe(30);
      for (const [b, list] of byBand) {
        const lms = list.filter((p) => p.landmark);
        expect(lms).toHaveLength(1);
        expect(lms[0]).toBe(list[0]); // shallowest in its band
        expect(lms[0].side).toBe(b % 2 ? 1 : -1);
        expect(lms[0].id).toBe(bandTheme(b).landmark);
        const props = list.filter((p) => !p.landmark);
        expect(props).toHaveLength(8);
        const count = new Map<string, number>();
        for (const p of props) {
          expect(bandTheme(b).pool).toContain(p.id);
          count.set(p.id, (count.get(p.id) ?? 0) + 1);
        }
        for (const n of count.values()) expect(n).toBeLessThanOrEqual(2);
      }
    });
  }

  it('size jitter stays within ±20% of the band size, and both mirrors and tilts occur', () => {
    const spots = shaftLayout(7, BANDS).filter((p) => !p.landmark);
    const sizes = spots.map((p) => p.size);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(1.2);
    for (const s of sizes) {
      expect(s).toBeGreaterThanOrEqual(1.55 * 0.8);
      expect(s).toBeLessThanOrEqual(1.55 * 1.15 * 1.2); // the largest SIZE_MUL
    }
    expect(spots.some((p) => p.mirror) && spots.some((p) => !p.mirror)).toBe(true);
    expect(spots.some((p) => p.tilt !== 0) && spots.some((p) => p.tilt === 0)).toBe(true);
  });
});

describe('catalog', () => {
  it('has the seven original bands plus endless strata down to 1500m, each pool 4-5 ids', () => {
    expect(BAND_THEMES).toHaveLength(BANDS);
    for (const t of BAND_THEMES) {
      expect(t.pool.length).toBeGreaterThanOrEqual(4);
      expect(t.pool.length).toBeLessThanOrEqual(5);
      expect(new Set(t.pool).size).toBe(t.pool.length);
    }
    // the endless strata don't just replay the first seven
    expect(bandTheme(7).name).not.toBe(bandTheme(1).name);
    expect(bandTheme(BANDS)).toBe(bandTheme(1));
  });

  // The game loads these from polyfork.dev's CDN; the local copies (gitignored) only exist on a dev
  // machine, so the check is skipped in a fresh clone / CI.
  it.skipIf(files.size === 0)('every id has a GLB in public/models/polyfork/ (local copy)', () => {
    const ids = new Set([...BAND_THEMES.flatMap((t) => [...t.pool, t.landmark]), ...SURFACE_EXTRAS.map((e) => e.id)]);
    for (const id of ids) expect(files.has(id), id).toBe(true);
  });

  it('surface extras stay off the board and the penguin lane', () => {
    for (const e of SURFACE_EXTRAS) {
      expect(e.x >= -0.5 && e.x <= 8.5, e.id).toBe(false);
      expect(e.x >= 8.9 && e.x <= 9.9, e.id).toBe(false);
    }
  });
});
