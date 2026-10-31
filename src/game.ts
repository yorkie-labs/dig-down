// Pure game logic, modelled on Mr. Driller's rules. Advances in fixed ticks so it can be
// tested without a browser.
import { ALL_CHUNKS, chunkColors, chunkHasThaw, type Chunk, type ChunkSet } from './chunks';

export const COLS = 9;
export const SKY_ROWS = 2;
export const LEVEL_DEPTH = 100;
export const LEVELS = 5;
export const GOAL_DEPTH = LEVEL_DEPTH * LEVELS; // 500m
export const ROWS = SKY_ROWS + GOAL_DEPTH;
export const COLOR_COUNT = 4; // red, yellow, green, blue
export const LEVEL_COLORS = [4, 3, 2, 4, 3]; // colors in play per 100m level (500m mode)
export const XBLOCK = -1; // brown X block: five hits, costs air; 4+ connected X blocks clear too
export const CAPSULE = -2; // air capsule: walk or drill into it
export const CLEAR = -3; // aqua row ending each level: drilling it wipes everything above
// Thaw ice: never joins anything; one hit breaks it; melts away on its own once a side is open.
// From MD2's crystal blocks / Star Driller's star blocks ("disappear by themselves after a
// while", sourced); starting the timer only on exposure is our choice so the timing is readable.
export const THAW = -7;
// Frozen friend: a 4+ X-block pop leaves one behind; walk or swing into it to rescue it.
// Based on MD1's Undergrounder (765 points, appears where an X group pops; sourced via
// Horipedia/StrategyWiki). Points only: lives already come from the score extend.
export const FRIEND = -6;
export const SCORE_FRIEND = 765; // times the nth friend
// Time-attack clock: replaces air capsules; taking one takes seconds off the run time (MD1
// console Time Attack: "collect clocks to cut the elapsed time", sourced).
export const CLOCK = -8;
const SOLO = new Set([CAPSULE, THAW, FRIEND, CLOCK]); // cell kinds that never merge into chunks
const PICKUPS = new Set([CAPSULE, FRIEND, CLOCK]); // taken by walking or swinging into them
export const XBLOCK_HP = 5;
export const POP_SIZE = 4; // a landed chunk this big or bigger clears itself
export const START_LIVES = 3;

export const AIR_MAX = 100;
// Air drain in %/s per level. Mr. Driller 1's rate is undocumented; these are frame-measured
// values from Mr. Driller G (Susumu), which also drains faster with depth.
export const AIR_DRAIN = [1.32, 1.62, 1.98, 2.16, 2.16];
export const AIR_CAPSULE = 23; // the developers' figure; the on-screen banner says 20
export const AIR_XBLOCK = 20;
export const AIR_WARNING = 30;
// Our twist on the original: chains breathe. Air per pop, indexed by the effective chain step
// (cascade step + action combo; the last entry is the cap). Superlinear so a planned 3-4 chain
// pays far more than the accidental 1-2 chains a mindless dig gets every run (studio review:
// the old linear 3n gave bots 128% air per run, 84% of it from 1-chains). Step 2 was 8, but
// two-step cascades happen by accident (greedy took ~67% of its chain air from them, design review
// 2), so it is a token 3 and the weight moved to 3+: greedy's chain air per run halved (arcade
// 259 -> 153%, 42% of it from step 2) while the planner still gets ~1.8x greedy's. Our tuning.
export const AIR_CHAIN = [0, 0, 3, 20, 32, 45];
// Air after a life is lost: a crush still refills the tank, but suffocating only gives 60, so
// running dry is a real cost instead of a free refill (studio review item 7). Our tuning.
export const AIR_RESPAWN_CRUSH = 100;
export const AIR_RESPAWN_SUFFOCATE = 60;
// Action combo (REN): a pop opens this window; a pop the player sets off with the hammer inside
// it adds +1 combo, which adds 10% to every pop's score while it lasts (popScoreMul). Once a combo
// runs, only player-made pops renew the window, and only the block resting right on a broken cell
// is tagged: the first version (any pop renews, the whole column tagged, a pending stack keeps the
// combo) let the mindless bot sit in combo 80% of the time with 52-66% of its pops at the x128
// score cap; now ~60% and 17-30% (planner ~76% and 45-49%, scoring 2-3.4x the greedy bot; snowy
// and arcade, 8 seeds). Design review 2, our tuning.
// Air stays on the cascade step alone: digging down sets loose a stack nearly every swing, and
// combo air lifted the mindless bot's arcade clear from 50% to 90% (planner 100%: the skill gap
// fell to 10 points). Not the roadmap's "combo gives air": a documented deviation.
export const COMBO_WINDOW = 1.5;

export const SCORE_DRILL = 10; // per cell drilled
export const SCORE_POP = 30; // per cell cleared by sticking four together, times popScoreMul(chain, combo)
// Pop score: base x 2^(chain-1) x (1 + 0.1 combo). The chain part is 0.5x for a lone pop and
// capped at step 5 (x16); the combo part is capped at x2 (combo 10). Studio review 2 item 5: with
// combo added to the exponent (x128 cap) 84-93% of even the mindless bot's score was combo and
// every run passed the extend; now the cascade a player plans is what multiplies. Our tuning.
const SCORE_STEP_CAP = 5;
export const COMBO_SCORE_STEP = 0.1;
export const COMBO_SCORE_CAP = 2;
// the no-combo multiplier (the sim reads a pop's combo cut against it)
export function chainScoreMul(chain: number): number {
  return chain >= 2 ? 2 ** (Math.min(chain, SCORE_STEP_CAP) - 1) : 0.5;
}
export const comboScoreMul = (combo: number) => Math.min(COMBO_SCORE_CAP, 1 + COMBO_SCORE_STEP * combo);
export const popScoreMul = (chain: number, combo: number) => chainScoreMul(chain) * comboScoreMul(combo);
export const chainAir = (step: number) => AIR_CHAIN[Math.min(step, AIR_CHAIN.length - 1)];
export const SCORE_CAPSULE = 100; // the nth capsule is worth n * this
export const SCORE_LIFE_BONUS = 30000; // per remaining life (including the current one) at the goal
export const SCORE_LEVEL_CLEAR = 1000; // times the level number
// Scores that award an extra life. Mr. Driller 2 (GBA) extends at 100,000 on its 500m stage
// (sourced); whether it extends again later is undocumented. Studio review 2 item 5 moved it to
// 150k/400k because every run reached 100k; with the new pop formula 150k was never reached on a
// finite stage (round 3 review: 0% for every bot). Back at the sourced 100k it is a chain reward:
// planner 35% lake / 90% aurora, the chain-blind planner 0% on both, greedy at most 5% (20 seeds).
// 300k for the second is our tuning (endless only).
export const EXTEND_SCORES = [100000, 300000];

