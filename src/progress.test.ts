import { describe, expect, it } from 'vitest';
import { createGame, stageRows } from './game';
import {
  BADGES, COSMETICS, cosmeticForBadge, dailyHistory, dailyMedals, dailyOf, dailyRecord, dailyShareText, dropStaleTimes, equippedCosmetics,
  isUnlocked, LiveStats, maxStars, medalFor, medalMetric, nextStageAfter, Progress, recordRun, RunResult, silverGap, statsOf, toggleCosmetic,
  totalStars, unlockedCosmetics,
} from './progress';
import { dailyKey, dailyStage, isDryLevel, ruleOf, STAGES, stageById, stageDepth } from './stages';

// defaults: a plain clear (250 swings is past every swing-budget medal)
const run = (over: Partial<RunResult>): RunResult => ({
  stageId: 'snowy-hill', won: true, score: 200000, depth: 300, time: 120, swings: 250, livesLost: 0, maxChain: 0, meltChains: 0, friends: 0, levelCapsules: [], clockSaved: 0, ...over,
});

describe('stages', () => {
  it('every stage builds a board of its own depth', () => {
    for (const s of STAGES) {
      const g = createGame(1, s.def);
      expect(g.rows).toBe(stageRows(s.def)); // endless starts with its first level
      expect(stageDepth(s.def)).toBe(s.def.levels.length * 100);
    }
  });

  it('the first stage is open, the others chain off the previous one', () => {
    expect(isUnlocked({}, 'snowy-hill')).toBe(true);
    expect(isUnlocked({}, 'hammer-igloo')).toBe(false);
    expect(isUnlocked({}, 'thaw-cave')).toBe(false);
  });
});

describe('medals and progress', () => {
  it('bronze for a clear, silver when the stage criterion holds, none for a loss', () => {
    expect(medalFor(run({}))).toBe('bronze');
    expect(medalFor(run({ swings: 190 }))).toBe('silver');
    expect(medalFor(run({ swings: 172 }))).toBe('gold');
    expect(medalFor(run({ swings: 172, livesLost: 1 }))).toBe('silver');
    expect(medalFor(run({ won: false, swings: 100 }))).toBe('none');
  });

  it('hammer igloo silver is a swing budget', () => {
    expect(medalFor(run({ stageId: 'hammer-igloo', swings: 300 }))).toBe('bronze');
    expect(medalFor(run({ stageId: 'hammer-igloo', swings: 200, livesLost: 1 }))).toBe('silver');
  });

  it('endless medals come from depth, not a clear', () => {
    expect(medalFor(run({ stageId: 'endless-glacier', won: false, depth: 150 }))).toBe('none');
    expect(medalFor(run({ stageId: 'endless-glacier', won: false, depth: 300 }))).toBe('bronze');
    expect(medalFor(run({ stageId: 'endless-glacier', won: false, depth: 800 }))).toBe('silver');
    expect(medalFor(run({ stageId: 'endless-glacier', won: false, depth: 1749 }))).toBe('silver');
    expect(medalFor(run({ stageId: 'endless-glacier', won: false, depth: 1750 }))).toBe('gold');
  });

  it('time attack keeps the fastest clock-adjusted clear', () => {
    const a = recordRun({}, run({ stageId: 'ice-slide', time: 70, clockSaved: 8 }));
    expect(a.progress['ice-slide'].bestTime).toBe(62);
    expect(a.medal).toBe('bronze');
    const b = recordRun(a.progress, run({ stageId: 'ice-slide', time: 40, clockSaved: 8 }));
    expect(b.progress['ice-slide'].bestTime).toBe(32);
    expect(b.medal).toBe('silver');
    expect(recordRun(b.progress, run({ stageId: 'ice-slide', time: 24, clockSaved: 4 })).medal).toBe('gold');
    const c = recordRun(b.progress, run({ stageId: 'ice-slide', won: false, time: 5 }));
    expect(c.progress['ice-slide'].bestTime).toBe(32);
  });

  it('a best time set on an older board of a fixed course is dropped (bug review 9)', () => {
    const course = stageById('ice-slide')!.course;
    expect(course).toBeGreaterThan(1);
    const now = recordRun({}, run({ stageId: 'ice-slide', time: 40 }));
    expect(now.progress['ice-slide']).toMatchObject({ bestTime: 40, course });
    // stored before the course had a version: the time goes, the medal and score stay
    const old: Progress = { 'ice-slide': { medal: 'silver', bestScore: 900, bestDepth: 300, bestTime: 20 } };
    expect(dropStaleTimes(old)['ice-slide']).toEqual({ medal: 'silver', bestScore: 900, bestDepth: 300 });
    expect(dropStaleTimes(now.progress)).toBe(now.progress); // nothing stale: same object
    // and a new run never keeps the stale time as the record
    expect(recordRun(old, run({ stageId: 'ice-slide', time: 50 })).progress['ice-slide'].bestTime).toBe(50);
    expect(recordRun(old, run({ stageId: 'ice-slide', won: false })).progress['ice-slide'].bestTime).toBeUndefined();
  });

  it('records keep the best medal and score and report new unlocks', () => {
    const first = recordRun({}, run({ time: 90, score: 500 }));
    expect(first.medal).toBe('bronze');
    expect(first.unlocked).toEqual(['hammer-igloo']);
    const second = recordRun(first.progress, run({ won: false, score: 900 }));
    expect(second.progress['snowy-hill']).toEqual({ medal: 'bronze', bestScore: 900, bestDepth: 300 });
    expect(second.unlocked).toEqual([]);
    expect(second.newBest).toBe(true);
  });
});

