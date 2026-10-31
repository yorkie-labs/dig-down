// Stage catalogue (design: tasks/20261028-stages-todo.md). Each stage changes ONE thing on top of
// the base rules so its strategy pattern can be found in isolation. Numbers marked "our tuning"
// have no source in the original series and are calibrated by play.
import {
  AURORA_CHUNKS, ENDLESS_CHUNKS, ICE_CHUNKS, IGLOO_CHUNKS, LAKE_CHUNKS, SNOWY_CHUNKS, THAW_CHUNKS,
} from './chunks';
import { DEFAULT_STAGE, LevelDef, RunStats, StageDef } from './game';
import type { Progress, ProgressMeta } from './progress';

// What a medal test sees: the run's stats plus the outcome.
export type RunCheck = RunStats & { won: boolean; time: number; score?: number };
export interface MedalCriterion {
  textKo: string;
  test: (s: RunCheck) => boolean;
  // what is still missing, e.g. '−12초' or '친구 1마리' (result card: "은메달까지 …"); '' = nothing measurable
  gapKo?: (s: RunCheck) => string;
}

export interface StageInfo {
  def: StageDef;
  nameKo: string;
  blurbKo: string; // one-line rule shown before play (and as the start toast: keep it ~26 chars, UI review 6)
  unlockAfter?: string; // stage id whose bronze unlocks this one
  depthMedals?: [number, number, number]; // endless: bronze/silver/gold by depth reached instead of a clear
  timed?: boolean; // time attack: the record is the fastest (clock-adjusted) clear
  // fixed course version: bump whenever the seeded board changes, so best times set on the old
  // board are dropped (progress.dropStaleTimes). Missing = 1.
  course?: number;
  // Silver = "used the stage's idea". null until calibrated by play (shown as locked).
  silver: MedalCriterion | null;
  // Gold = silver without losing a life, or a harder version of the same idea. Implies silver.
  gold: MedalCriterion | null;
  // Tutorial prompt shown on entering each 100m level (index = level - 1; '' or missing = none).
  levelPromptsKo?: string[];
}

// gap helpers: '' when the condition already holds
const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
const over = (v: number, max: number, fmt: (n: number) => string) => (v > max ? fmt(Math.ceil(v - max - 1e-9)) : '');
const under = (v: number, min: number, fmt: (n: number) => string) => (v < min ? fmt(min - v) : '');
const deathless = (s: RunCheck) => (s.livesLost > 0 ? '목숨 잃지 않기' : '');
const sec = (n: number) => `−${n}초`;
const swingsFmt = (n: number) => `망치질 −${n}번`;
const clockTime = (s: RunCheck) => s.time - s.clockSaved;
const melt2 = (s: RunCheck) => s.meltChains2 ?? 0; // optional on older records
// Gold score riders (round 3 review: every gold was easier for the chain-blind planner, since chasing
// chains costs time and swings and the medals counted those). Score is what chains and combos pay,
// so a gold also asks for one. It is the final score, goal bonuses included (a deathless clear's
// 3 lives are 90k of it). Thresholds: planner 13-20%, chain-blind planner 0-3%, slow 0-5%,
// greedy/careful 0% on every stage (40 seeds, scratch r3/fin). Our tuning.
const scoreOf = (s: RunCheck) => s.score ?? 0;
const scoreGap = (s: RunCheck, min: number) => under(scoreOf(s), min, (n) => `${n.toLocaleString('ko-KR')}점 더`);
const pts = (n: number) => `${n.toLocaleString('ko-KR')}점`;

const base = DEFAULT_STAGE.levels;
const lv = (i: number, over: Partial<LevelDef>): LevelDef => ({ ...base[i], ...over });

// 1. Snowy hill: data only — the base rules with a gentle on-ramp (our tuning; MD2's India 500m
// "Easy" is the precedent for a short beginner course). A three-section tutorial (studio review
// item 12): each 100m brings one lesson through scripted pieces (SNOWY_CHUNKS) and a prompt.
// Level 1 was 2 colours, which left nothing to decide (4 swings, 39m, 95% air in play): now 3.
const snowyHill: StageDef = {
  id: 'snowy-hill',
  levels: [
    lv(0, { colors: 3, xChance: 0.03, airDrain: 1.0, wobble: 1.2, fallSpeed: 6.0 }),
    lv(0, { colors: 3, xChance: 0.05, airDrain: 1.15, wobble: 1.1 }),
    lv(0, { colors: 3, xChance: 0.08, airDrain: 1.32 }),
  ],
  capsuleChance: DEFAULT_STAGE.capsuleChance * 1.2,
  air: { kind: 'time' },
  chunks: SNOWY_CHUNKS,
};