export const TICK = 1 / 60; // seconds per logic tick
// Unsupported blocks shake for about a second (sourced for level 1 only; the shortening
// with depth is our choice).
export const WOBBLE_TIME = [1.0, 0.9, 0.8, 0.7, 0.6];
// Falling speed in rows/s: Mr. Driller G measures 6.667 rising to 12; levels in between are
// interpolated.
export const FALL_SPEED = [6.667, 8, 9.333, 10.667, 12];
export const MOLE_FALL_SPEED = 14;
// Generation tuning (not published for the original):
const CAPSULE_CHANCE = 84 / 1000 / COLS; // ~84 capsules over 1000m
const XBLOCK_CHANCE = [0.08, 0.11, 0.14, 0.17, 0.2]; // on every other row
const CAPSULE_GUARD = [0, 0.25, 0.5, 0.75, 0.9]; // chance an X block walls each side of a capsule
export const DRILL_COOLDOWN = 0.13;
// Fairness guard: no more than K rows between reachable capsules, K = the rows a mole digs on
// FAIR_AIR_BUDGET % of air at roughly a row per second, clamped (studio review item 5: the worst
// arcade gap was 102 rows). Dry levels (capsuleMul < 1, Aurora) are meant to be lean: 1.5x K.
// Our tuning.
const FAIR_AIR_BUDGET = 60;
const FAIR_GAP_MIN = 25;
const FAIR_GAP_MAX = 50;
const FAIR_DRY_MUL = 1.5;
export const INVULN_TIME = 1.5;

export interface Cell {
  color: number; // 0..COLOR_COUNT-1, XBLOCK, or CAPSULE
  hp: number;
  wobble: number; // seconds spent shaking while unsupported
  melt: number; // thaw ice: seconds spent exposed
  falling: boolean;
  chain: number; // step of the pop that set this cell loose (0 = not part of a cascade)
  meltTag: boolean; // set loose by thaw ice melting below it (for melt-chain stats)
  meltRoot: number; // the melt chain (1-based stats.meltChains id) whose cascade set it loose, 0 = none
  comboTag: boolean; // set loose by a hammer hit inside the combo window (a pop then adds combo)
}

export type Dir = 'left' | 'right' | 'up' | 'down';

type Pos = { x: number; y: number };
export type GameEvent =
  | { type: 'drill'; cells: (Pos & { color: number })[] }
  // chain: the cascade step (sets air); step: chain + combo (pop pitch); points: see popScoreMul
  | { type: 'pop'; cells: (Pos & { color: number })[]; chain: number; step: number; air: number; points: number; melt?: number } // melt: melt-chain root (0/absent = none)
  | { type: 'combo'; n: number }
  | { type: 'whiff'; dir: Dir } // a swing at nothing (empty, falling block or board edge)
  | { type: 'shield'; x: number; y: number } // a block shattered on the mole while invulnerable
  | { type: 'chip'; x: number; y: number; hp: number }
  | { type: 'xbreak'; x: number; y: number }
  | { type: 'capsule'; x: number; y: number; points: number }
  | { type: 'land'; x: number; y: number }
  | { type: 'melt'; x: number; y: number }
  | { type: 'friend-spawn'; x: number; y: number }
  | { type: 'clock'; x: number; y: number; secs: number }
  | { type: 'friend'; x: number; y: number; points: number; count: number }
  | { type: 'crush'; x: number; y: number }
  | { type: 'suffocate' }
  | { type: 'level'; level: number }
  | { type: 'levelclear'; y: number; bonus: number }
  | { type: 'won'; bonus: number }
  | { type: 'extend'; lives: number }
  | { type: 'lost' };

export interface Mole {
  x: number;
  y: number;
  facing: Dir;
  invuln: number;
}

// A stage is data: per-100m level presets plus generation knobs. The default stage reproduces
// the original arcade 500m run (values sourced/labelled where the constants are declared).
export interface LevelDef {
  colors: number; // colours in play (1-4)
  xChance: number; // X-block chance on every other row
  capsuleGuard: number; // chance an X block walls each side of a capsule
  airDrain: number; // %/s
  wobble: number; // seconds an unsupported chunk shakes
  fallSpeed: number; // rows/s
  thawChance?: number; // chance a coloured cell is thaw ice instead
  thawTime?: number; // seconds an exposed thaw cell lasts
  capsuleMul?: number; // capsule supply for this level (Aurora: deliberately irregular)
  // chance a cell right of an X block on an X row is an X too, so X comes in groups that one
  // more falling X can turn into a 4+ pop (lake friends); the X share stays xChance. Our tuning.
  xCluster?: number;
}
export interface StageDef {
  id: string;
  levels: LevelDef[]; // one per 100m; the stage is levels.length * 100m deep
  capsuleChance: number; // per cell
  // Air economy. 'time': drains every second (the arcade rule). 'swing': only landed hammer swings
  // cost air, so time is free and every swing counts (Dristone / Mr. Driller A, sourced in
  // tasks/20261028-stages-research.json).
  air: { kind: 'time' } | { kind: 'swing'; perSwing: number[]; xBreakAir: number } | { kind: 'none' };
  friends?: boolean; // 4+ X-block pops leave frozen friends
  lives?: number; // default START_LIVES
  clocks?: number; // time attack: capsules become clocks worth this many seconds
  seed?: number; // fixed course: the same board every run (route learning)
  airCap?: number; // max air (default AIR_MAX); Aurora lets rich levels bank air for dry ones
  friendAir?: number; // air restored per rescued friend (makes herding X compete with breaking X)
  endless?: (n: number) => LevelDef; // survival: level n (1-based, beyond levels[]) generated on demand
  chunks?: ChunkSet; // hand-made pieces stamped every CHUNK_EVERY m (src/chunks.ts)
}
export interface RunStats {
  swings: number; // landed swings (hits on a cell)
  livesLost: number;
  maxChain: number;
  meltChains: number; // pops set off by a stack dropping after thaw ice melted
  meltChains2?: number; // of those, cascades that reached step 2 (optional: older records lack it)
  friends: number; // frozen friends rescued
  levelCapsules: number[]; // capsules taken on each level (index = level - 1)
  clockSaved: number; // seconds taken off by clocks
  maxCombo?: number; // longest action combo (optional: records saved before combos lack it)
}
export const DEFAULT_STAGE: StageDef = {
  id: 'arcade-500',
  levels: LEVEL_COLORS.map((colors, i) => ({
    colors,
    xChance: XBLOCK_CHANCE[i],
    capsuleGuard: CAPSULE_GUARD[i],
    airDrain: AIR_DRAIN[i],
    wobble: WOBBLE_TIME[i],
    fallSpeed: FALL_SPEED[i],
  })),
  capsuleChance: CAPSULE_CHANCE,
  air: { kind: 'time' },
};

