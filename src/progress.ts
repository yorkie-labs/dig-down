// Per-stage progress: medals, best score/depth and unlocks, plus the meta layer (daily course,
// cumulative stats, badges). The core is pure (tested); storage is a thin try/catch wrapper so a
// blocked localStorage never breaks the game.
import { RunStats } from './game';
import { dailyKey, dailyStage, isDryLevel, MedalCriterion, ruleOf, RunCheck, stageOpen, STAGES, StageInfo, stageById, stageDepth } from './stages';

export type Medal = 'none' | 'bronze' | 'silver' | 'gold';
// course: StageInfo.course the bestTime was set on (a fixed course whose board changed drops it)
export interface StageRecord { medal: Medal; bestScore: number; bestDepth: number; bestTime?: number; course?: number }
export interface MetaStats {
  runs: number;
  totalDepth: number; // metres, summed over every recorded run
  friendsRescued: number;
  bestCombo: number; // action combo (RunStats.maxCombo once the rules have it)
  bestChain: number;
  badges: string[]; // earned badge ids
}
// rule: the stage id whose rules that day was played with (dailyStage pins it; missing on days
// stored before item 14, which then follow the plain rotation). bestTime on a daily is the fastest
// clock-adjusted clear of any rule (the share text shows it), not only time attack.
export interface DailyDay extends StageRecord { rule?: string }
export interface DailyBook {
  days: Record<string, DailyDay>; // yyyymmdd -> best of that day
  last?: string; // yyyymmdd of the latest day played
  streak: number; // consecutive days played, ending at `last`
  bestStreak: number;
}
export type CosmeticSlot = 'neck' | 'head' | 'face' | 'hammer';
export interface CosmeticState { equipped: Partial<Record<CosmeticSlot, string>> } // slot -> cosmetic id
export interface ProgressMeta { daily?: DailyBook; stats?: MetaStats; cosmetics?: CosmeticState }
// Stage records stay at the top level (stored v1 data loads as is); the meta sections live beside
// them under keys no stage uses. Read them with statsOf / dailyOf.
export type Progress = Record<string, StageRecord> & ProgressMeta;
export interface RunResult extends RunStats { stageId: string; won: boolean; score: number; depth: number; time: number }

const RANK: Medal[] = ['none', 'bronze', 'silver', 'gold'];
const better = (a: Medal, b: Medal) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);
export const medalStars = (m: Medal | undefined) => Math.max(0, RANK.indexOf(m ?? 'none'));
const MEDAL_KO: Record<Medal, string> = { none: '', bronze: '★1', silver: '★2', gold: '★3' }; // stars are the on-screen medal names

export function medalFor(r: RunResult, info: StageInfo | undefined = stageById(r.stageId)): Medal {
  if (info?.depthMedals) {
    const i = info.depthMedals.filter((d) => r.depth >= d).length;
    return RANK[i];
  }
  if (!r.won) return 'none';
  if (info?.gold?.test(r)) return 'gold';
  return info?.silver?.test(r) ? 'silver' : 'bronze';
}

// ★ per stage: bronze 1, silver 2, gold 3. Daily runs don't count (they have their own book).
export const totalStars = (p: Progress) => STAGES.reduce((n, s) => n + medalStars(p[s.def.id]?.medal), 0);
export const maxStars = () => STAGES.length * 3;

// Result card line: how far this run was from the next medal, '' when there is none to chase.
export function silverGap(info: StageInfo, r: RunResult): string {
  const medal = medalFor(r, info);
  if (medal === 'gold') return '';
  const next = RANK[RANK.indexOf(medal) + 1];
  if (info.depthMedals) return `${MEDAL_KO[next]}까지 ${Math.ceil(info.depthMedals[RANK.indexOf(medal)] - r.depth)}m`;
  if (!r.won) return `${MEDAL_KO.bronze}까지 ${Math.max(1, Math.ceil(stageDepth(info.def) - r.depth))}m`;
  const crit: MedalCriterion | null = medal === 'bronze' ? info.silver : info.gold;
  if (!crit) return '';
  return `${MEDAL_KO[next]}까지 ${crit.gapKo?.(r) || crit.textKo}`;
}

