import { describe, expect, it } from 'vitest';
import { stageById, type RunCheck } from './stages';

const endless = stageById('endless-glacier')!.def.endless!;
const check = (over: Partial<RunCheck>): RunCheck => ({
  won: true, time: 60, swings: 0, livesLost: 0, maxChain: 1, meltChains: 0, friends: 0, levelCapsules: [], clockSaved: 0,
  maxCombo: 0, score: 200000, ...over,
});

describe('endless ramp (review 3 item 17)', () => {
  it('holds the old caps to 1300m and steps up past it', () => {
    for (let n = 1; n <= 13; n++) {
      expect(endless(n).airDrain).toBeLessThanOrEqual(2.6);
      expect(endless(n).xChance).toBeLessThanOrEqual(0.25);
    }
    expect(endless(13).airDrain).toBe(2.6);
    expect(endless(14).airDrain).toBe(3.2);
    expect(endless(14).xChance).toBe(0.3);
    for (let n = 14; n <= 60; n++) {
      expect(endless(n).airDrain).toBeLessThanOrEqual(3.2);
      expect(endless(n).xChance).toBeLessThanOrEqual(0.3);
    }
  });
  it('thins capsules x0.93 per 100m down to a 0.6 floor', () => {
    expect(endless(1).capsuleMul).toBe(1);
    expect(endless(2).capsuleMul).toBeCloseTo(0.93);
    expect(endless(30).capsuleMul).toBe(0.6);
    for (let n = 2; n <= 30; n++) expect(endless(n).capsuleMul!).toBeLessThanOrEqual(endless(n - 1).capsuleMul!);
  });
  it('has no 2-colour level', () => {
    for (let n = 1; n <= 20; n++) expect(endless(n).colors).toBeGreaterThanOrEqual(3);
  });
});

describe('thaw medals count melt chains that reached step 2 (review 3 item 16)', () => {
  const thaw = stageById('thaw-cave')!;
  it('ignores the raw melt count', () => {
    expect(thaw.silver!.test(check({ meltChains: 40 }))).toBe(false);
    expect(thaw.silver!.test(check({ meltChains2: 1, livesLost: 1 }))).toBe(true);
    expect(thaw.gold!.test(check({ meltChains2: 2 }))).toBe(true);
    expect(thaw.gold!.test(check({ meltChains2: 2, livesLost: 1 }))).toBe(false);
  });
  it('reads an old record without meltChains2 as none', () => {
    expect(thaw.silver!.gapKo!(check({}))).toBe('녹은 연쇄 1번');
  });
});