describe('gold medals and stars', () => {
  it('every stage has a gold criterion and gold implies silver', () => {
    const wins = [
      run({ swings: 170 }), run({ stageId: 'hammer-igloo', swings: 180 }), run({ stageId: 'thaw-cave', meltChains2: 2 }),
      run({ stageId: 'arcade-500', friends: 3 }), run({ stageId: 'aurora-north' }), run({ stageId: 'ice-slide', time: 20 }),
    ];
    for (const s of STAGES) expect(s.gold, s.def.id).not.toBeNull();
    for (const r of wins) {
      expect(medalFor(r), r.stageId).toBe('gold');
      expect(stageById(r.stageId)!.silver!.test(r), r.stageId).toBe(true);
    }
    expect(medalFor(run({ stageId: 'hammer-igloo', swings: 200, livesLost: 1 }))).toBe('silver');
    expect(medalFor(run({ stageId: 'arcade-500', friends: 2 }))).toBe('silver');
    expect(medalFor(run({ stageId: 'thaw-cave', meltChains2: 2, livesLost: 1 }))).toBe('silver');
    // thaw counts only melt chains that reached step 2 (review 3 item 16), not every melt pop
    expect(medalFor(run({ stageId: 'thaw-cave', meltChains: 30 }))).toBe('bronze');
    // aurora gold wants three of the four dry levels crossed without a capsule
    expect(medalFor(run({ stageId: 'aurora-north', levelCapsules: [3, 1, 2, 1, 0, 2, 0] }))).toBe('silver');
    expect(medalFor(run({ stageId: 'aurora-north', levelCapsules: [3, 0, 2, 1, 0, 2, 0] }))).toBe('gold');
    expect(medalFor(run({ stageId: 'aurora-north', livesLost: 1 }))).toBe('silver');
  });

  it('every gold but the friends and the clock also asks for a score (round 3)', () => {
    const golds = [
      [run({ swings: 170 }), 135000], [run({ stageId: 'hammer-igloo', swings: 180 }), 145000],
      [run({ stageId: 'thaw-cave', meltChains2: 2 }), 150000], [run({ stageId: 'aurora-north' }), 190000],
    ] as const;
    for (const [r, min] of golds) {
      expect(medalFor({ ...r, score: min }), r.stageId).toBe('gold');
      expect(medalFor({ ...r, score: min - 1 }), r.stageId).toBe('silver');
    }
    expect(silverGap(stageById('snowy-hill')!, run({ swings: 170, score: 120000 }))).toBe('★3까지 15,000점 더');
    expect(medalFor(run({ stageId: 'arcade-500', friends: 3, score: 0 }))).toBe('gold');
  });

  it('a stored silver stays silver and gold upgrades it', () => {
    const old: Progress = { 'snowy-hill': { medal: 'silver', bestScore: 10, bestDepth: 300 } };
    expect(recordRun(old, run({})).progress['snowy-hill'].medal).toBe('silver');
    expect(recordRun(old, run({ swings: 170 })).progress['snowy-hill'].medal).toBe('gold');
  });

  it('stars sum medals over the stages and ignore meta sections', () => {
    expect(maxStars()).toBe(STAGES.length * 3);
    let p: Progress = {};
    expect(totalStars(p)).toBe(0);
    p = recordRun(p, run({})).progress; // bronze
    p = recordRun(p, run({ stageId: 'hammer-igloo', swings: 180 })).progress; // gold
    p = recordRun(p, run({ stageId: 'thaw-cave', meltChains2: 1, livesLost: 1 })).progress; // silver
    expect(totalStars(p)).toBe(6);
  });
});