// 3. Thaw cave (studio rebalance, greedy clear 80 seeds: snowy 99% > igloo 81% > thaw 66% > lake 38% >
// aurora 22%): thaw ice (melts once a side is open). Easier air than the arcade so the new
// trick can be learned (review: the arcade is the hardest stage, so it goes last). Our tuning.
const thawCave: StageDef = {
  id: 'thaw-cave',
  levels: [
    // sim v1 (bot clear 25-40%, as hard as the arcade): eased air and X, more capsules
    // studio rebalance (80 seeds): the new chain air + fairness capsules put greedy at 71%; drain
    // x1.2 (was 1.1/1.2/1.32/1.45/1.6) gives 66% (x1.1: 70%). Our tuning.
    // design review 2: chain air step 2 went 8 -> 3, so the x1.2 came off and a bit more
    // (x0.92 of the old base): greedy 60%, careful 70% (x1.0: 57/68; 40 seeds).
    // review 3: key-column pieces ended the free chains and the 1UP went to 150k, and greedy fell
    // to 15%. It dies to X blocks, not drain (16 X breaks = 320% air a run vs 76% drained;
    // drain x0.65 alone: 18%), so X went x0.5 and drain x0.85: greedy 54%, careful 73% (80 seeds).
    lv(0, { colors: 3, xChance: 0.025, airDrain: 0.85, thawChance: 0.06, thawTime: 3.0 }),
    lv(1, { colors: 3, xChance: 0.03, airDrain: 0.94, thawChance: 0.1, thawTime: 2.6 }),
    lv(2, { colors: 4, xChance: 0.04, airDrain: 1.02, thawChance: 0.13, thawTime: 2.2 }),
    lv(3, { colors: 3, xChance: 0.045, airDrain: 1.13, thawChance: 0.16, thawTime: 1.9 }),
    lv(4, { colors: 4, xChance: 0.05, airDrain: 1.25, thawChance: 0.18, thawTime: 1.6 }),
  ],
  capsuleChance: DEFAULT_STAGE.capsuleChance * 1.25,
  air: { kind: 'time' },
  chunks: THAW_CHUNKS, // thaw under same-colour stacks, and a thaw keyhole wall as the boss
};

// 2. Hammer igloo: air is spent per landed swing instead of per second (Dristone / Mr. Driller A
// ~1% per dig, sourced). Time is free, so every board becomes a puzzle you can plan.
// 1.0-1.2% per swing is our tuning.
const hammerIgloo: StageDef = {
  id: 'hammer-igloo',
  levels: [
    // review 3: X x0.6 (was 0.08/0.12/0.16), see air below
    lv(0, { colors: 3, xChance: 0.05 }),
    lv(1, { colors: 4, xChance: 0.07 }),
    lv(2, { colors: 3, xChance: 0.1 }),
  ],
  capsuleChance: DEFAULT_STAGE.capsuleChance,
  // design review: with xBreakAir 0 an X cost ~5% (vs 20% in the arcade), so routing around X
  // stopped mattering; 9% keeps the 'avoid X' decision alive
  // review 2: 9 dropped igloo to 60-65% bot clear (as hard as thaw, and it gates three stages)
  // studio rebalance (80 seeds): chain air [0,8,18,30,45] + fairness capsules took 0.9-1.1% to
  // greedy 92% / planner 100% (gap +8); 1.25-1.45% gives greedy 81% / planner 100% (+19).
  // (1.2-1.4: 84/98, 1.3-1.5: 80; 1.5-1.7: 40 — the cliff is steep.) Swing cost, not X cost, is
  // what rewards a planned route here.
  // design review 2: chain air step 2 went 8 -> 3 (greedy 50% at 20 seeds); 1.0-1.2% gives
  // greedy 75%, careful 83%, planner 100% (40 seeds; 1.05-1.25: 73%).
  // review 3: key-column pieces took half of greedy's chain air (0.31 -> 0.17%/m) and greedy fell
  // to 15%; swing cost x0.65 alone gave 70%. With X x0.6, 0.7-0.9% gives greedy 83%, careful 91%
  // (80 seeds; 0.8-1.0: 71/79). Our tuning.
  // round 3: the re-searched key pieces (the boss's 3-step one now fires for a straight digger too)
  // put greedy at 95%; x1.12 gives greedy 83%, careful 83%, slow 80%, planner 100% (40 seeds).
  air: { kind: 'swing', perSwing: [0.8, 0.9, 1.0], xBreakAir: 6 },
  chunks: IGLOO_CHUNKS, // chain-bait pyramids: time is free, so a planned swing pays
};