export interface Game {
  stage: StageDef;
  levels: LevelDef[]; // resolved levels; endless stages append as the mole goes deeper
  rand: () => number; // the board RNG, kept so endless rows stay deterministic
  cols: number;
  rows: number;
  cells: (Cell | null)[];
  mole: Mole;
  lives: number;
  air: number;
  score: number;
  capsules: number; // taken so far, for escalating capsule points
  extends: number; // EXTEND_SCORES thresholds already passed
  level: number; // 1-based, from the mole's depth
  state: 'playing' | 'won' | 'lost';
  time: number;
  lastDrill: number;
  lastWhiff: number;
  combo: number; // action combo (REN), see COMBO_WINDOW
  comboTimer: number; // seconds left in the combo window (0 = closed)
  meltReached: number[]; // melt chains (ids, see popChunk) already counted in stats.meltChains2
  capRow: number; // last row with a reachable capsule, carried into the next endless extension
  pieces: Placement[]; // hand-made pieces stamped so far, top to bottom (tests, bots, renderer)
  deck: PieceDeck; // piece draw state, carried into the next endless extension like capRow
  acc: number;
  fallAcc: number;
  moleAcc: number;
  events: GameEvent[];
  stats: RunStats;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function levelOfDepth(depth: number): number {
  return levelIn(depth, LEVELS);
}
// level within a stage of `levels` 100m levels (a separate function: map(levelOfDepth) passes an index)
export function levelIn(depth: number, levels: number): number {
  return Math.min(levels, Math.floor(Math.max(0, depth - 1) / LEVEL_DEPTH) + 1);
}

export const stageRows = (stage: StageDef) => SKY_ROWS + stage.levels.length * LEVEL_DEPTH;
const levelAt = (g: Game) => g.levels[g.level - 1];
// Tempo (playtest: "no squeeze; easy then hard, and again after each stage"): within each 100m
// level blocks wobble shorter and fall faster (TEMPO 1 → 1.35) and air drains from easy to tight
// (AIR 0.95 → 1.6, shape p^1.6); the aqua clear row resets both — a breather before the next
// level's harder baseline. A sawtooth on a rising line. Our tuning; bot sim (greedy, 20 seeds):
// arcade 30% / aurora 15% clears, as before the change; thaw 45% → 75%.
export const TEMPO_START = 1, TEMPO_END = 1.35, TEMPO_CURVE = 1.6, AIR_START = 0.95, AIR_END = 1.6;
export function levelProgress(g: Game): number {
  const d = depthOfRow(g.mole.y) - (g.level - 1) * LEVEL_DEPTH;
  return Math.max(0, Math.min(1, d / LEVEL_DEPTH));
}
const shape = (g: Game) => levelProgress(g) ** TEMPO_CURVE;
/** fall/wobble speed factor: blocks get quicker through the level */
export const levelTempo = (g: Game) => TEMPO_START + (TEMPO_END - TEMPO_START) * shape(g);
/** air drain factor: easy breathing after a clear row, a squeeze near the next one. Kept separate
 *  from the fall tempo: slower falls (< 1) made the bot wait on wobbles and suffocate (arcade bot
 *  clears 30% → 15%), so falls only speed up while the drain does the easy-then-hard swing. */
export const levelAirTempo = (g: Game) => AIR_START + (AIR_END - AIR_START) * shape(g);

export function depthOfRow(y: number): number {
  return y - (SKY_ROWS - 1);
}

// Fill rows [fromY, toY) with blocks for the given levels, then wall in that range's capsules.
// Endless stages call this again as the mole nears the bottom; the RNG keeps running, so a seed
// always produces the same board. capRow is the last reachable-capsule row above the range;
// returns the one for the next range.
function fillRows(cells: (Cell | null)[], cols: number, fromY: number, toY: number, stage: StageDef,
  levels: LevelDef[], rand: () => number, capRow: number, gen: PieceGen): number {
  const L = levels.length;
  for (let y = fromY; y < toY; y++) {
    const depth = depthOfRow(y);
    const def = levels[levelIn(depth, L) - 1];
    const colors = def.colors;
    if (depth % LEVEL_DEPTH === 0) {
      for (let x = 0; x < cols; x++) cells[idx(cols, x, y)] = makeCell(CLEAR);
      continue;
    }
    const xChance = depth > 3 && depth % 2 === 1 ? def.xChance : 0;
    // xCluster moves X rather than adding it: the independent rate drops by (1 - xCluster) and the
    // rest comes back as copies of the X on the left, so the X share stays ~xChance (run length
    // ~1/(1 - xCluster)) while 3-wide groups, one falling X short of a pop, become common
    const xBase = def.xCluster ? xChance * (1 - def.xCluster) : xChance;
    for (let x = 0; x < cols; x++) {
      let color: number;
      const left = x > 0 ? cells[idx(cols, x - 1, y)] : null;
      const up = y > SKY_ROWS ? cells[idx(cols, x, y - 1)] : null;
      const inPlay = (c: Cell | null): c is Cell => !!c && c.color >= 0 && c.color < colors;
      const r = rand();
      const capC = stage.capsuleChance * (def.capsuleMul ?? 1);
      if (depth > 3 && r < capC) color = stage.clocks ? CLOCK : CAPSULE;
      else if (r < capC + xBase) color = XBLOCK;
      else if (def.xCluster && xChance && left?.color === XBLOCK && rand() < def.xCluster) color = XBLOCK;
      else if (inPlay(left) && r < 0.25) color = left.color;
      else if (inPlay(up) && r < 0.38) color = up.color;
      else color = Math.floor(rand() * colors);
      cells[idx(cols, x, y)] = makeCell(color);
    }
  }
  // stamped piece cells keep their design: thaw, capsule walls and the fairness guard skip them
  const fixed = new Uint8Array((toY - fromY) * cols);
  const free = (i: number) => i < fromY * cols || i >= toY * cols || !fixed[i - fromY * cols];
  stampChunks(cells, cols, fromY, toY, stage, levels, rand, fixed, gen);
  // Deeper capsules sit behind X-block walls.
  for (let i = fromY * cols; i < toY * cols; i++) {
    if (cells[i]?.color !== CAPSULE || !free(i)) continue;
    const x = i % cols;
    const y = Math.floor(i / cols);
    const guard = levels[levelIn(depthOfRow(y), L) - 1].capsuleGuard;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y + 1]]) {
      if (nx < 0 || nx >= cols || ny >= toY) continue;
      const n = cells[idx(cols, nx, ny)];
      if (n && n.color >= 0 && free(idx(cols, nx, ny)) && rand() < guard) cells[idx(cols, nx, ny)] = makeCell(XBLOCK);
    }
  }
  placeThaw(cells, cols, fromY, toY, levels, rand, free); // after the walls, so they can't cap a stack
  return guardCapsules(cells, cols, fromY, toY, stage, levels, rand, capRow, free);
}