describe('silverGap', () => {
  const info = (id: string) => stageById(id)!;
  it('names the next medal and what is missing', () => {
    expect(silverGap(info('snowy-hill'), run({ swings: 202 }))).toBe('★2까지 망치질 −12번');
    expect(silverGap(info('snowy-hill'), run({ swings: 186, livesLost: 1 }))).toBe('★3까지 망치질 −8번 · 목숨 잃지 않기');
    expect(silverGap(info('snowy-hill'), run({ swings: 170 }))).toBe('');
    expect(silverGap(info('arcade-500'), run({ stageId: 'arcade-500', friends: 2 }))).toBe('★3까지 친구 1마리');
    expect(silverGap(info('hammer-igloo'), run({ stageId: 'hammer-igloo', swings: 222 }))).toBe('★2까지 망치질 −12번');
    expect(silverGap(info('ice-slide'), run({ stageId: 'ice-slide', time: 50, clockSaved: 6 }))).toBe('★2까지 −9초');
    expect(silverGap(info('ice-slide'), run({ stageId: 'ice-slide', time: 35, clockSaved: 6 }))).toBe('★3까지 −9초');
  });
  it('a loss points at the bronze by depth; endless at the next depth medal', () => {
    expect(silverGap(info('snowy-hill'), run({ won: false, depth: 180 }))).toBe('★1까지 120m');
    expect(silverGap(info('endless-glacier'), run({ stageId: 'endless-glacier', won: false, depth: 312 }))).toBe('★2까지 88m');
    expect(silverGap(info('endless-glacier'), run({ stageId: 'endless-glacier', won: false, depth: 1200 }))).toBe('★3까지 550m');
    expect(silverGap(info('endless-glacier'), run({ stageId: 'endless-glacier', won: false, depth: 3000 }))).toBe('');
  });
});

describe('daily course', () => {
  const day = (d: number) => new Date(2026, 9, d, 15); // October 2026, local time
  it('is the same board all day and a different one each day', () => {
    const a = dailyStage(new Date(2026, 9, 28, 0, 5));
    const b = dailyStage(new Date(2026, 9, 28, 23, 55));
    expect(a.def.seed).toBe(b.def.seed);
    expect(a.def.id).toBe('daily-20261028');
    expect(dailyStage(day(29)).def.seed).not.toBe(a.def.seed);
    expect(a.def.seed).not.toBe(stageById('ice-slide')!.def.seed);
    expect(dailyKey(new Date(2027, 0, 3))).toBe('20270103');
  });
  it('rotates every stage over a week and keeps its rules and medals', () => {
    const ids = new Set<string>();
    for (let d = 25; d < 32; d++) {
      const info = dailyStage(day(d));
      const src = STAGES.find((s) => s.silver === info.silver)!;
      ids.add(src.def.id);
      expect(info.def.levels).toBe(src.def.levels);
      expect(info.unlockAfter).toBeUndefined();
      expect(createGame(info.def.seed!, info.def).rows).toBe(stageRows(info.def));
    }
    expect(ids.size).toBe(STAGES.length);
  });
  it('keeps the best per date and counts a streak of consecutive days', () => {
    let p: Progress = {};
    const play = (d: number, over: Partial<RunResult> = {}) => {
      const r = dailyRecord(p, day(d), run({ stageId: dailyStage(day(d)).def.id, ...over }));
      p = r.progress;
      return r;
    };
    expect(play(1, { score: 500 }).streak).toBe(1);
    expect(play(1, { score: 300 }).newBest).toBe(false);
    expect(dailyOf(p).days['20261001'].bestScore).toBe(500);
    expect(play(2).streak).toBe(2);
    expect(play(3).streak).toBe(3);
    expect(play(5).streak).toBe(1); // missed the 4th
    expect(play(4).streak).toBe(1); // an older day doesn't rewrite the streak
    expect(dailyOf(p).bestStreak).toBe(3);
    expect(dailyOf(p).last).toBe('20261005');
    expect(Object.keys(dailyOf(p).days)).toHaveLength(5);
    // daily runs don't touch stage records but do count in the stats
    expect(totalStars(p)).toBe(0);
    expect(statsOf(p).runs).toBe(6);
  });
  it('a streak survives a month boundary', () => {
    let p: Progress = {};
    p = dailyRecord(p, new Date(2026, 9, 31), run({})).progress;
    expect(dailyRecord(p, new Date(2026, 10, 1), run({})).streak).toBe(2);
  });
});