export const isUnlocked = (p: Progress, stageId: string): boolean => stageOpen(p, stageId);

// ---------- meta ----------

export const statsOf = (p: Progress): MetaStats =>
  (p as ProgressMeta).stats ?? { runs: 0, totalDepth: 0, friendsRescued: 0, bestCombo: 0, bestChain: 0, badges: [] };
export const dailyOf = (p: Progress): DailyBook => (p as ProgressMeta).daily ?? { days: {}, streak: 0, bestStreak: 0 };

// days of the daily course that earned a medal
export const dailyMedals = (p: Progress) => Object.values(dailyOf(p).days).filter((d) => d.medal !== 'none').length;
// one badge per 7 daily medals, up to four weeks' worth (our choice)
const DAILY_MEDAL_TIERS = [7, 14, 21, 28];

export interface Badge { id: string; nameKo: string; descKo: string; test: (p: Progress) => boolean }
// Milestones for the collection screen. Thresholds are our choice: 1km ≈ 3 snowy clears, 10km is a
// long-term goal; friends only come from the lake and aurora (bots rescue 0-3 per clear).
export const BADGES: Badge[] = [
  { id: 'depth-1k', nameKo: '첫 1km', descKo: '누적 1,000m 파기', test: (p) => statsOf(p).totalDepth >= 1000 },
  { id: 'depth-5k', nameKo: '5km 굴착꾼', descKo: '누적 5,000m 파기', test: (p) => statsOf(p).totalDepth >= 5000 },
  { id: 'depth-10k', nameKo: '10km 빙하 탐험가', descKo: '누적 10,000m 파기', test: (p) => statsOf(p).totalDepth >= 10000 },
  { id: 'friends-10', nameKo: '친구 10마리', descKo: '얼음 친구 누적 10마리 구출', test: (p) => statsOf(p).friendsRescued >= 10 },
  { id: 'friends-50', nameKo: '친구 50마리', descKo: '얼음 친구 누적 50마리 구출', test: (p) => statsOf(p).friendsRescued >= 50 },
  { id: 'chain-5', nameKo: '5연쇄', descKo: '한 판에 5연쇄 달성', test: (p) => statsOf(p).bestChain >= 5 },
  { id: 'streak-3', nameKo: '사흘 연속', descKo: '오늘의 코스 3일 연속 도전', test: (p) => dailyOf(p).bestStreak >= 3 },
  { id: 'streak-7', nameKo: '일주일 연속', descKo: '오늘의 코스 7일 연속 도전', test: (p) => dailyOf(p).bestStreak >= 7 },
  ...DAILY_MEDAL_TIERS.map((n): Badge => ({
    id: `daily-medal-${n}`, nameKo: `오늘의 별 ${n}번`, descKo: `오늘의 코스에서 별을 ${n}번 따기`, test: (p) => dailyMedals(p) >= n,
  })),
  { id: 'all-gold', nameKo: '별 전부', descKo: '모든 스테이지 ★★★', test: (p) => totalStars(p) === maxStars() },
];

// Adds one run to the cumulative stats and returns the badges it newly earned.
function addRun(p: Progress, r: RunResult): { progress: Progress; badges: Badge[] } {
  const s = statsOf(p);
  // maxCombo may not exist on RunStats yet (rules agent), so read it defensively
  const combo = (r as { maxCombo?: number }).maxCombo ?? 0;
  const stats: MetaStats = {
    runs: s.runs + 1,
    totalDepth: s.totalDepth + Math.max(0, Math.floor(r.depth)),
    friendsRescued: s.friendsRescued + r.friends,
    bestCombo: Math.max(s.bestCombo, combo),
    bestChain: Math.max(s.bestChain, r.maxChain),
    badges: s.badges,
  };
  let progress: Progress = Object.assign({}, p, { stats });
  const badges = BADGES.filter((b) => !s.badges.includes(b.id) && b.test(progress));
  if (badges.length) progress = Object.assign({}, progress, { stats: { ...stats, badges: [...s.badges, ...badges.map((b) => b.id)] } });
  return { progress, badges };
}