const rowOfDepth = (depth: number) => depth + SKY_ROWS - 1;
function shuffle<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Hand-made pieces (studio review item 10): one at 25/50/75m into every level, and a boss right
// above a finite stage's goal or an endless 500m clear row (taking the 75m slot). Spacing is our
// tuning: ~4 noise rows for each piece row keeps the pieces landmarks rather than the whole board.
export const CHUNK_EVERY = 25;
// Endless glacier (studio review 2 item 17): past 1300m the run gets a boss above every 500m clear
// row (1500m, 2000m, ...), so a long run keeps meeting set pieces. Our tuning.
export const ENDLESS_BOSS_FROM = 1300;
export const ENDLESS_BOSS_EVERY = 500;
// A piece fits a level that has its colours (and thaw timing for '~').
export const chunkFits = (c: Chunk, def: LevelDef) => chunkColors(c) <= def.colors && (!!def.thawTime || !chunkHasThaw(c));
// The boss above a level's goal or clear row, if it gets one (finite stage: its last level).
export function bossFor(stage: StageDef, li: number, levels: number): Chunk[] {
  const set = stage.chunks;
  if (!set) return [];
  if (!stage.endless) return li === levels - 1 && set.boss ? [set.boss] : [];
  const end = (li + 1) * LEVEL_DEPTH;
  return end > ENDLESS_BOSS_FROM && end % ENDLESS_BOSS_EVERY === 0 ? set.bosses ?? [] : [];
}
export interface Placement { id: string; top: number; rows: number; boss: boolean; mirror: boolean } // top: depth (m)
// Pool draws (studio review 2 item 4: 75-79% of slots repeated a piece seen earlier in the run,
// 18-42% the one right before). A bag: every piece once before any comes back, never the same
// piece twice in a row; each piece alternates its mirror image (the first one is a coin flip).
export interface PieceDeck { bag: Chunk[]; flip: Record<string, boolean> }
interface PieceGen { pieces: Placement[]; deck: PieceDeck }
export const mirrorRows = (rows: string[]) => rows.map((r) => [...r].reverse().join(''));
// The key piece (a bait of 2+ steps, not a boss) whose top row is 1..within rows below the mole:
// its key column (mirrored with the piece) and the cascade it promises. The planner bot steers for
// it and the renderer's key tip fires on it (round 3 review: the technique was invisible).
const BAITS = new Map(ALL_CHUNKS.filter((c) => c.bait && c.bait.chain >= 2).map((c) => [c.id, c.bait!]));
export function keyPieceBelow(g: Game, within: number): { x: number; chain: number } | null {
  for (const p of g.pieces) {
    const bait = !p.boss && BAITS.get(p.id);
    if (!bait) continue;
    const dy = rowOfDepth(p.top) - g.mole.y;
    if (dy < 1 || dy > within) continue;
    const k = bait.keys[0];
    return { x: p.mirror ? g.cols - 1 - k : k, chain: bait.chain };
  }
  return null;
}

function stampChunks(cells: (Cell | null)[], cols: number, fromY: number, toY: number, stage: StageDef,
  levels: LevelDef[], rand: () => number, fixed: Uint8Array, gen: PieceGen) {
  const set = stage.chunks;
  if (!set) return;
  const { deck } = gen;
  const lastId = () => gen.pieces.filter((p) => !p.boss).at(-1)?.id;
  const draw = (pool: Chunk[], def: LevelDef, used: Set<string>) => {
    const ok = (c: Chunk) => chunkFits(c, def);
    if (!deck.bag.some((c) => ok(c) && !used.has(c.id))) deck.bag.push(...shuffle(pool.filter((c) => !deck.bag.includes(c)), rand));
    // first choice: new to this level and not the piece right before; the bag carries over levels,
    // so a refill can hold one this level already showed
    const prefs = [(c: Chunk) => !used.has(c.id) && c.id !== lastId(), (c: Chunk) => c.id !== lastId(), () => true];
    for (const pref of prefs) {
      const i = deck.bag.findIndex((c) => ok(c) && pref(c));
      if (i >= 0) return deck.bag.splice(i, 1)[0];
    }
    return null;
  };
  const stamp = (c: Chunk, top: number, def: LevelDef, boss: boolean, mayMirror: boolean) => {
    const y0 = rowOfDepth(top);
    if (y0 < fromY || y0 + c.rows.length > toY) return; // only whole pieces inside this range
    const mirror = mayMirror && (deck.flip[c.id] = c.id in deck.flip ? !deck.flip[c.id] : rand() < 0.5);
    gen.pieces.push({ id: c.id, top, rows: c.rows.length, boss, mirror });
    // letters are "some colour": a fresh palette order per piece so the same shape varies
    const pal = shuffle(Array.from({ length: def.colors }, (_, i) => i), rand);
    (mirror ? mirrorRows(c.rows) : c.rows).forEach((row, r) => [...row].forEach((ch, x) => {
      const i = idx(cols, x, y0 + r);
      fixed[i - fromY * cols] = 1;
      cells[i] = ch === '.' ? null : makeCell(
        ch === 'X' ? XBLOCK : ch === 'O' ? (stage.clocks ? CLOCK : CAPSULE) : ch === '~' ? THAW : pal[ch.charCodeAt(0) - 97],
      );
    }));
  };
  for (let li = 0; li < levels.length; li++) {
    const start = li * LEVEL_DEPTH; // depth of the previous level's clear row
    if (rowOfDepth(start + LEVEL_DEPTH) < fromY || rowOfDepth(start + 1) >= toY) continue;
    const def = levels[li];
    const bosses = bossFor(stage, li, levels.length).filter((c) => chunkFits(c, def));
    // endless bosses take turns: the nth one placed is the nth that fits, round the list
    const boss = bosses.length ? bosses[gen.pieces.filter((p) => p.boss).length % bosses.length] : null;
    const nextDry = (levels[li + 1]?.capsuleMul ?? 1) < 1;
    const used = new Set<string>();
    for (let k = 1; k * CHUNK_EVERY < LEVEL_DEPTH; k++) {
      if (boss && k === 3) continue;
      const scripted = set.script?.[li];
      // the tutorial script stays as written: no mirror image, no bag
      if (scripted) {
        const c = scripted[k - 1];
        if (c && chunkFits(c, def)) stamp(c, start + k * CHUNK_EVERY, def, false, false);
        continue;
      }
      const dry = k === 3 && nextDry && set.beforeDry?.find((c) => chunkFits(c, def));
      const c = dry || draw(set.pool, def, used);
      if (c) { used.add(c.id); stamp(c, start + k * CHUNK_EVERY, def, false, true); }
    }
    if (boss) stamp(boss, start + LEVEL_DEPTH - boss.rows.length, def, true, true);
  }
}