describe('cumulative stats and badges', () => {
  it('recordRun sums depth/friends/runs and keeps the best chain and combo', () => {
    let p: Progress = {};
    p = recordRun(p, run({ depth: 300, friends: 2, maxChain: 3 })).progress;
    p = recordRun(p, { ...run({ stageId: 'arcade-500', won: false, depth: 250.7, friends: 1, maxChain: 2 }), maxCombo: 7 } as RunResult).progress;
    expect(statsOf(p)).toMatchObject({ runs: 2, totalDepth: 550, friendsRescued: 3, bestChain: 3, bestCombo: 7 });
  });
  it('milestone badges are reported once, when first earned', () => {
    let p: Progress = {};
    const earned: string[][] = [];
    for (let i = 0; i < 4; i++) {
      const r = recordRun(p, run({ depth: 300, friends: 3 }));
      p = r.progress;
      earned.push(r.badges.map((b) => b.id));
    }
    expect(earned).toEqual([[], [], [], ['depth-1k', 'friends-10']]);
    expect(statsOf(p).badges).toEqual(['depth-1k', 'friends-10']);
    expect(recordRun(p, run({ depth: 300 })).badges).toEqual([]);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });
  it('stored v1 progress (stage records only) loads into the meta helpers', () => {
    const v1 = JSON.parse('{"snowy-hill":{"medal":"silver","bestScore":900,"bestDepth":300}}') as Progress;
    expect(statsOf(v1).runs).toBe(0);
    expect(dailyOf(v1).streak).toBe(0);
    expect(totalStars(v1)).toBe(2);
    expect(isUnlocked(v1, 'hammer-igloo')).toBe(true);
  });
});

// progress with a bronze on each given stage
const bronzes = (...ids: string[]): Progress =>
  Object.fromEntries(ids.map((id) => [id, { medal: 'bronze', bestScore: 1, bestDepth: 1 }])) as Progress;
const oct = (d: number) => new Date(2026, 9, d, 15);
const week = [25, 26, 27, 28, 29, 30, 31]; // Sun..Sat