// A best time only counts on the board it was set on: one from an older version of a fixed
// course is dropped (the medal stays, it was earned under that course's rules).
const timeOf = (rec: StageRecord | undefined, info: StageInfo | undefined) =>
  rec?.bestTime !== undefined && (rec.course ?? 1) === (info?.course ?? 1) ? rec.bestTime : undefined;

// anyClear: keep the fastest clear on every rule (the daily's share text), not only time attack
function bestOf(old: StageRecord | undefined, r: RunResult, medal: Medal, info: StageInfo | undefined, anyClear = false): StageRecord {
  const o = old ?? { medal: 'none', bestScore: 0, bestDepth: 0 };
  const rec: StageRecord = {
    medal: better(o.medal, medal),
    bestScore: Math.max(o.bestScore, r.score),
    bestDepth: Math.max(o.bestDepth, r.depth),
  };
  // time attack: fastest clock-adjusted clear
  const t = r.time - (r.clockSaved ?? 0);
  const oldTime = timeOf(o, info);
  if (r.won && (info?.timed || anyClear)) rec.bestTime = Math.min(oldTime ?? Infinity, t);
  else if (oldTime !== undefined) rec.bestTime = oldTime;
  if (rec.bestTime !== undefined && info?.course) rec.course = info.course;
  return rec;
}

// On load: drop best times set on an older board of a fixed course (bug review 9: the ice slide
// gained authored pieces, so its seed builds a different course and old records may be unbeatable).
export function dropStaleTimes(p: Progress): Progress {
  let out = p;
  for (const info of STAGES) {
    const rec = p[info.def.id];
    if (!rec || rec.bestTime === undefined || timeOf(rec, info) !== undefined) continue;
    const { bestTime: _drop, course: _c, ...rest } = rec;
    out = Object.assign({}, out, { [info.def.id]: rest });
  }
  return out;
}

// A stage run (not the daily: use dailyRecord for that, never both). Returns the new progress,
// which stages this run newly unlocked and which badges it earned (for toasts).
export function recordRun(p: Progress, r: RunResult): { progress: Progress; medal: Medal; unlocked: string[]; newBest: boolean; badges: Badge[] } {
  const before = STAGES.filter((s) => isUnlocked(p, s.def.id)).map((s) => s.def.id);
  const info = stageById(r.stageId);
  const old = p[r.stageId];
  const medal = medalFor(r, info);
  const withStage: Progress = Object.assign({}, p, { [r.stageId]: bestOf(old, r, medal, info) });
  const { progress, badges } = addRun(withStage, r);
  const unlocked = STAGES.map((s) => s.def.id).filter((id) => isUnlocked(progress, id) && !before.includes(id));
  return { progress, medal, unlocked, newBest: r.score > (old?.bestScore ?? 0), badges };
}

const dayNumber = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8)) / 86_400_000;

// A daily-course run: keeps the best of that date and the streak of consecutive days played.
// Replaying the same day leaves the streak; a day older than the last one played (clock change)
// records its best but doesn't touch the streak. info: the daily the run was played on (default:
// what dailyStage gives this player now); its rule is pinned on the day.
export function dailyRecord(p: Progress, date: Date, r: RunResult, info: StageInfo = dailyStage(date, p)): { progress: Progress; medal: Medal; newBest: boolean; streak: number; badges: Badge[] } {
  const key = dailyKey(date);
  const book = dailyOf(p);
  const old = book.days[key];
  const medal = medalFor(r, info);
  let { streak, last } = book;
  const gap = last === undefined ? Infinity : dayNumber(key) - dayNumber(last);
  if (gap > 0) {
    streak = gap === 1 ? streak + 1 : 1;
    last = key;
  }
  const daily: DailyBook = {
    days: { ...book.days, [key]: { ...bestOf(old, r, medal, info, true), rule: old?.rule ?? ruleOf(info)?.def.id } },
    last,
    streak,
    bestStreak: Math.max(book.bestStreak, streak),
  };
  const { progress, badges } = addRun(Object.assign({}, p, { daily }), r);
  return { progress, medal, newBest: r.score > (old?.bestScore ?? 0), streak, badges };
}