// Structured thaw (studio review item 11): instead of anywhere, thaw ice goes under a stack of 2+
// of one other colour, first where that stack would land touching its own colour, so a melt
// drops something that can pop. The count stays thawChance of the level's coloured cells
// (fewer when a level has too few such spots). Our tuning.
function placeThaw(cells: (Cell | null)[], cols: number, fromY: number, toY: number, levels: LevelDef[],
  rand: () => number, free: (i: number) => boolean) {
  const stackColor = (i: number) => {
    const c = cells[i], a1 = cells[i - cols], a2 = cells[i - 2 * cols];
    return c && a1 && a2 && c.color >= 0 && a1.color >= 0 && a1.color === a2.color && a1.color !== c.color ? a1.color : -1;
  };
  for (let li = 0; li < levels.length; li++) {
    const def = levels[li];
    if (!def.thawChance) continue;
    const y0 = Math.max(fromY, rowOfDepth(li * LEVEL_DEPTH + 4)), y1 = Math.min(toY, rowOfDepth((li + 1) * LEVEL_DEPTH));
    if (y0 >= y1) continue;
    let total = 0;
    const strong: number[] = [], weak: number[] = [];
    for (let i = y0 * cols; i < y1 * cols; i++) {
      if (!free(i) || !cells[i] || cells[i]!.color < 0) continue;
      total++;
      const k = stackColor(i);
      if (k < 0) continue;
      const x = i % cols;
      const lands = (x > 0 && cells[i - 1]?.color === k) || (x < cols - 1 && cells[i + 1]?.color === k) || cells[i + cols]?.color === k;
      (lands ? strong : weak).push(i);
    }
    let left = Math.round(def.thawChance * total);
    for (const i of [...shuffle(strong, rand), ...shuffle(weak, rand)]) {
      if (left <= 0) break;
      // the stack above must still be there, and this cell must not be one already in use
      if (stackColor(i) < 0 || cells[i + cols]?.color === THAW || cells[i + 2 * cols]?.color === THAW) continue;
      cells[i] = makeCell(THAW);
      left--;
    }
  }
}

// Rows a level may go without a reachable capsule (see FAIR_AIR_BUDGET). Infinity: the stage has
// no air to run out of, or the level was built with no capsules on purpose.
export function capsuleGap(stage: StageDef, def: LevelDef): number {
  const mul = def.capsuleMul ?? 1;
  if (stage.air.kind === 'none' || stage.capsuleChance * mul <= 0) return Infinity;
  const k = Math.min(FAIR_GAP_MAX, Math.max(FAIR_GAP_MIN, Math.round(FAIR_AIR_BUDGET / def.airDrain)));
  return mul < 1 ? Math.round(k * FAIR_DRY_MUL) : k;
}

// A capsule is reachable unless X blocks (or the board edge) close every side. Rows at or below
// toY are not generated yet, so they don't count either way.
function openSide(cells: (Cell | null)[], cols: number, toY: number, x: number, y: number): boolean {
  for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
    if (nx < 0 || nx >= cols || ny < 0 || ny >= toY) continue;
    if (cells[idx(cols, nx, ny)]?.color !== XBLOCK) return true;
  }
  return false;
}

// Fairness guard: wherever a stretch without a reachable capsule runs too long, turn a coloured
// cell into one, spaced evenly through the gap (a single insert lands mid-gap). Each row costs
// 1/K of its level, so "at most K rows" holds inside a level and a gap that crosses into a
// harsher level is measured fairly. Returns the last reachable-capsule row, so an endless
// extension keeps measuring from there.
function guardCapsules(cells: (Cell | null)[], cols: number, fromY: number, toY: number, stage: StageDef,
  levels: LevelDef[], rand: () => number, capRow: number, free: (i: number) => boolean): number {
  const gapAt = (y: number) => capsuleGap(stage, levels[levelIn(depthOfRow(y), levels.length) - 1]);
  const spots = (y: number) => {
    const out: number[] = [];
    if (depthOfRow(y) <= 3) return out; // the first rows never hold capsules (see fillRows)
    for (let x = 0; x < cols; x++) {
      const c = cells[idx(cols, x, y)];
      if (c && c.color >= 0 && free(idx(cols, x, y)) && openSide(cells, cols, toY, x, y)) out.push(x);
    }
    return out;
  };
  const anchor = (y: number) => {
    if (gapAt(y) === Infinity) return true;
    for (let x = 0; x < cols; x++) {
      if (cells[idx(cols, x, y)]?.color === CAPSULE && openSide(cells, cols, toY, x, y)) return true;
    }
    return false;
  };
  const place = (y: number) => {
    const xs = spots(y);
    if (!xs.length) return false;
    cells[idx(cols, xs[Math.floor(rand() * xs.length)], y)] = makeCell(CAPSULE);
    return true;
  };
  const EPS = 1e-9;
  const ENDLESS_SEAM = 4;
  let a = capRow;
  for (let b = fromY; b <= toY; b++) {
    if (b < toY && !anchor(b)) continue; // toY: the range end closes the last gap
    // an endless range's tail keeps a few rows of slack, so the next range can always fit its
    // first capsule in its own rows instead of overrunning the gap carried across the seam
    const end = b === toY && stage.endless ? toY + ENDLESS_SEAM : b;
    for (;;) {
      const cost: number[] = []; // cost[i]: rows a+1..a+1+i
      let c = 0;
      for (let y = a + 1; y <= end; y++) cost.push((c += 1 / gapAt(y)));
      if (c <= 1 + EPS) break;
      // first of the evenly spaced inserts this gap needs, then search outward from it for a row
      // with a usable cell that keeps the stretch behind it within budget
      const share = c / Math.ceil(c - EPS);
      const t = a + 1 + cost.findIndex((v) => v >= share - EPS);
      let placed = -1;
      for (let d = 0; placed < 0 && d <= b - a; d++) {
        for (const y of d ? [t - d, t + d] : [t]) {
          if (y > a && y < b && y >= fromY && cost[y - a - 1] <= 1 + EPS && place(y)) { placed = y; break; }
        }
      }
      // only when the budget already ran out above this range (endless): the earliest row we can
      for (let y = Math.max(a + 1, fromY); placed < 0 && y < b; y++) if (place(y)) placed = y;
      if (placed < 0) break; // no usable cell at all (never seen)
      a = placed;
    }
    if (b < toY) a = b;
  }
  return a;
}

export function createGame(seed = Date.now(), stage: StageDef = DEFAULT_STAGE): Game {
  const rand = mulberry32(seed);
  const cols = COLS;
  const levels = [...stage.levels];
  const rows = SKY_ROWS + levels.length * LEVEL_DEPTH;
  const cells: (Cell | null)[] = new Array(cols * rows).fill(null);
  const gen: PieceGen = { pieces: [], deck: { bag: [], flip: {} } };
  const capRow = fillRows(cells, cols, SKY_ROWS, rows, stage, levels, rand, SKY_ROWS - 1, gen);

  return {
    stage,
    levels,
    rand,
    cols,
    rows,
    cells,
    mole: { x: Math.floor(cols / 2), y: SKY_ROWS - 1, facing: 'down', invuln: 0 },
    lives: stage.lives ?? START_LIVES,
    air: AIR_MAX,
    score: 0,
    capsules: 0,
    extends: 0,
    level: 1,
    state: 'playing',
    time: 0,
    lastDrill: -Infinity,
    lastWhiff: -Infinity,
    combo: 0,
    comboTimer: 0,
    meltReached: [],
    capRow,
    pieces: gen.pieces,
    deck: gen.deck,
    acc: 0,
    fallAcc: 0,
    moleAcc: 0,
    events: [],
    stats: { swings: 0, livesLost: 0, maxChain: 0, meltChains: 0, meltChains2: 0, friends: 0, levelCapsules: [], clockSaved: 0, maxCombo: 0 },
  };
}