// 4. Frozen lake: the arcade 500m as the graduation exam, plus one thing — frozen friends left
// where 4+ X groups pop (MD1 Undergrounder), so herding X blocks near your route pays.
// Design review: points alone made friends ignorable; +10 air per rescue makes herding X groups
// compete with breaking X (-20).
// The id stays DEFAULT_STAGE's 'arcade-500' (saved progress and unlockAfter use it); only the
// levels gain X clustering (xCluster 0.3, our tuning) and the X-pocket pieces.
const frozenLake: StageDef = {
  ...DEFAULT_STAGE,
  // studio rebalance: with the new chain air and fairness capsules the sourced arcade drain let
  // greedy clear 50-60% (40 seeds); drain x1.3 gives greedy 38% / careful 51% / planner 100%
  // (80 seeds). Fewer capsules (x0.55-0.85) or shorter wobble did not move greedy (it dies to
  // lives, refilled at 60%, not to dry spells); 2 lives did (20%) but is coupled to the 100k
  // extend every run reaches now. Our tuning.
  // design review 2: chain air step 2 went 8 -> 3, and the x1.3 went with it: at the sourced
  // drain (x1.15: 30%) greedy clears 35%, careful 33%, planner 100% (40 seeds).
  // review 3: key-column pieces and the 150k 1UP put greedy at 5%. It dies to X breaks (14 a run,
  // 280% air, vs 80% drained), so drain alone did nothing (x0.65: 13%) and more capsules made it
  // worse (more capsule-guard X; x1.4: 0%). X x0.6 with clustering 0.5 (fewer, bigger groups, so
  // friend pops survive the cut) and drain x0.85: greedy 26%, careful 34% (80 seeds), planner 100%
  // (40 seeds; X x0.5 alone: greedy 28% but planner friends p90 2). Our tuning.
  levels: DEFAULT_STAGE.levels.map((l) => ({ ...l, xChance: l.xChance * 0.6, xCluster: 0.5, airDrain: l.airDrain * 0.85 })),
  friends: true,
  friendAir: 10,
  chunks: LAKE_CHUNKS,
};

// 5. Aurora north: the mastery run (MD2's secret "North": unlocked after the others, deliberately
// irregular capsule supply, sourced). 700m on 9 columns; mixes thaw ice back in on some levels.
// The supply multipliers are our tuning.
const auroraNorth: StageDef = {
  id: 'aurora-north',
  // sim v1 (arcade drain + 0.1-0.2 dry levels) cleared 0% for both bots: eased drain and X, and
  // dry levels keep a trickle so chains/thaw drops can carry you through them. X clusters (0.3,
  // our tuning, as on the lake) so friend pops can be herded.
  // studio rebalance (80 seeds): greedy 26% after the new chain air; drain x1.2 (was 1.32/1.4/
  // 1.5/1.55/1.6/1.7/1.8) gives 22% (x1.1: 25%). Our tuning.
  // design review 2: chain air step 2 went 8 -> 3 (greedy 0% at 20 seeds); back to the old base
  // x0.92 plus the walled capsule shelf: greedy 15%, careful 10% (40 seeds). Drain barely moves
  // it (x1.0 and x0.92 both 8% before the shelf fix): aurora deaths are crushes and dry spells.
  // review 3: greedy 5% after key-column pieces and the 150k 1UP, dying to X breaks as on the
  // lake; X x0.6 and drain x0.9: greedy 15%, careful 14% (80 seeds; X x0.7 alone: 5%). Our tuning.
  levels: [
    lv(0, { colors: 4, xChance: 0.036, airDrain: 1.08, capsuleMul: 1.2 }),
    lv(1, { colors: 3, xChance: 0.048, airDrain: 1.15, capsuleMul: 0.4 }),
    lv(2, { colors: 4, xChance: 0.06, airDrain: 1.23, capsuleMul: 2.5, thawChance: 0.12, thawTime: 2.2 }),
    lv(3, { colors: 3, xChance: 0.066, airDrain: 1.28, capsuleMul: 0.45, thawChance: 0.14, thawTime: 1.9 }),
    lv(4, { colors: 4, xChance: 0.072, airDrain: 1.32, capsuleMul: 0.35 }),
    lv(4, { colors: 4, xChance: 0.078, airDrain: 1.4, capsuleMul: 3.0, thawChance: 0.16, thawTime: 1.7 }),
    lv(4, { colors: 3, xChance: 0.084, airDrain: 1.49, capsuleMul: 0.4, thawChance: 0.16, thawTime: 1.6 }),
  ].map((l) => ({ ...l, xCluster: 0.3 })),
  // sim v2 5-8% → ×1.3 + cap 150 made it easier than the lake (review 2); now ×1.15 + cap 125
  capsuleChance: DEFAULT_STAGE.capsuleChance * 1.15,
  air: { kind: 'time' },
  friends: true,
  friendAir: 10,
  chunks: AURORA_CHUNKS, // capsule shelves before each dry level
  // design review: capped at 100 a rich level can't be banked for a dry one; 150 makes "stock up
  // before the drought" a playable pattern
  airCap: 125,
};