// ---------- daily share and calendar (studio review 2 item 14) ----------

const MEDAL_EMOJI: Record<Medal, string> = { none: '☆☆☆', bronze: '★☆☆', silver: '★★☆', gold: '★★★' };

// Wordle-style one-liner, e.g. 'Dig Down 10/28 ★★☆ 287m ⏱41s 🔥5'. Time only for a clear, streak
// only while one is running; no rule or score, so the line stays short enough for a chat preview.
export function dailyShareText(date: Date, record: StageRecord | undefined, streak: number): string {
  const parts = [`Dig Down ${date.getMonth() + 1}/${date.getDate()}`, MEDAL_EMOJI[record?.medal ?? 'none']];
  if (record) parts.push(`${Math.floor(record.bestDepth)}m`);
  if (record?.bestTime !== undefined) parts.push(`⏱${Math.round(record.bestTime)}s`);
  if (streak > 0) parts.push(`🔥${streak}`);
  return parts.join(' ');
}

export interface DailyCell { key: string; date: Date; record?: DailyDay; medal: Medal; today: boolean }
// The last `days` local dates ending today, oldest first, for the daily calendar strip.
export function dailyHistory(p: Progress, today: Date, days = 14): DailyCell[] {
  const book = dailyOf(p);
  return Array.from({ length: days }, (_, i) => {
    // noon, so a DST shift can't push the date across midnight
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i), 12);
    const key = dailyKey(date);
    const record = book.days[key];
    return { key, date, record, medal: record?.medal ?? 'none', today: i === days - 1 };
  });
}

// ---------- puppy cosmetics: badge rewards (studio review 2 item 15) ----------

export interface Cosmetic { id: string; slot: CosmeticSlot; nameKo: string; color: string; badge: string }
// One per badge: early badges give the everyday pieces, the long goals the showy ones (our
// choice). color is the renderer's main tint.
export const COSMETICS: Cosmetic[] = [
  { id: 'scarf-red', slot: 'neck', nameKo: '빨간 목도리', color: '#e04646', badge: 'depth-1k' },
  { id: 'beanie', slot: 'head', nameKo: '방울 털모자', color: '#4a7be0', badge: 'streak-3' },
  { id: 'hammer-blue', slot: 'hammer', nameKo: '파란 망치', color: '#3fa9f5', badge: 'chain-5' },
  { id: 'scarf-stripe', slot: 'neck', nameKo: '줄무늬 목도리', color: '#f2b233', badge: 'friends-10' },
  { id: 'goggles', slot: 'face', nameKo: '눈 고글', color: '#ff8c1a', badge: 'depth-5k' },
  { id: 'earmuffs', slot: 'head', nameKo: '복슬 귀마개', color: '#f28cc0', badge: 'daily-medal-7' },
  { id: 'crown-ice', slot: 'head', nameKo: '얼음 왕관', color: '#9be8ff', badge: 'depth-10k' },
  { id: 'hammer-gold', slot: 'hammer', nameKo: '황금 망치', color: '#ffd23f', badge: 'all-gold' },
];
export const cosmeticById = (id: string) => COSMETICS.find((c) => c.id === id);
// the reward a badge gives, for the badge toast / result row
export const cosmeticForBadge = (badgeId: string) => COSMETICS.find((c) => c.badge === badgeId);
export const unlockedCosmetics = (p: Progress): Cosmetic[] => {
  const earned = statsOf(p).badges;
  return COSMETICS.filter((c) => earned.includes(c.badge));
};
// What the puppy wears: only pieces still owned (an edited or stale save can't wear more).
export function equippedCosmetics(p: Progress): Partial<Record<CosmeticSlot, Cosmetic>> {
  const out: Partial<Record<CosmeticSlot, Cosmetic>> = {};
  const owned = unlockedCosmetics(p);
  for (const [slot, id] of Object.entries((p as ProgressMeta).cosmetics?.equipped ?? {})) {
    const c = owned.find((o) => o.id === id && o.slot === slot);
    if (c) out[c.slot] = c;
  }
  return out;
}
// Wear a piece (replacing that slot) or take it off if it's already worn. A locked or unknown id
// returns the same object, so the caller can skip the save.
export function toggleCosmetic(p: Progress, id: string): Progress {
  const c = unlockedCosmetics(p).find((o) => o.id === id);
  if (!c) return p;
  const equipped = { ...((p as ProgressMeta).cosmetics?.equipped ?? {}) };
  if (equipped[c.slot] === id) delete equipped[c.slot];
  else equipped[c.slot] = id;
  return Object.assign({}, p, { cosmetics: { equipped } });
}