export function makeCell(color: number): Cell {
  return { color, hp: color === XBLOCK ? XBLOCK_HP : 1, wobble: 0, melt: 0, falling: false, chain: 0, meltTag: false, meltRoot: 0, comboTag: false };
}

export function idx(cols: number, x: number, y: number): number {
  return y * cols + x;
}

export function cellAt(g: Game, x: number, y: number): Cell | null {
  if (x < 0 || x >= g.cols || y < 0 || y >= g.rows) return null;
  return g.cells[idx(g.cols, x, y)];
}

// Labels connected chunks: same-colored neighbours merge (X blocks with X blocks, the clear
// row with itself); capsules stand alone.
// A falling chunk that touches a supported one of its color merges with it, so it sticks.
export function computeChunks(g: Game): { labels: Int32Array; chunks: number[][] } {
  const labels = new Int32Array(g.cells.length).fill(-1);
  const chunks: number[][] = [];
  for (let i = 0; i < g.cells.length; i++) {
    const start = g.cells[i];
    if (!start || labels[i] !== -1) continue;
    const id = chunks.length;
    const members: number[] = [];
    const stack = [i];
    labels[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      if (SOLO.has(start.color)) continue;
      const cx = c % g.cols;
      const cy = Math.floor(c / g.cols);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        if (nx < 0 || nx >= g.cols || ny < 0 || ny >= g.rows) continue;
        const n = idx(g.cols, nx, ny);
        const cell = g.cells[n];
        if (cell && labels[n] === -1 && cell.color === start.color) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    chunks.push(members);
  }
  return { labels, chunks };
}

function canFall(g: Game, labels: Int32Array, members: number[]): boolean {
  for (const c of members) {
    const below = c + g.cols;
    if (below >= g.cells.length) return false;
    if (g.cells[below] && labels[below] !== labels[c]) return false;
  }
  return true;
}

function removeCells(g: Game, members: number[]) {
  return members.map((c) => {
    const color = g.cells[c]!.color;
    g.cells[c] = null;
    return { x: c % g.cols, y: Math.floor(c / g.cols), color };
  });
}

// All in-play scoring goes through here so crossing an extend threshold awards a life.
function addScore(g: Game, points: number) {
  g.score += points;
  while (g.extends < EXTEND_SCORES.length && g.score >= EXTEND_SCORES[g.extends]) {
    g.extends++;
    g.lives++;
    g.events.push({ type: 'extend', lives: g.lives });
  }
}

export const airCap = (g: Game) => g.stage.airCap ?? AIR_MAX;

function takeFriend(g: Game, x: number, y: number) {
  g.stats.friends++;
  if (g.stage.friendAir) g.air = Math.min(airCap(g), g.air + g.stage.friendAir);
  const points = SCORE_FRIEND * g.stats.friends;
  addScore(g, points);
  g.events.push({ type: 'friend', x, y, points, count: g.stats.friends });
}
function takePickup(g: Game, color: number, x: number, y: number) {
  if (color === CLOCK) {
    const secs = g.stage.clocks ?? 0;
    g.stats.clockSaved += secs;
    g.events.push({ type: 'clock', x, y, secs });
  } else if (color === FRIEND) takeFriend(g, x, y);
  else takeCapsule(g, x, y);
}

function takeCapsule(g: Game, x: number, y: number) {
  g.capsules++;
  const points = g.capsules * SCORE_CAPSULE;
  addScore(g, points);
  g.air = Math.min(airCap(g), g.air + AIR_CAPSULE);
  const lvl = g.level - 1;
  while (g.stats.levelCapsules.length <= lvl) g.stats.levelCapsules.push(0);
  g.stats.levelCapsules[lvl]++;
  g.events.push({ type: 'capsule', x, y, points });
}

// Moves or turns the mole. Walking into a capsule takes it; walking against a one-high
// ledge climbs it. Drilling is a separate action, as in the original.
export function move(g: Game, dir: Dir): void {
  if (g.state !== 'playing') return;
  const m = g.mole;
  m.facing = dir;
  if (dir === 'up' || dir === 'down') return;

  const nx = m.x + (dir === 'left' ? -1 : 1);
  if (nx < 0 || nx >= g.cols) return;
  const target = cellAt(g, nx, m.y);
  if (target && PICKUPS.has(target.color) && !target.falling) {
    g.cells[idx(g.cols, nx, m.y)] = null;
    takePickup(g, target.color, nx, m.y);
    m.x = nx;
    return;
  }
  if (!target) {
    m.x = nx;
    return;
  }
  const roomAbove = m.y > 0 && !cellAt(g, m.x, m.y - 1) && !cellAt(g, nx, m.y - 1);
  if (roomAbove) {
    m.x = nx;
    m.y -= 1;
  }
}

const STEP: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

// What a press did: 'hit' landed; 'cooldown' (hammer still swinging) and 'falling' (the target is
// on its way down) came a moment early, so the renderer may buffer and retry them; 'empty' is a
// swing at nothing (or no run in play) and must not be retried, or a whiff followed by a step would
// turn into a swing the player never made (bug review 2).
export type DrillResult = 'hit' | 'cooldown' | 'falling' | 'empty';
// quiet: a held key or buffered retry, which never whiffs; only a fresh press may (studio review 2
// item 11: holding the hammer against air rattled out a whiff every swing time).
export function drill(g: Game, opts: { quiet?: boolean } = {}): DrillResult {
  if (g.state !== 'playing') return 'empty';
  // A press during the cooldown is just early: the hammer is still swinging, so no whiff.
  if (g.time - g.lastDrill < DRILL_COOLDOWN) return 'cooldown';
  const [dx, dy] = STEP[g.mole.facing];
  const x = g.mole.x + dx;
  const y = g.mole.y + dy;
  const target = cellAt(g, x, y);
  if (!target || target.falling) {
    // fresh presses can still come faster than a swing: at most one whiff per swing time
    if (!opts.quiet && g.time - Math.max(g.lastDrill, g.lastWhiff) >= DRILL_COOLDOWN - 1e-9) {
      g.lastWhiff = g.time;
      g.events.push({ type: 'whiff', dir: g.mole.facing });
    }
    return target ? 'falling' : 'empty';
  }
  g.lastDrill = g.time;
  const i = idx(g.cols, x, y);
  // grabbing a capsule/friend with the hammer is free, like walking into it (review)
  if (!PICKUPS.has(target.color)) {
    g.stats.swings++;
    if (g.stage.air.kind === 'swing') drainAir(g, g.stage.air.perSwing[g.level - 1]);
    if (g.state !== 'playing') return 'hit'; // that swing used the last of the air (review)
  }

  if (PICKUPS.has(target.color)) {
    g.cells[i] = null;
    takePickup(g, target.color, x, y);
    return 'hit';
  }
  if (target.color === CLEAR) {
    clearLevel(g, y);
    return 'hit';
  }
  if (target.color === XBLOCK) {
    // only the struck X block breaks, never its whole chunk
    target.hp--;
    if (target.hp > 0) {
      g.events.push({ type: 'chip', x, y, hp: target.hp });
      return 'hit';
    }
    addScore(g, SCORE_DRILL);
    g.events.push({ type: 'xbreak', x, y });
    const cells = removeCells(g, [i]);
    g.events.push({ type: 'drill', cells });
    tagCombo(g, cells);
    if (g.stage.air.kind !== 'none') drainAir(g, g.stage.air.kind === 'swing' ? g.stage.air.xBreakAir : AIR_XBLOCK);
    return 'hit';
  }
  const { labels } = computeChunks(g);
  const members: number[] = [];
  for (let c = 0; c < g.cells.length; c++) if (labels[c] === labels[i]) members.push(c);
  addScore(g, SCORE_DRILL * members.length);
  const cells = removeCells(g, members);
  g.events.push({ type: 'drill', cells });
  tagCombo(g, cells);
  return 'hit';
}

// A hammer hit inside the combo window tags the block resting right on what it broke: if its
// chunk falls and pops, the player made that pop (tags on chunks that stay put are wiped next
// tick). Stacks further up only fall because that one did, so they are not the hit's doing.
function tagCombo(g: Game, cells: Pos[]) {
  if (g.comboTimer <= 0) return;
  for (const { x, y } of cells) {
    const above = y > 0 ? g.cells[idx(g.cols, x, y - 1)] : null;
    if (above) above.comboTag = true;
  }
}

// Drilling the aqua row that ends a level wipes it and everything above, so leftovers from
// the finished level can no longer fall on the mole.
function clearLevel(g: Game, row: number) {
  const bonus = levelIn(depthOfRow(row), g.levels.length) * SCORE_LEVEL_CLEAR;
  for (let i = 0; i < (row + 1) * g.cols; i++) g.cells[i] = null;
  addScore(g, bonus);
  g.events.push({ type: 'levelclear', y: row, bonus });
}

export function update(g: Game, dt: number): void {
  if (g.state !== 'playing') return;
  g.time += dt;
  g.mole.invuln = Math.max(0, g.mole.invuln - dt);
  if (g.stage.air.kind === 'time') drainAir(g, levelAt(g).airDrain * levelAirTempo(g) * dt);
  g.acc += dt;
  while (g.acc >= TICK && g.state === 'playing') {
    g.acc -= TICK;
    tick(g);
  }
}

function drainAir(g: Game, amount: number) {
  if (g.state !== 'playing') return;
  g.air -= amount;
  if (g.air > 0) return;
  g.events.push({ type: 'suffocate' });
  loseLife(g, AIR_RESPAWN_SUFFOCATE);
}

// Thaw ice melts while any side is open (the mole's cell counts as open; off-board counts as
// filled). A melted cell is removed; what rested on it then wobbles and falls as usual.
function meltThaw(g: Game) {
  const moleIdx = idx(g.cols, g.mole.x, g.mole.y);
  const open = (x: number, y: number) =>
    x >= 0 && x < g.cols && y >= 0 && y < g.rows && (!g.cells[idx(g.cols, x, y)] || idx(g.cols, x, y) === moleIdx);
  for (let i = 0; i < g.cells.length; i++) {
    const c = g.cells[i];
    if (!c || c.color !== THAW || c.falling) continue;
    const x = i % g.cols, y = Math.floor(i / g.cols);
    // the cell's own level sets its timer (the mole may still stand on the previous level's row)
    const thawTime = g.levels[levelIn(depthOfRow(y), g.levels.length) - 1].thawTime;
    if (!thawTime) continue;
    if (!(open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1))) continue;
    c.melt += TICK;
    if (c.melt < thawTime - 1e-9) continue;
    g.cells[i] = null;
    // tag the stack that rested on it: if that stack falls and pops, the melt made the chain
    for (let yy = y - 1; yy >= 0; yy--) {
      const above = g.cells[idx(g.cols, x, yy)];
      if (!above) break;
      above.meltTag = true;
    }
    g.events.push({ type: 'melt', x, y });
  }
}