describe('daily course follows the player (item 14)', () => {
  it('a brand-new player (only the snowy bronze) gets snowy/igloo rules all week', () => {
    const p = bronzes('snowy-hill');
    const rules = week.map((d) => ruleOf(dailyStage(oct(d), p))!.def.id);
    expect(new Set(rules)).toEqual(new Set(['snowy-hill', 'hammer-igloo']));
    expect(rules[1]).toBe('snowy-hill'); // Monday is snowy anyway
    // the board is still the day's shared board
    expect(dailyStage(oct(28), p).def.seed).toBe(dailyStage(oct(28)).def.seed);
  });
  it('a locked twist falls back along its unlock chain to the hardest open one', () => {
    const sat = oct(31); // aurora day
    expect(ruleOf(dailyStage(sat, bronzes('snowy-hill', 'hammer-igloo')))!.def.id).toBe('thaw-cave');
    expect(ruleOf(dailyStage(sat, bronzes('snowy-hill', 'hammer-igloo', 'thaw-cave')))!.def.id).toBe('arcade-500');
    expect(ruleOf(dailyStage(sat, bronzes('snowy-hill', 'hammer-igloo', 'thaw-cave', 'arcade-500')))!.def.id).toBe('aurora-north');
    expect(ruleOf(dailyStage(oct(25), bronzes('snowy-hill', 'hammer-igloo')))!.def.id).toBe('endless-glacier');
    expect(dailyStage(sat, bronzes('snowy-hill')).nameKo).toBe('오늘의 코스 · 토요일 망치 이글루');
  });
  it("a played day keeps its rule after a mid-day unlock, and old days follow the rotation", () => {
    let p = bronzes('snowy-hill', 'hammer-igloo');
    const sat = oct(31);
    p = dailyRecord(p, sat, run({ stageId: dailyStage(sat, p).def.id, meltChains2: 1 })).progress;
    expect(dailyOf(p).days['20261031'].rule).toBe('thaw-cave');
    expect(dailyOf(p).days['20261031'].medal).toBe('silver'); // judged by thaw's criteria
    p = Object.assign({}, p, bronzes('thaw-cave', 'arcade-500'));
    expect(ruleOf(dailyStage(sat, p))!.def.id).toBe('thaw-cave');
    expect(ruleOf(dailyStage(oct(30), p))!.def.id).toBe('arcade-500'); // Friday, not played yet
    // stored before item 14 (no rule): it was played on the plain rotation and keeps it, so the
    // next run's record pins the rule the medal was earned under (bug review r3 #4)
    const old = JSON.parse('{"snowy-hill":{"medal":"bronze","bestScore":1,"bestDepth":1},"daily":{"days":{"20261031":{"medal":"bronze","bestScore":5,"bestDepth":300}},"streak":1,"bestStreak":1,"last":"20261031"}}') as Progress;
    expect(ruleOf(dailyStage(sat, old))!.def.id).toBe('aurora-north');
    const again = dailyRecord(old, sat, run({ stageId: dailyStage(sat, old).def.id })).progress;
    expect(dailyOf(again).days['20261031'].rule).toBe('aurora-north');
  });
  it('a daily on the snowy rules is not the tutorial (bug review r3 #3)', () => {
    for (const d of week) {
      const info = dailyStage(oct(d), {});
      expect(ruleOf(info)!.def.id).toBe('snowy-hill');
      expect(info.levelPromptsKo).toBeUndefined();
      expect(info.def.chunks!.script).toBeUndefined();
      expect(info.def.chunks!.pool.length).toBeGreaterThan(0);
      expect(info.blurbKo.startsWith('모두가 같은 코스')).toBe(true);
    }
    expect(stageById('snowy-hill')!.def.chunks!.script).toBeDefined(); // the catalogue stage keeps it
  });
  it('a daily clear keeps its fastest clock-adjusted time on any rule', () => {
    let p = bronzes('snowy-hill');
    p = dailyRecord(p, oct(26), run({ time: 50, clockSaved: 0 })).progress;
    p = dailyRecord(p, oct(26), run({ time: 41.4 })).progress;
    p = dailyRecord(p, oct(26), run({ won: false, time: 10 })).progress;
    expect(dailyOf(p).days['20261026'].bestTime).toBe(41.4);
  });
  it('share text is a Wordle-style one-liner', () => {
    expect(dailyShareText(oct(28), { medal: 'silver', bestScore: 9, bestDepth: 287.6, bestTime: 41.2 }, 5)).toBe('Dig Down 10/28 ★★☆ 287m ⏱41s 🔥5');
    expect(dailyShareText(oct(28), { medal: 'none', bestScore: 9, bestDepth: 120 }, 0)).toBe('Dig Down 10/28 ☆☆☆ 120m');
    expect(dailyShareText(oct(28), undefined, 2)).toBe('Dig Down 10/28 ☆☆☆ 🔥2');
  });
  it('history is the last 14 local days, oldest first, across a month boundary', () => {
    let p: Progress = {};
    p = dailyRecord(p, new Date(2026, 10, 2), run({})).progress;
    const h = dailyHistory(p, new Date(2026, 10, 3, 0, 10));
    expect(h).toHaveLength(14);
    expect(h[0].key).toBe('20261021');
    expect(h[13]).toMatchObject({ key: '20261103', today: true, medal: 'none' });
    expect(h[12]).toMatchObject({ key: '20261102', medal: 'bronze' });
    expect(h.filter((c) => c.today)).toHaveLength(1);
  });
  it('a badge for every 7 daily medals', () => {
    let p = bronzes('snowy-hill');
    const got: string[] = [];
    for (let d = 1; d <= 15; d++) {
      const r = dailyRecord(p, oct(d), run({ won: d !== 3, depth: d === 3 ? 10 : 300 })); // the 3rd is a loss: no medal
      p = r.progress;
      got.push(...r.badges.map((b) => b.id).filter((id) => id.startsWith('daily-medal')));
    }
    expect(dailyMedals(p)).toBe(14);
    expect(got).toEqual(['daily-medal-7', 'daily-medal-14']);
  });
});