// ---------- "다음 스테이지 ▶" (studio review 2 item 15) ----------

// The stage to preselect after playing `stageId` (pass the progress after recording): a stage this
// clear just opened (never played) first, then any open unplayed stage, then the next open stage
// below gold in list order, then any below gold. undefined = everything else is gold.
// After a loss (`won` false) only stages further down the list count: wrapping back used to offer
// the easier stage already cleared (UI review 2), when the card's real ask is a retry.
export function nextStageAfter(p: Progress, stageId: string, won = true): StageInfo | undefined {
  const at = STAGES.findIndex((s) => s.def.id === stageId);
  const open = STAGES.filter((s, i) => s.def.id !== stageId && isUnlocked(p, s.def.id) && (won || i > at));
  const fresh = open.filter((s) => !p[s.def.id]);
  const notGold = open.filter((s) => p[s.def.id]?.medal !== 'gold');
  return fresh.find((s) => s.unlockAfter === stageId) ?? fresh[0]
    ?? notGold.find((s) => STAGES.indexOf(s) > at) ?? notGold[0];
}

// ---------- live medal metric for the HUD (studio review 2 item 13) ----------

// What the HUD sees mid-run: the stats so far plus the clock, the current level and the depth.
export type LiveStats = RunStats & { time: number; level: number; depth: number };
export interface MedalMetric {
  medal: Exclude<Medal, 'none'>; // the medal this line chases
  labelKo: string;
  value: number;
  target: number;
  unitKo: string;
  // 'max': stay at or under target (swings, time); 'min': reach it (friends, melts, dry levels, depth)
  dir: 'max' | 'min';
  met: boolean; // the number alone holds right now (other parts, e.g. lives, aren't in the line)
  textKo: string; // ready HUD line, e.g. '★★☆ 망치 142/190'
  noteKo?: string; // aurora: the current dry level's status
}