// Endless stages: when the mole gets within this many rows of the bottom, add the next 100m.
const ENDLESS_LOOKAHEAD = 60;
// Grow an endless board until row y has the usual lookahead below it (also used to start deep).
export function ensureRows(g: Game, y: number) {
  while (g.stage.endless && g.rows - y <= ENDLESS_LOOKAHEAD) extendEndless(g, y);
}
function extendEndless(g: Game, y = g.mole.y) {
  const next = g.stage.endless;
  if (!next || g.rows - y > ENDLESS_LOOKAHEAD) return;
  g.levels.push(next(g.levels.length + 1));
  const from = g.rows;
  g.rows += LEVEL_DEPTH;
  for (let i = 0; i < g.cols * LEVEL_DEPTH; i++) g.cells.push(null);
  g.capRow = fillRows(g.cells, g.cols, from, g.rows, g.stage, g.levels, g.rand, g.capRow, g);
}

export function tick(g: Game): void {
  extendEndless(g);
  meltThaw(g);
  const { labels, chunks } = computeChunks(g);
  const tempo = levelTempo(g);
  const wobbleTime = levelAt(g).wobble / tempo;
  const fallSpeed = levelAt(g).fallSpeed * tempo;
  // Falling blocks advance one row per fall step; everything else runs every tick.
  g.fallAcc += TICK;
  const fallStep = g.fallAcc >= 1 / fallSpeed;
  if (fallStep) g.fallAcc -= 1 / fallSpeed;
  const moving: number[][] = [];
  const pops: [number[], number, number, boolean][] = []; // members, chain, melt root (-1 = new), drillMade
  g.comboTimer = Math.max(0, g.comboTimer - TICK);

  for (const members of chunks) {
    if (canFall(g, labels, members)) {
      let ready = false;
      for (const c of members) {
        const cell = g.cells[c]!;
        cell.wobble += TICK;
        if (cell.falling || cell.wobble >= wobbleTime - 1e-9) ready = true;
      }
      if (ready) {
        for (const c of members) g.cells[c]!.falling = true;
        if (fallStep) moving.push(members);
      }
      continue;
    }
    const wasFalling = members.some((c) => g.cells[c]!.falling);
    const released = Math.max(...members.map((c) => g.cells[c]!.chain));
    const meltMade = members.some((c) => g.cells[c]!.meltTag);
    const meltRoot = Math.max(...members.map((c) => g.cells[c]!.meltRoot));
    const drillMade = members.some((c) => g.cells[c]!.comboTag);
    for (const c of members) {
      const cell = g.cells[c]!;
      cell.wobble = 0;
      cell.falling = false;
      cell.chain = 0; // settled: a later fall starts a fresh cascade
      cell.meltTag = false;
      cell.meltRoot = 0;
      cell.comboTag = false;
    }
    if (!wasFalling) continue;
    const c = members[0];
    const color = g.cells[c]!.color;
    if ((color >= 0 || color === XBLOCK) && members.length >= POP_SIZE) {
      pops.push([members, released + 1, meltMade ? -1 : meltRoot, drillMade]);
    } else {
      g.events.push({ type: 'land', x: c % g.cols, y: Math.floor(c / g.cols) });
    }
  }
  // Pop after the scan, so settling chunks can't wipe the chain tags a pop just handed out.
  for (const [members, chain, meltRoot, drillMade] of pops) popChunk(g, members, chain, meltRoot, drillMade);
  // the window ran out without a pop: combo over (a stack tagged in it that pops later starts a
  // fresh combo at 1)
  if (g.comboTimer <= 0 && !pops.length) g.combo = 0;

  // Every target cell was empty or part of the same chunk, so moving all at once never collides.
  const moleIdx = idx(g.cols, g.mole.x, g.mole.y);
  const lifted = moving.map((members) => members.map((c) => [c, g.cells[c]!] as const));
  for (const members of moving) for (const c of members) g.cells[c] = null;
  for (const members of lifted) {
    if (members.some(([c]) => c + g.cols === moleIdx)) {
      if (PICKUPS.has(members[0][1].color)) takePickup(g, members[0][1].color, g.mole.x, g.mole.y);
      else crushMole(g); // the chunk shatters on the mole
      if (g.state !== 'playing') return;
      continue;
    }
    for (const [c, cell] of members) {
      cell.falling = true;
      g.cells[c + g.cols] = cell;
    }
  }

  const m = g.mole;
  if (m.y < g.rows - 1 && !cellAt(g, m.x, m.y + 1)) {
    g.moleAcc += TICK;
    if (g.moleAcc >= 1 / MOLE_FALL_SPEED) {
      g.moleAcc -= 1 / MOLE_FALL_SPEED;
      m.y++;
    }
  } else {
    g.moleAcc = 0;
  }

  const level = levelIn(depthOfRow(m.y), g.levels.length);
  if (level > g.level) {
    g.level = level;
    g.events.push({ type: 'level', level });
  }
  if (m.y === g.rows - 1 && !g.stage.endless) {
    const bonus = g.lives * SCORE_LIFE_BONUS;
    g.score += bonus;
    g.state = 'won';
    g.events.push({ type: 'won', bonus });
  }
}