// Ice slide: Time Attack on a FIXED course (MD1 console Time Attack: no air, clocks cut the
// time, sourced). Same board every run, so routes can be learned and shaved — the clearest
// "find the pattern" stage (design review's top pick). Seed and numbers are our choice.
const iceSlide: StageDef = {
  id: 'ice-slide',
  levels: [
    lv(0, { colors: 3, xChance: 0.06 }),
    lv(1, { colors: 4, xChance: 0.09 }),
    lv(2, { colors: 3, xChance: 0.12 }),
  ],
  capsuleChance: DEFAULT_STAGE.capsuleChance * 1.5,
  air: { kind: 'none' },
  clocks: 2, // review 2: at 3s clocks cut ~60% of the run, so collecting dominated the route
  seed: 20261028,
  chunks: ICE_CHUNKS, // clocks on ledges under stacks: grab one and step back out
};

// Endless glacier: survival (MD1 console Survival: endless, sourced). Levels are generated on the
// fly and keep getting harder; thaw ice joins on odd levels from 3. Two lives until calibrated
// (review advice). Ramp numbers are our tuning.
// Review 3 item 17: the planner reached the 1500m calibration cap in 70-90% of runs (uncapped
// median ~2.6 km). Its air is mostly chain air (~600% a run vs ~340% from capsules), and the
// fairness guard hands out capsules faster as drain rises, so a steeper drain alone barely moved it
// (cap 3.0: median ~1.5 km). Cutting the 2-colour level (chain air for free) and a faster X and
// drain ramp did: uncapped planner median ~1020m, 5 of 40 runs past 1500m (40 seeds). Past 1300m
// (ENDLESS_DEEP) the drain cap steps to 3.2 and X to 0.3, and capsules fall x0.93 per 100m to
// 0.6 (x0.97: median 960m but 10 of 40 past 1500m). Our tuning.
const ENDLESS_COLORS = [4, 3, 4, 4, 4];
const ENDLESS_DEEP = 13;
const endlessLevel = (n: number): LevelDef => {
  const deep = n > ENDLESS_DEEP;
  return {
    colors: ENDLESS_COLORS[(n - 1) % ENDLESS_COLORS.length],
    xChance: Math.min(deep ? 0.3 : 0.25, 0.06 + 0.025 * n),
    capsuleGuard: Math.min(0.9, 0.2 * (n - 1)),
    capsuleMul: Math.max(0.6, 0.93 ** (n - 1)),
    airDrain: Math.min(deep ? 3.2 : 2.6, 1.3 + 0.2 * (n - 1)),
    wobble: Math.max(0.45, 1.0 - 0.05 * (n - 1)),
    fallSpeed: Math.min(14, 6.667 + 0.6 * (n - 1)),
    ...(n >= 3 && n % 2 === 1 ? { thawChance: 0.12, thawTime: 2.0 } : {}),
  };
};
const endlessGlacier: StageDef = {
  id: 'endless-glacier',
  levels: [endlessLevel(1)],
  endless: endlessLevel,
  capsuleChance: DEFAULT_STAGE.capsuleChance,
  air: { kind: 'time' },
  lives: 2,
  chunks: ENDLESS_CHUNKS,
};

// aurora's dry levels (capsuleMul < 1, index = level - 1) and how many of them a run crossed
// without taking a capsule (levelCapsules is grown lazily: a missing entry is 0)
const AURORA_DRY = auroraNorth.levels.flatMap((l, i) => ((l.capsuleMul ?? 1) < 1 ? [i] : []));
const AURORA_DRY_SILVER = 2;
const AURORA_DRY_GOLD = 3; // of the 4: all four was 0% of planner runs (design review 2)
const dryClean = (s: RunCheck) => AURORA_DRY.filter((i) => (s.levelCapsules[i] ?? 0) === 0).length;