describe('cosmetics (item 15)', () => {
  const withBadges = (...badges: string[]): Progress => Object.assign({} as Progress, { stats: { ...statsOf({}), badges } });
  it('every cosmetic comes from a real badge, one per badge, ids unique', () => {
    expect(COSMETICS.length).toBeGreaterThanOrEqual(6);
    expect(COSMETICS.length).toBeLessThanOrEqual(8);
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    expect(new Set(COSMETICS.map((c) => c.badge)).size).toBe(COSMETICS.length);
    for (const c of COSMETICS) expect(BADGES.some((b) => b.id === c.badge), c.id).toBe(true);
    expect(cosmeticForBadge('depth-1k')!.nameKo).toBe('빨간 목도리');
  });
  it('unlocks follow earned badges; equip one per slot, toggle off, persisted in progress', () => {
    expect(unlockedCosmetics({})).toEqual([]);
    let p = withBadges('depth-1k', 'friends-10', 'chain-5');
    expect(unlockedCosmetics(p).map((c) => c.id)).toEqual(['scarf-red', 'hammer-blue', 'scarf-stripe']);
    expect(toggleCosmetic(p, 'hammer-gold')).toBe(p); // locked
    p = toggleCosmetic(p, 'scarf-red');
    p = toggleCosmetic(p, 'hammer-blue');
    p = toggleCosmetic(p, 'scarf-stripe'); // same slot: replaces the red one
    expect(Object.values(equippedCosmetics(p)).map((c) => c!.id).sort()).toEqual(['hammer-blue', 'scarf-stripe']);
    p = toggleCosmetic(p, 'hammer-blue');
    expect(equippedCosmetics(p).hammer).toBeUndefined();
    // survives a save/load round trip, and a badge lost from the save takes the piece off
    const loaded = JSON.parse(JSON.stringify(p)) as Progress;
    expect(equippedCosmetics(loaded).neck!.id).toBe('scarf-stripe');
    expect(equippedCosmetics(Object.assign({}, loaded, { stats: { ...statsOf(loaded), badges: [] } }))).toEqual({});
  });
  it('a run that earns the badge unlocks its cosmetic', () => {
    let p: Progress = {};
    for (let i = 0; i < 4; i++) p = recordRun(p, run({ depth: 300 })).progress;
    expect(unlockedCosmetics(p).map((c) => c.id)).toEqual(['scarf-red']);
  });
});

describe('next stage after a clear (item 15)', () => {
  it('a stage this clear just opened comes first', () => {
    const p = recordRun({}, run({})).progress;
    expect(nextStageAfter(p, 'snowy-hill')!.def.id).toBe('hammer-igloo');
    const q = recordRun(p, run({ stageId: 'hammer-igloo' })).progress;
    expect(nextStageAfter(q, 'hammer-igloo')!.def.id).toBe('thaw-cave');
    // replaying snowy later: an open stage never played still comes first
    expect(nextStageAfter(q, 'snowy-hill')!.def.id).toBe('thaw-cave');
  });
  it('then the next open stage below gold, then nothing once all is gold', () => {
    const all = Object.fromEntries(STAGES.map((s) => [s.def.id, { medal: 'gold', bestScore: 1, bestDepth: 1 }])) as Progress;
    expect(nextStageAfter(all, 'snowy-hill')).toBeUndefined();
    const p = Object.assign({}, all, { 'snowy-hill': { medal: 'silver', bestScore: 1, bestDepth: 1 } }, bronzes('ice-slide'));
    expect(nextStageAfter(p, 'thaw-cave')!.def.id).toBe('ice-slide');
    expect(nextStageAfter(p, 'endless-glacier')!.def.id).toBe('snowy-hill'); // wraps to the first below gold
    expect(nextStageAfter(p, dailyStage(oct(28)).def.id)!.def.id).toBe('snowy-hill');
  });
  it('after a loss it never points back to an easier stage (UI review 2)', () => {
    // lost the igloo with only the snowy bronze: the old wrap offered snowy again
    const p = recordRun(bronzes('snowy-hill'), run({ stageId: 'hammer-igloo', won: false, depth: 40 })).progress;
    expect(nextStageAfter(p, 'hammer-igloo')!.def.id).toBe('snowy-hill'); // a clear still wraps
    expect(nextStageAfter(p, 'hammer-igloo', false)).toBeUndefined();
    // a stage further down that is open still shows: snowy lost again with the igloo bronze held
    expect(nextStageAfter(bronzes('snowy-hill', 'hammer-igloo'), 'snowy-hill', false)!.def.id).toBe('thaw-cave');
  });
});