// meltRoot: -1 starts a melt chain (thaw ice let this stack drop), > 0 continues that one's
// cascade, 0 = none. A melt chain counts toward meltChains2 once, when its cascade first reaches
// step 2: a melt that just drops a stack into a pop is luck, one that sets off the next is a plan
// (studio review 2 item 16: the old count was 17-20 a run for the mindless bot).
function popChunk(g: Game, members: number[], chain: number, meltRoot = 0, drillMade = false) {
  g.stats.maxChain = Math.max(g.stats.maxChain, chain);
  if (meltRoot < 0) meltRoot = ++g.stats.meltChains;
  if (meltRoot > 0 && chain >= 2 && !g.meltReached.includes(meltRoot)) {
    g.meltReached.push(meltRoot);
    g.stats.meltChains2 = (g.stats.meltChains2 ?? 0) + 1;
  }
  // drillMade is only ever set inside the window (tagCombo), so it always counts
  if (drillMade) {
    g.combo++;
    g.stats.maxCombo = Math.max(g.stats.maxCombo ?? 0, g.combo);
    g.events.push({ type: 'combo', n: g.combo });
  }
  // any pop opens the window, but a running combo is kept alive only by the player's own pops
  if (drillMade || g.combo === 0) g.comboTimer = COMBO_WINDOW;
  const step = chain + g.combo; // the pop's pitch and weight in the renderer
  const points = Math.round(SCORE_POP * members.length * popScoreMul(chain, g.combo));
  addScore(g, points);
  const air = chainAir(chain); // cascade only: see COMBO_WINDOW
  g.air = Math.min(airCap(g), g.air + air);
  const xPop = g.cells[members[0]]!.color === XBLOCK;
  const cells = removeCells(g, members);
  g.events.push({ type: 'pop', cells, chain, step, air, points, melt: meltRoot });
  if (xPop && g.stage.friends) {
    // deterministic pick among the popped cells, so fixed courses replay the same
    const at = members[(members.length * 7 + g.stats.friends * 3) % members.length];
    g.cells[at] = makeCell(FRIEND);
    g.events.push({ type: 'friend-spawn', x: at % g.cols, y: Math.floor(at / g.cols) });
  }
  // Tag the stacks resting on the cleared cells: if they fall and pop, that's the next step.
  // Tags on stacks that stay supported are wiped on the next tick when they settle.
  for (const { x, y } of cells) {
    for (let yy = y - 1; yy >= 0; yy--) {
      const above = g.cells[idx(g.cols, x, yy)];
      if (!above) break;
      above.chain = Math.max(above.chain, chain);
      if (meltRoot > 0) above.meltRoot = meltRoot;
    }
  }
}

function crushMole(g: Game): void {
  const { x, y } = g.mole;
  if (g.mole.invuln > 0) {
    g.events.push({ type: 'shield', x, y }); // the block shatters harmlessly: no crush effect
    return;
  }
  g.events.push({ type: 'crush', x, y });
  loseLife(g, AIR_RESPAWN_CRUSH);
}

// Losing a life refills the air (how far depends on the death) and clears the cells right above
// the mole, so it is not crushed again the instant it respawns.
function loseLife(g: Game, refill: number): void {
  g.combo = 0;
  g.comboTimer = 0;
  // a stack set loose before the death must not pop a combo after the respawn (bug review 4)
  for (const c of g.cells) if (c) c.comboTag = false;
  g.lives--;
  g.stats.livesLost++;
  if (g.lives <= 0) {
    g.air = Math.max(0, g.air);
    g.state = 'lost';
    g.events.push({ type: 'lost' });
    return;
  }
  g.air = refill;
  g.mole.invuln = INVULN_TIME;
  for (let dy = 1; dy <= 3; dy++) {
    const y = g.mole.y - dy;
    if (y >= 0) g.cells[idx(g.cols, g.mole.x, y)] = null;
  }
}

export function depthOf(g: Game): number {
  return Math.max(0, depthOfRow(g.mole.y));
}