// The one number each stage's medals turn on. Targets are not copied here: they are read back
// from the criterion itself (probeTarget), so a balance pass on stages.ts can't leave the HUD stale.
interface MetricSpec {
  labelKo: string; unitKo: string; dir: 'max' | 'min';
  live: (s: LiveStats, info: StageInfo) => number;
  probe: (v: number, info: StageInfo) => Partial<RunCheck>; // a run whose only weak point is v
}
const dryLevels = (info: StageInfo) => info.def.levels.flatMap((_, i) => (isDryLevel(info.def, i + 1) ? [i + 1] : []));
const swingSpec: MetricSpec = { labelKo: '망치', unitKo: '번', dir: 'max', live: (s) => s.swings, probe: (v) => ({ swings: v }) };
const METRICS: Record<string, MetricSpec> = {
  'snowy-hill': swingSpec,
  'hammer-igloo': swingSpec,
  // melt chains whose cascade reached step 2 (review 3 item 16: the medals count only those)
  'thaw-cave': { labelKo: '녹은 연쇄', unitKo: '번', dir: 'min', live: (s) => s.meltChains2 ?? 0, probe: (v) => ({ meltChains2: v }) },
  'arcade-500': { labelKo: '친구', unitKo: '마리', dir: 'min', live: (s) => s.friends, probe: (v) => ({ friends: v }) },
  'ice-slide': { labelKo: '시간', unitKo: '초', dir: 'max', live: (s) => s.time - s.clockSaved, probe: (v) => ({ time: v }) },
  // dry levels already left behind without a capsule (the current one isn't decided yet)
  'aurora-north': {
    labelKo: '마른 층', unitKo: '개', dir: 'min',
    live: (s, info) => dryLevels(info).filter((l) => l < s.level && (s.levelCapsules[l - 1] ?? 0) === 0).length,
    // all but v of the dry levels took a capsule
    probe: (v, info) => {
      const dry = dryLevels(info);
      const caps = info.def.levels.map(() => 0);
      for (const l of dry.slice(0, Math.max(0, dry.length - v))) caps[l - 1] = 1;
      return { levelCapsules: caps };
    },
  },
};
// a run that passes every other part of a criterion
const BEST: RunCheck = {
  won: true, time: 0, swings: 0, livesLost: 0, maxChain: 99, meltChains: 1e4, meltChains2: 1e4, friends: 1e4, levelCapsules: [], clockSaved: 0, maxCombo: 999,
  score: 1e9,
};
const PROBE_MAX = 1e4;
const targets = new WeakMap<MedalCriterion, number | null>();
// The threshold of a monotone criterion along the spec's number (binary search over integers):
// the largest passing value for 'max', the smallest for 'min'. null when no value passes.
function probeTarget(c: MedalCriterion, spec: MetricSpec, info: StageInfo): number | null {
  if (targets.has(c)) return targets.get(c)!;
  const pass = (v: number) => c.test({ ...BEST, ...spec.probe(v, info) });
  const up = spec.dir === 'max';
  let t: number | null = null;
  if (pass(up ? 0 : PROBE_MAX)) {
    let lo = 0, hi = PROBE_MAX; // max: pass(lo) holds; min: pass(hi) holds
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pass(mid) === up) lo = mid; else hi = mid;
    }
    t = up ? (pass(hi) ? hi : lo) : (pass(lo) ? lo : hi);
  }
  targets.set(c, t);
  return t;
}

// The HUD line for the medal still to chase (held: the medal on record for this stage or day;
// silver or better chases gold). Endless chases the next depth medal past the current depth.
// null = no number to show (no criterion yet, or a rule without a metric).
export function medalMetric(info: StageInfo, live: LiveStats, held: Medal = 'none'): MedalMetric | null {
  if (info.depthMedals) {
    const i = Math.min(2, info.depthMedals.filter((d) => live.depth >= d).length);
    const medal = RANK[i + 1] as MedalMetric['medal'];
    const target = info.depthMedals[i];
    const value = Math.floor(live.depth);
    return {
      medal, labelKo: '깊이', value, target, unitKo: 'm', dir: 'min', met: value >= target,
      textKo: `${MEDAL_EMOJI[medal]} 깊이 ${value}/${target}m`,
    };
  }
  const rule = ruleOf(info);
  const spec = rule && METRICS[rule.def.id];
  const medal = medalStars(held) >= 2 ? 'gold' : 'silver';
  const crit = info[medal];
  if (!spec || !crit) return null;
  const target = probeTarget(crit, spec, info);
  if (target === null) return null;
  const value = spec.live(live, info);
  const met = spec.dir === 'max' ? value <= target : value >= target;
  const timed = spec.unitKo === '초';
  let noteKo: string | undefined;
  if (rule.def.id === 'aurora-north' && isDryLevel(info.def, live.level)) {
    noteKo = (live.levelCapsules[live.level - 1] ?? 0) === 0 ? '캡슐 적은 층 · 캡슐 없이 지나는 중' : '캡슐 적은 층 · 캡슐을 먹었어요';
  }
  return {
    medal, labelKo: spec.labelKo, value, target, unitKo: spec.unitKo, dir: spec.dir, met,
    textKo: `${MEDAL_EMOJI[medal]} ${spec.labelKo} ${timed ? Math.floor(value) : value}/${target}${timed ? '초' : ''}`, noteKo,
  };
}

const KEY = 'dig-down:progress:v1';
let memory: Progress = {}; // fallback when storage is unavailable
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = dropStaleTimes(JSON.parse(raw));
  } catch { /* storage blocked: keep the in-memory copy */ }
  return memory;
}
export function saveProgress(p: Progress) {
  memory = p;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