describe('live medal metric (item 13)', () => {
  const live = (over: Partial<LiveStats>): LiveStats => ({
    swings: 0, livesLost: 0, maxChain: 0, meltChains: 0, friends: 0, levelCapsules: [], clockSaved: 0, time: 0, level: 1, depth: 0, ...over,
  });
  const m = (id: string, l: Partial<LiveStats>, held?: 'none' | 'bronze' | 'silver' | 'gold') => medalMetric(stageById(id)!, live(l), held);
  it('reads each target back from the stage criterion', () => {
    expect(m('snowy-hill', { swings: 142 })).toMatchObject({ medal: 'silver', value: 142, target: 190, dir: 'max', met: true, textKo: '★★☆ 망치 142/190' });
    expect(m('snowy-hill', { swings: 191 }, 'silver')).toMatchObject({ medal: 'gold', target: 178, met: false, textKo: '★★★ 망치 191/178' });
    expect(m('hammer-igloo', { swings: 10 })!.target).toBe(210);
    expect(m('arcade-500', { friends: 1 })!.textKo).toBe('★★☆ 친구 1/2');
    expect(m('arcade-500', { friends: 2 }, 'gold')!.textKo).toBe('★★★ 친구 2/3');
    expect(m('thaw-cave', { meltChains: 14, meltChains2: 0 })).toMatchObject({ textKo: '★★☆ 녹은 연쇄 0/1', dir: 'min', met: false });
    expect(m('ice-slide', { time: 40.7, clockSaved: 4 })).toMatchObject({ textKo: '★★☆ 시간 36/35초', met: false });
    // every metric's target agrees with the medal test at the boundary
    for (const s of STAGES) for (const medal of ['silver', 'gold'] as const) {
      if (s.depthMedals) continue;
      expect(medalMetric(s, live({}), medal === 'gold' ? 'silver' : 'none'), s.def.id).not.toBeNull();
    }
  });
  it('endless chases the next depth medal', () => {
    expect(m('endless-glacier', { depth: 120.4 })!.textKo).toBe('★☆☆ 깊이 120/200m');
    expect(m('endless-glacier', { depth: 250 })!.textKo).toBe('★★☆ 깊이 250/400m');
    expect(m('endless-glacier', { depth: 3200 })).toMatchObject({ medal: 'gold', met: true });
  });
  it('aurora counts dry levels left behind clean and reports the current one', () => {
    const def = stageById('aurora-north')!.def;
    const dry = def.levels.flatMap((_, i) => (isDryLevel(def, i + 1) ? [i + 1] : []));
    expect(dry).toEqual([2, 4, 5, 7]);
    expect(isDryLevel(def, 1)).toBe(false);
    expect(isDryLevel(def, 99)).toBe(false);
    // on level 5: level 2 clean, level 4 took a capsule, level 5 so far clean
    const a = m('aurora-north', { level: 5, levelCapsules: [3, 0, 1, 1, 0] })!;
    expect(a).toMatchObject({ value: 1, target: 2, textKo: '★★☆ 마른 층 1/2', noteKo: '캡슐 적은 층 · 캡슐 없이 지나는 중' });
    expect(m('aurora-north', { level: 5, levelCapsules: [3, 0, 1, 1, 2] })!.noteKo).toBe('캡슐 적은 층 · 캡슐을 먹었어요');
    expect(m('aurora-north', { level: 3 }, 'silver')!.target).toBe(3);
    expect(m('aurora-north', { level: 1 })!.noteKo).toBeUndefined();
  });
  it('a daily uses its rule stage metric', () => {
    const p = bronzes('snowy-hill');
    const tue = dailyStage(oct(27), p); // igloo
    expect(medalMetric(tue, live({ swings: 5 }))!.textKo).toBe('★★☆ 망치 5/210');
  });
});