export const STAGES: StageInfo[] = [
  {
    def: snowyHill,
    nameKo: '눈송이 언덕',
    blurbKo: '300m · 연습 코스 · 흔들리는 블록을 피해요',
    // studio rebalance (40 seeds): the old 50s limit was met by 98% of greedy runs (bots are
    // fastest when they dig blindly; the planner takes ~45s). Swings separate instead: let pops
    // and falls dig for you. ≤190 swings: greedy 7.5%, careful 7.5%, planner 58% (our tuning).
    // design review 2 (chain air step 2 = 3, tighter combo; 40 seeds): greedy/careful 7.5%, planner 60%
    // review 3 (key-column pieces; 40 seeds): greedy/careful 2.5%, slow 17.5%, planner 45% — kept
    // round 3 (re-searched key pieces; 40 seeds): greedy/careful 5%, slow 43%, planner 68% — kept
    silver: {
      textKo: '망치질 190번 이하로 클리어',
      test: (s) => s.won && s.swings <= 190,
      gapKo: (s) => over(s.swings, 190, swingsFmt),
    },
    // tutorial sections (studio review item 12), one per 100m in the order the pieces teach them
    levelPromptsKo: [
      '망치로 아래를 파요. 같은 색 블록이 4개 이상 붙으면 터져요!',
      '흔들리는 블록은 곧 떨어져요. 옆으로 비켜서 피하세요!',
      'X 블록은 단단하고 공기를 많이 써요. 돌아가고, 막힌 캡슐은 위에서 파서 먹어요.',
    ],
    // studio rebalance (40 seeds): planner p10 is 175 swings; ≤172 + no life lost is 2.5% of
    // planner runs and 0% of greedy/careful, a human-expert target (our tuning)
    // design review 2 (40 seeds): planner 10%, greedy/careful 0%
    // review 3 (40 seeds): ≤172 fell to planner 2.5%; ≤178 + no life lost is planner 5%,
    // chain-blind planner 25%, greedy/careful/slow 0%
    // round 3 (re-searched key pieces, key-aware planner; 40 seeds): ≤178 + no life lost was
    // planner 18%, chain-blind planner 30%; + 135k: planner 20%, chain-blind 3%, others 0%
    gold: {
      textKo: `망치질 178번 이하 + ${pts(135000)} 이상 + 목숨을 잃지 않고 클리어`,
      test: (s) => s.won && s.swings <= 178 && scoreOf(s) >= 135000 && s.livesLost === 0,
      gapKo: (s) => join(over(s.swings, 178, swingsFmt), scoreGap(s, 135000), deathless(s)),
    },
  },
  {
    def: hammerIgloo,
    nameKo: '망치 이글루',
    blurbKo: '300m · 공기는 시간 말고 망치질에 줄어요',
    unlockAfter: 'snowy-hill',
    // sim: winning bot runs use ~235 swings (p10 ~212); silver = beat ~90% of bot clears
    // studio rebalance (40 seeds, 1.25-1.45%/swing): greedy clears use 217+ swings (0% silver),
    // careful 0%, planner 80% (median 198) — kept at 210
    // review 3 (0.7-0.9%/swing, 40 seeds): greedy/careful 0%, slow 2.5%, planner 22.5% — kept
    // round 3 (0.8-1.0%/swing, 40 seeds): greedy/careful 0%, slow 28%, planner 73% — kept
    silver: {
      textKo: '망치질 210번 이하로 클리어',
      test: (s) => s.won && s.swings <= 210,
      gapKo: (s) => over(s.swings, 210, swingsFmt),
    },
    // studio rebalance: silver + deathless was 73% of planner runs; ≤178 swings + no life lost is
    // 5% (planner p10 184), 0% for greedy/careful (our tuning)
    // design review 2 (40 seeds, 1.0-1.2%/swing): gold was out of reach for every bot at 20 seeds;
    // ≤180 + no life lost is planner 10% (p10 181), greedy/careful 0%. Silver ≤210: planner 85%,
    // greedy/careful 0%.
    // review 3 (40 seeds): planner swings p10 206, so ≤180 was 0%; ≤205 + no life lost is planner
    // 10%, slow 2.5%, greedy/careful 0% (our tuning)
    // round 3 (40 seeds): planner 40%, chain-blind planner 65%; + 145k: planner 15%, every other
    // bot 0%
    gold: {
      textKo: `망치질 205번 이하 + ${pts(145000)} 이상 + 목숨을 잃지 않고 클리어`,
      test: (s) => s.won && s.swings <= 205 && scoreOf(s) >= 145000 && s.livesLost === 0,
      gapKo: (s) => join(over(s.swings, 205, swingsFmt), scoreGap(s, 145000), deathless(s)),
    },
  },
  {
    def: thawCave,
    nameKo: '녹는 얼음 동굴',
    blurbKo: '500m · 옆이 빈 얇은 얼음은 녹아요 · 연쇄!',
    unlockAfter: 'hammer-igloo',
    // studio rebalance (40 seeds): thaw under stacks gives every bot ~22 melt pops (median of
    // clears, greedy and planner alike), so 30 alone was luck (greedy 7.5%, planner 2.5%). Melt
    // pops while staying alive is what timing buys: ≥23 + at most one life lost is greedy 0%,
    // careful 5%, planner 45% (our tuning).
    // design review 2 (40 seeds): the planner now melts fewer (median 19) and ≥23 + ≤1 life fell
    // to planner 17.5%; ≥22 is greedy 2.5%, careful 5%, planner 27.5%
    // review 3 item 16: every melt pop counted, so the number was mostly thaw happening to bots.
    // Now only melt chains whose cascade reaches step 2 (stats.meltChains2) count: a won run
    // makes 0-3 (median 1 for every bot, 40 seeds). ≥1 + at most one life lost: greedy 7.5%,
    // careful 20%, slow 50%, planner 47.5% (our tuning).
    // round 3 (40 seeds): greedy 15%, careful 20%, slow 63%, planner 55% — kept
    silver: {
      textKo: '2단 이상 이어진 녹은 연쇄 1번 + 목숨을 1개 이하로 잃고 클리어',
      test: (s) => s.won && melt2(s) >= 1 && s.livesLost <= 1,
      gapKo: (s) => join(under(melt2(s), 1, (n) => `녹은 연쇄 ${n}번`), over(s.livesLost, 1, (n) => `목숨 ${n}개 덜 잃기`)),
    },
    // review 3: ≥2 + no life lost is planner 7.5%, slow 10%, careful 5%, greedy 0% (our tuning)
    // round 3 (40 seeds): planner 28%, chain-blind planner 23%; + 150k: planner 13%, slow 5%,
    // others 0%
    gold: {
      textKo: `2단 이상 이어진 녹은 연쇄 2번 + ${pts(150000)} 이상 + 목숨을 잃지 않고 클리어`,
      test: (s) => s.won && melt2(s) >= 2 && scoreOf(s) >= 150000 && s.livesLost === 0,
      gapKo: (s) => join(under(melt2(s), 2, (n) => `녹은 연쇄 ${n}번`), scoreGap(s, 150000), deathless(s)),
    },
  },
  {
    def: frozenLake,
    nameKo: '얼어붙은 호수',
    blurbKo: '500m · X 블록 4개를 터뜨려 얼음 친구 구출',
    unlockAfter: 'thaw-cave',
    // sim: bots reach 2+ chains by accident (median 3), so silver asks for the stage's own idea
    // studio rebalance (item 11, 40 seeds, X clusters + x1.3 drain): 3 friends is greedy 5%,
    // careful 0%, planner 35% (4: planner 17.5%) — kept at 3
    // review 3 (X x0.6 in clusters of 0.5, friend-aware planner; 40 seeds): friends got scarce
    // (planner p90 2), so 3 fell to planner 7.5%; 2 is greedy/careful 2.5%, slow 25%, planner 17.5%
    // round 3 (8-piece pool, 40 seeds): greedy 0%, careful 8%, slow 10%, planner 25% — kept
    silver: {
      textKo: '얼음 친구 2마리 구출 + 클리어',
      test: (s) => s.won && s.friends >= 2,
      gapKo: (s) => under(s.friends, 2, (n) => `친구 ${n}마리`),
    },
    // sim: bot clears rescue at most 3 and none is deathless (arcade air), so gold asks for more
    // herding rather than a deathless arcade run (our tuning)
    // studio rebalance: 5 friends is 5% of planner runs, 0% of greedy/careful
    // design review 2 (40 seeds, sourced arcade drain): 3 friends is greedy 5%, careful 7.5%,
    // planner 25%; 4 and 5 are both planner 2.5%. The planner never aims for friends (its rollout
    // scores chains and air only), and each X pocket piece hands an aiming player one, so 4 is
    // the gold (our tuning)
    // review 3 (40 seeds): 4 is 0% for every planner; 3 is planner 7.5%, slow 12.5%, greedy/careful
    // 2.5% (one seed each). Round 3 (40 seeds): planner 8%, every other bot 0% — kept
    gold: {
      textKo: '얼음 친구 3마리 구출 + 클리어',
      test: (s) => s.won && s.friends >= 3,
      gapKo: (s) => under(s.friends, 3, (n) => `친구 ${n}마리`),
    },
  },
  {
    def: auroraNorth,
    nameKo: '오로라 북극',
    blurbKo: '700m · 층마다 캡슐이 달라요 · 공기 관리!',
    unlockAfter: 'arcade-500',
    // studio rebalance (item 11, 40 seeds): silver now asks for the stage's idea, banking air on
    // the rich levels (cap 125) to cross dry ones. Dry levels still get fairness-guard capsules,
    // so crossing one without taking any means you arrived stocked. 2 dry levels capsule-free +
    // at most one life lost: greedy 5%, careful 2.5%, planner 50% (lives ≤1 alone: planner 90%).
    // round 3 (40 seeds): greedy 3%, careful 0%, slow 28%, planner 58% — kept
    silver: {
      textKo: `캡슐 적은 층 ${AURORA_DRY_SILVER}개를 캡슐 없이 통과 + 목숨을 1개 이하로 잃고 클리어`,
      test: (s) => s.won && dryClean(s) >= AURORA_DRY_SILVER && s.livesLost <= 1,
      gapKo: (s) => join(under(dryClean(s), AURORA_DRY_SILVER, (n) => `캡슐 없이 지날 층 ${n}개`), over(s.livesLost, 1, (n) => `목숨 ${n}개 덜 잃기`)),
    },
    // all dry levels capsule-free + no life lost: planner 2.5%, greedy/careful 0% (deathless alone
    // was planner 60%). Our tuning.
    // design review 2 (40 seeds): silver is planner 40%, greedy/careful 0%; all four dry levels
    // clean was 0% even for the planner, three of four + no life lost is planner 10%
    // review 3 (X x0.6, drain x0.9; 40 seeds): silver greedy/careful 2.5%, slow 27.5%, planner 55%;
    // gold planner 12.5%, others 0% (all four: planner 0%) — both kept
    // round 3 (40 seeds): planner 10%, chain-blind planner 35%; + 190k: planner 18%, every other
    // bot 0%
    gold: {
      textKo: `캡슐 적은 층 ${AURORA_DRY_GOLD}개를 캡슐 없이 통과 + ${pts(190000)} 이상 + 목숨을 잃지 않고 클리어`,
      test: (s) => s.won && dryClean(s) >= AURORA_DRY_GOLD && scoreOf(s) >= 190000 && s.livesLost === 0,
      gapKo: (s) => join(under(dryClean(s), AURORA_DRY_GOLD, (n) => `캡슐 없이 지날 층 ${n}개`), scoreGap(s, 190000), deathless(s)),
    },
  },
  {
    def: iceSlide,
    nameKo: '얼음 미끄럼틀 (타임어택)',
    blurbKo: '300m · 공기 없음 · 시계 -2초 · 최단 기록!',
    unlockAfter: 'hammer-igloo',
    timed: true,
    // 2: the authored pieces (ICE_CHUNKS) were stamped into the 20261028 board; 3: review 3's
    // piece bag and mirroring changed that board again; 4: round 3's re-searched key pieces
    course: 4,
    // calibrated on the shipped seed (review 2): bots clear in 32-37s clock-adjusted; silver = 1.5x
    // the bot's best as a human par time (the earlier 25s, measured on random seeds, was impossible)
    // studio rebalance (shipped seed, with the authored pieces): greedy 38.4s, planner 30.3s,
    // careful 24.8s. 48s let every bot through; 35s fails greedy and passes the route-readers
    // review 3 (course 3): 35s still fails greedy, careful and slow and passes both planners
    // round 3 (course 4): greedy 37.4s, careful 37.0s, slow 42.7s, planner 30.6s, chain-blind
    // planner 22.4s — kept
    silver: {
      textKo: '시계 반영 35초 이내 클리어',
      test: (s) => s.won && clockTime(s) <= 35,
      gapKo: (s) => over(clockTime(s), 35, sec),
    },
    // design review 2: careful (24.8s) also passes; kept, since silver is the par for having
    // learned the route and careful's run is one lucky line on the one course
    // gold was 28s, which the careful bot beat by 3s; now under every bot (best 24.8s), so it takes
    // a route shaved past what any bot finds (our tuning)
    // review 3 (course 3): greedy 43.7s, careful 40.3s, slow 37.2s, planner 33.7s, chain-blind
    // planner 24.2s; gold = 0.9x the best bot run (21.8s), rounded to 22s: no bot (our tuning)
    // round 3 (course 4): best bot 22.4s, so 0.9x is 20s
    gold: {
      textKo: '시계 반영 20초 이내 클리어',
      test: (s) => s.won && clockTime(s) <= 20,
      gapKo: (s) => over(clockTime(s), 20, sec),
    },
  },
  {
    def: endlessGlacier,
    nameKo: '끝없는 빙하',
    blurbKo: '끝없음 · 목숨 2개로 얼마나 깊이 갈까요?',
    unlockAfter: 'hammer-igloo',
    // studio rebalance (40 seeds): greedy median 364m (p90 503, max 526), careful max 582,
    // planner capped at 1500m every run and uncapped median 2282m (p90 4664, max 5582).
    // Bronze 300 = 68% of greedy; silver 600 = 0% greedy/careful, 100% planner; gold 5000 = 2.5%
    // of uncapped planner runs (~14 min of play; our tuning). The ramp is flat past ~1200m
    // (drain/fall/X caps), so the deep end is a stamina test.
    // design review 2 (chain air step 2 = 3, drain base 1.32 -> 1.2; 40 seeds): bronze 300 = greedy
    // 55% / careful 52.5%, silver 600 = 0% / 0% / planner 100%; uncapped planner median ~1700m
    // (max 4697), so 5000 was out of reach: gold 3000 = 7.5% of planner runs, ~9 min (our tuning)
    // review 3 (new ramp, 40 seeds, uncapped): greedy median 236m (max 376), careful max 418,
    // slow planner median 532m, planner median ~1020m (p90 ~1580, max 1905). Bronze 200 = greedy
    // 65%; silver 400 = greedy 0%, careful 2.5%, slow 80%, planner 100%; gold 1750 = planner
    // 7.5%, chain-blind planner 7.5% (our tuning).
    depthMedals: [200, 400, 1750],
    // medals come from depthMedals; these carry only the text
    silver: { textKo: '400m 도달', test: () => false },
    gold: { textKo: '1750m 도달', test: () => false },
  },
];

export const stageById = (id: string) => STAGES.find((s) => s.def.id === id);
export const stageDepth = (def: StageDef) => def.levels.length * 100;

// ---------- daily course ----------
// One fixed board per calendar day (local date) so every player races the same course. The rule
// twist rotates by weekday over the existing stages, easy early in the week and the hard ones on
// the weekend; medals reuse that stage's criteria (calibrated on random seeds, so a day can read
// a little easier or harder). Rotation and seed mixing are our choice.
const DAILY_ROTATION = ['endless-glacier', 'snowy-hill', 'hammer-igloo', 'thaw-cave', 'ice-slide', 'arcade-500', 'aurora-north'];
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export const dailyKey = (date: Date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
export const isDailyId = (id: string) => id.startsWith('daily-');

// A stage is open once the stage it unlocks after has any medal (progress.isUnlocked delegates
// here, so the daily and the stage list can't disagree).
export function stageOpen(p: Progress, stageId: string): boolean {
  const info = stageById(stageId);
  if (!info) return false;
  return !info.unlockAfter || (p[info.unlockAfter]?.medal ?? 'none') !== 'none';
}

// The rule a player gets on a weekday (studio review 2 item 14): a twist they haven't unlocked
// falls back along its unlock chain to the hardest one they have (each stage's prerequisite is
// the easier one), so a new player with only the snowy bronze gets snowy/igloo all week. Once a
// day is played its rule is pinned in the daily book, so unlocking a stage mid-day doesn't swap
// the course under the day's record.
// A day recorded before item 14 has no rule: it was played on the plain rotation, so it keeps that
// (the fallback would pin a different rule under the medal it earned).
function dailyRuleId(date: Date, p?: Progress): string {
  const day = (p as ProgressMeta | undefined)?.daily?.days[dailyKey(date)];
  if (day?.rule && stageById(day.rule)) return day.rule;
  let id = DAILY_ROTATION[date.getDay()];
  if (!p || day) return id;
  while (!stageOpen(p, id)) id = stageById(id)!.unlockAfter!; // the first stage is always open
  return id;
}

// progress omitted: the plain weekday rotation (every rule, as before item 14)
export function dailyStage(date: Date, progress?: Progress): StageInfo {
  const key = dailyKey(date);
  const src = stageById(dailyRuleId(date, progress))!;
  // scramble yyyymmdd so neighbouring days (and the ice slide's 20261028) don't share a board
  let h = Math.imul(Number(key) ^ 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  const seed = (h ^ (h >>> 13)) >>> 0;
  return {
    ...src,
    // not the tutorial: a new player's every daily falls back to the snowy hill, and its script and
    // prompts would replay the same lesson each day (and make the renderer treat it as the tutorial)
    def: { ...src.def, id: `daily-${key}`, seed, chunks: src.def.chunks && { ...src.def.chunks, script: undefined } },
    levelPromptsKo: undefined,
    nameKo: `오늘의 코스 · ${WEEKDAY_KO[date.getDay()]}요일 ${src.nameKo}`,
    blurbKo: `모두가 같은 코스 · ${src.blurbKo}`,
    unlockAfter: undefined,
  };
}

// The catalogue stage whose rules a StageInfo plays (a daily shares its source's levels array).
export const ruleOf = (info: StageInfo): StageInfo | undefined =>
  stageById(info.def.id) ?? STAGES.find((s) => s.def.levels === info.def.levels);

// ---------- meta helpers ----------
// A dry level (aurora: capsule supply cut, capsuleMul < 1); level is 1-based.
export const isDryLevel = (def: StageDef, level: number) => (def.levels[level - 1]?.capsuleMul ?? 1) < 1;
