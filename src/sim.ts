// Headless simulation bots for calibrating stages. Pure: drives the game logic in fixed steps,
// no DOM. Policies are simple, deterministic functions of the game state.
import {
  CAPSULE, Cell, cellAt, chainScoreMul, computeChunks, createGame, depthOf, drill, DRILL_COOLDOWN, Game, idx,
  keyPieceBelow, LEVEL_DEPTH, move, Placement, SCORE_POP, SKY_ROWS, StageDef, TICK, update, XBLOCK,
} from './game';
import { StageInfo, STAGES } from './stages';

export type Action = 'left' | 'right' | 'down' | 'up' | 'drill' | 'wait';
export type Policy = (g: Game) => Action;
type Side = -1 | 1;

// ---------- board queries ----------

const isX = (c: ReturnType<typeof cellAt>) => c?.color === XBLOCK;
// everything but an X block breaks in one swing (colours, capsules, thaw ice, the clear row)
const oneHit = (c: ReturnType<typeof cellAt>) => !!c && !c.falling && c.color !== XBLOCK;
const walkable = (c: ReturnType<typeof cellAt>) => !c || (c.color === CAPSULE && !c.falling);
const sideDir = (d: Side): Action => (d < 0 ? 'left' : 'right');
const drillReady = (g: Game) => g.time - g.lastDrill >= DRILL_COOLDOWN;
const airborne = (g: Game) => g.mole.y < g.rows - 1 && !cellAt(g, g.mole.x, g.mole.y + 1);

// Is something above (x, y) coming down this column? The first settled cell overhead shields the
// mole. (A careful variant that also feared shaking cells behind such a shield was tried: it
// detoured less, broke more X blocks and suffocated far more often, so both policies use this.)
function threat(g: Game, x: number, y: number): boolean {
  for (let yy = y - 1; yy >= 0; yy--) {
    const c = cellAt(g, x, yy);
    if (c) return c.falling || c.wobble > 0;
  }
  return false;
}

// The cell the mole would end up standing on in column x, falling from row y.
function floorUnder(g: Game, x: number, y: number) {
  for (let yy = y + 1; yy < g.rows; yy++) {
    const c = cellAt(g, x, yy);
    if (c) return c;
  }
  return null;
}

// Sides to try, the one toward the centre first (keeps the bot off the walls, deterministic).
const sides = (g: Game): Side[] => (g.mole.x < Math.floor(g.cols / 2) ? [1, -1] : [-1, 1]);

// Turn to `dir` then swing. Turning sideways into a block can climb it; that is accepted.
function swing(g: Game, dir: 'left' | 'right' | 'down'): Action {
  if (g.mole.facing !== dir) return dir;
  return drillReady(g) ? 'drill' : 'wait';
}

// Step to the side d: walk if open, else chip the 1-hit block in the way. null if walled by X.
function stepSide(g: Game, d: Side): Action | null {
  const s = cellAt(g, g.mole.x + d, g.mole.y);
  if (walkable(s)) return sideDir(d);
  if (oneHit(s)) return swing(g, d < 0 ? 'left' : 'right');
  return null;
}

// Standing in column x on the mole's row: would drilling the chunk below free a chunk that has a
// cell overhead in column x?
function freesOverhead(g: Game, x: number): boolean {
  const { y } = g.mole;
  const target = cellAt(g, x, y + 1);
  if (!target || target.color === XBLOCK) return false;
  const { labels, chunks } = computeChunks(g);
  const t = labels[idx(g.cols, x, y + 1)];
  const seen = new Set<number>();
  for (const c of chunks[t]) {
    const above = c - g.cols;
    if (above < 0 || !g.cells[above] || labels[above] === t) continue;
    const d = labels[above];
    if (seen.has(d)) continue;
    seen.add(d);
    const members = chunks[d];
    const falls = members.every((m) => {
      const b = m + g.cols;
      return b < g.cells.length && (!g.cells[b] || labels[b] === t || labels[b] === d);
    });
    if (falls && members.some((m) => m % g.cols === x && Math.floor(m / g.cols) < y)) return true;
  }
  return false;
}

// Nearest column within DETOUR_REACH along this row with a good floor (not an X block), reached
// without breaking an X block or passing under a falling chunk. Cost: columns walked + blocks to
// chip (an X block costs 5 swings and, on time stages, 20% air). Returns the first step, or null.
const DETOUR_REACH = 3;
function detour(g: Game, safeCol: (x: number) => boolean, goodFloor: (x: number) => boolean): Action | null {
  const { x, y } = g.mole;
  let best: { d: Side; cost: number } | null = null;
  for (const d of sides(g)) {
    let cost = 0;
    for (let k = 1; k <= DETOUR_REACH; k++) {
      const nx = x + d * k;
      if (nx < 0 || nx >= g.cols || !safeCol(nx)) break;
      const s = cellAt(g, nx, y);
      if (!walkable(s) && !oneHit(s)) break;
      cost += walkable(s) ? 1 : 2;
      if (!goodFloor(nx)) continue;
      if (!best || cost < best.cost) best = { d, cost };
      break;
    }
  }
  return best && stepSide(g, best.d);
}

// ---------- policies ----------

interface Style {
  careful: boolean;
}

// Round 3: two columns each over an X, the way out of one unsafe from the other, made the detour
// bounce between them until the run timed out (igloo 3 of 40 planner seeds, the ice slide's one
// course for the slow chain-blind bot). A player stuck that long breaks the X instead.
const STUCK_TIME = 2.5; // s without a new row (our tuning)
const progress = new WeakMap<Game, { y: number; t: number }>();
function stuck(g: Game): boolean {
  const p = progress.get(g);
  if (!p || g.mole.y > p.y || g.time < p.t) { progress.set(g, { y: g.mole.y, t: g.time }); return false; }
  return g.time - p.t > STUCK_TIME;
}

function play(g: Game, { careful }: Style): Action {
  if (g.state !== 'playing' || airborne(g)) return 'wait';
  const { x, y } = g.mole;
  const below = cellAt(g, x, y + 1);
  const safeCol = (cx: number) => !threat(g, cx, y);

  // 1. Flee a chunk shaking or falling into this column; if boxed in, dig down to outrun it.
  if (threat(g, x, y)) {
    for (const d of sides(g)) {
      if (walkable(cellAt(g, x + d, y)) && x + d >= 0 && x + d < g.cols && safeCol(x + d)) return sideDir(d);
    }
    return oneHit(below) ? swing(g, 'down') : 'wait';
  }

  // 2. Careful: low on air, grab a capsule within two columns (this row or the next two) that can be
  // reached along this row without breaking an X block or passing under a falling chunk.
  if (careful && g.air < 50) {
    const open = (dx: number) => {
      for (let k = 1; k <= Math.abs(dx); k++) {
        const nx = x + Math.sign(dx) * k;
        const s = cellAt(g, nx, y);
        if (nx < 0 || nx >= g.cols || !safeCol(nx) || !(walkable(s) || oneHit(s))) return false;
      }
      return true;
    };
    let best: { dx: number; cost: number } | null = null;
    for (let dy = 0; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const c = cellAt(g, x + dx, y + dy);
        if (c?.color !== CAPSULE || c.falling || !open(dx)) continue;
        const cost = Math.abs(dx) + dy;
        if (!best || cost < best.cost) best = { dx, cost };
      }
    }
    // dx === 0: the capsule is straight down, and digging takes it
    if (best && best.dx !== 0) {
      const a = stepSide(g, best.dx < 0 ? -1 : 1);
      if (a) return a;
    }
  }

  // 3. Step around an X block below (or, careful, around a chunk propping up a stack overhead).
  // Careful also refuses floors that would drop a stack on it, so it cannot bounce between two.
  const goodFloor = (cx: number) => !isX(floorUnder(g, cx, y)) && !(careful && freesOverhead(g, cx));
  const avoid = !goodFloor(x) && !stuck(g);
  if (avoid) {
    const a = detour(g, safeCol, goodFloor);
    if (a) return a;
  }

  // 4. Dig down.
  return below && !below.falling ? swing(g, 'down') : 'wait';
}

export const greedy: Policy = (g) => play(g, { careful: false });
export const careful: Policy = (g) => play(g, { careful: true });

// ---------- planner ----------
// A one-step lookahead bot (review item 6): every REPLAN_EVERY seconds on the ground it tries a few
// short intents (dig here, shift a column or two first, or hold still), plays each out on a copy of
// the board with greedy as the continuation, and commits to the best. It measures how much a player
// who reads falling stacks gains over the skill-floor bots ("skill gap"). All numbers are our tuning.

// Shift to column x0 + dx (walking or chipping), hold for `wait` seconds, then dig greedily.
interface Intent { dx: number; wait: number }
const INTENTS: Intent[] = [
  { dx: 0, wait: 0 }, { dx: -1, wait: 0 }, { dx: 1, wait: 0 }, { dx: -2, wait: 0 }, { dx: 2, wait: 0 },
  { dx: 0, wait: 0.4 }, // let a shaking stack drop past or settle into a pop first
];
// How often and how far a planner looks. The full planner clears every finite stage (aurora too),
// so it is a ceiling rather than a difficulty measure. The slow one (design review 2) reads the
// board about once a second and commits in between, like a player who plans but reacts late:
// a shorter horizon alone barely hurt (0.6 s still cleared 100% of the lake), the decision rate
// is what separates (1.2 s: lake 90%, aurora 70%; 2 s: both 55%; 20 seeds). Our tuning.
export interface Sight { replanEvery: number; horizon: number }
export const FULL_SIGHT: Sight = {
  replanEvery: 0.45, // s between decisions while grounded (cost scales inversely)
  horizon: 1.5, // s of rollout per intent (a wobble ~1 s plus the fall it starts)
};
export const SLOW_SIGHT: Sight = { replanEvery: 1.2, horizon: 1.0 };
const PLAN_BUDGET = 7 * 90; // max rollout ticks per decision (6 intents + the key one, x 1.5 s at 60 Hz)
const ROLL_ABOVE = 20; // rows above the mole copied into a rollout (farther stacks cannot land in time)
const ROLL_BELOW = 16; // rows below; the rollout stops before it reaches the cut

interface Committed { tx: number; wait: number; holdUntil: number | null }
interface PlanState { at: number; intent: Committed | null }

function follow(g: Game, it: Committed): Action {
  if (g.state !== 'playing' || airborne(g)) return 'wait';
  if (g.mole.x !== it.tx) {
    const a = stepSide(g, it.tx < g.mole.x ? -1 : 1);
    if (a) return a;
    it.tx = g.mole.x; // walled by an X block: dig from here instead
  }
  if (it.holdUntil === null) it.holdUntil = g.time + it.wait;
  if (g.time < it.holdUntil && !threat(g, g.mole.x, g.mole.y)) return 'wait';
  return greedy(g);
}

// A cheap private copy for rollouts: rows far above the mole are dropped (whole chunks only, so
// nothing below loses support) and the board is cut a little below it. The copy is also shifted up
// by whole 100m levels (with g.levels/g.level shifted to match, so drain, wobble and thaw timers are
// unchanged): on a deep endless run the board array is otherwise thousands of rows long and every
// rollout tick scans all of it. Endless growth is off and the RNG stubbed: the copy never generates
// rows. Other fields are numbers (combo, timers) and copy by value.
function rolloutCopy(g: Game): Game {
  const { cols } = g;
  const top = Math.max(0, g.mole.y - ROLL_ABOVE);
  const bottom = Math.min(g.rows, g.mole.y + ROLL_BELOW);
  const lv = Math.min(g.level - 1, Math.floor(Math.max(0, top - SKY_ROWS) / LEVEL_DEPTH)); // levels shifted out (every copied row keeps its level)
  const shift = lv * LEVEL_DEPTH;
  const cells: Game['cells'] = new Array((bottom - shift) * cols).fill(null);
  if (top > shift) {
    const { labels } = computeChunks(g);
    const keep = new Set<number>();
    for (let i = top * cols; i < (top + 1) * cols; i++) if (g.cells[i]) keep.add(labels[i]);
    for (let i = shift * cols; i < top * cols; i++) {
      const c = g.cells[i];
      if (c && keep.has(labels[i])) cells[i - shift * cols] = { ...c };
    }
  }
  for (let i = top * cols; i < bottom * cols; i++) {
    const c = g.cells[i];
    if (c) cells[i - shift * cols] = { ...c };
  }
  return {
    ...g,
    stage: g.stage.endless ? { ...g.stage, endless: undefined } : g.stage,
    levels: g.levels.slice(lv),
    level: g.level - lv,
    rand: () => 0.5,
    rows: bottom - shift,
    cells,
    mole: { ...g.mole, y: g.mole.y - shift },
    events: [],
    stats: { ...g.stats, levelCapsules: [] },
  };
}

// What a rollout values besides survival, air and depth (our tuning). chain scales the pop term;
// 0 makes a bot that never aims for chains (review 2: if it clears as often as the planner, chains
// are free and not a skill). friend: per frozen friend rescued (review 3 item 16), so the lake's
// friend medals measure a bot that wants friends; +10 is about one row of depth, enough to break
// ties toward a friend without walking into danger for one.
// chainAir: the share of the air a rollout's pops gave that counts toward its air term. The
// chain-blind planner used to keep it all, so it still chased cascades whenever air ran short (air
// is the planner's main survival signal) and "chain need" read 0-5 points by construction (round 3
// review); now it values only capsule and X-block air, like a player who never plans a cascade.
// key: the planner knows the key-column technique (item 1): with a bait piece just below, it also
// tries walking to the key column, credited with the cascade the piece promises (the rollout is too
// short to see a cascade 8 rows down resolve). Without it the planner shifted at most two columns
// and found key columns by luck, so it got only ~2 more step-3 pops a run than the chain-blind
// one. A player who learned the trick does this; 0 = never.
export interface Weights { chain: number; friend: number; chainAir: number; key: number }
export const PLAN_WEIGHTS: Weights = { chain: 1, friend: 10, chainAir: 1, key: 1 };

const KEY_AHEAD = 10; // rows: a key piece whose top is this close below is worth steering for
const KEY_REACH = 4; // columns the planner will walk for one

// Plays one intent out and scores the result. Weights are our tuning: a lost life outweighs
// everything, then chains (superlinear in the effective step = cascade + action combo, the thing
// we want players to chase), air, depth.
function rollout(g: Game, it: Intent, lastMove: number, horizon: number, w: Weights): number {
  const c = rolloutCopy(g);
  const ctl: Committed = { tx: g.mole.x + it.dx, wait: it.wait, holdUntil: null };
  const ctx = { lastMove };
  const y0 = c.mole.y;
  const air0 = c.air;
  const lives0 = c.stats.livesLost;
  const friends0 = c.stats.friends;
  const stop = c.rows - 3;
  let chain = 0, popAir = 0;
  const ticks = Math.round(horizon / TICK);
  for (let t = 0; t < ticks && c.state === 'playing' && c.mole.y < stop; t++) {
    apply(c, follow(c, ctl), ctx, TICK, 0.1);
    for (const e of c.events) {
      if (e.type !== 'pop') continue;
      if (e.step >= 2) chain += w.chain * 30 * e.step * e.step;
      popAir += e.air;
    }
    c.events.length = 0;
    if (c.stats.livesLost > lives0) break;
  }
  const died = c.stats.livesLost - lives0;
  const lowAir = air0 < 40 ? 3 : 1; // air is worth more when it is short
  let score = -1000 * died + 8 * (c.mole.y - y0) + chain + w.friend * (c.stats.friends - friends0);
  if (!died) score += lowAir * (c.air - air0 - (1 - w.chainAir) * popAir);
  // ending under a stack that is about to come down is a death the horizon did not reach
  if (!died && c.state === 'playing' && threat(c, c.mole.x, c.mole.y)) score -= 150;
  return score;
}

// The runner's last sideways input time, so rollouts honour the same input rate.
let runnerLastMove = -Infinity;

export function makePlanner({ replanEvery, horizon }: Sight, weights: Weights = PLAN_WEIGHTS): Policy {
  const plans = new WeakMap<Game, PlanState>(); // per bot, so two planners can share a game safely
  return (g) => {
    let st = plans.get(g);
    if (!st) plans.set(g, (st = { at: -Infinity, intent: null }));
    if (g.state === 'playing' && !airborne(g) && g.time - st.at >= replanEvery - 1e-9) {
      st.at = g.time;
      let best: { it: Intent; s: number } | null = null;
      let spent = 0;
      const key = weights.key ? keyPieceBelow(g, KEY_AHEAD) : null;
      const kdx = key ? key.x - g.mole.x : 0;
      const keyIt: Intent | null = key && kdx && Math.abs(kdx) <= KEY_REACH ? { dx: kdx, wait: 0 } : null;
      for (const it of keyIt && !INTENTS.some((i) => i.dx === kdx && !i.wait) ? [...INTENTS, keyIt] : INTENTS) {
        const tx = g.mole.x + it.dx;
        if (tx < 0 || tx >= g.cols) continue;
        if (it.dx && !stepSide(g, it.dx < 0 ? -1 : 1)) continue; // walled by an X block
        if (spent + horizon / TICK > PLAN_BUDGET) break;
        spent += horizon / TICK;
        let s = rollout(g, it, runnerLastMove, horizon, weights);
        // the promised cascade, steps 2..chain, at the rollout's chain value (only if it survived)
        if (key && it.dx === kdx && !it.wait && s > -500) for (let k = 2; k <= key.chain; k++) s += weights.key * weights.chain * 30 * k * k;
        // ties keep the earlier (simpler) intent, so the plan is deterministic
        if (!best || s > best.s) best = { it, s };
      }
      st.intent = best ? { tx: g.mole.x + best.it.dx, wait: best.it.wait, holdUntil: null } : null;
    }
    return st.intent ? follow(g, st.intent) : greedy(g);
  };
}
export const planner = makePlanner(FULL_SIGHT);
export const slowPlanner = makePlanner(SLOW_SIGHT);
// the planner blind to chains and combos (review 3 item 2): "chain need" = planner − this
export const plannerNoChain = makePlanner(FULL_SIGHT, { ...PLAN_WEIGHTS, chain: 0, chainAir: 0, key: 0 });
// the same for the slow planner: the full planner survives on reading alone (it clears every finite
// stage chain-blind at any drain we tried, x1.6 included), so the human-like chain need is slow − this
export const slowNoChain = makePlanner(SLOW_SIGHT, { ...PLAN_WEIGHTS, chain: 0, chainAir: 0, key: 0 });

export const POLICIES: Record<string, Policy> = { greedy, careful, slow: slowPlanner, slowNoChain, planner, plannerNoChain };

// ---------- runner ----------

// One input then one step of time, rate-limiting sideways inputs like a human thumb.
function apply(g: Game, a: Action, ctx: { lastMove: number }, dt: number, moveInterval: number) {
  if (a === 'drill') drill(g);
  else if (a === 'up' || a === 'down') move(g, a);
  else if ((a === 'left' || a === 'right') && g.time - ctx.lastMove >= moveInterval) {
    move(g, a);
    ctx.lastMove = g.time;
  }
  update(g, dt);
}

// Melt chains that went somewhere (review 3 item 16): a melt-made pop starts a cascade, and the
// cascade counts once if any pop in it reached step 2. Cells carry the cascade they were set loose
// by (a WeakMap, so the board window's slices keep it); the pop's cells are looked up in a snapshot
// taken before the tick (the sim runs exactly one tick per step, and a landed chunk pops where it
// stands). Roots match g.stats.meltChains one to one (checked in sim.test.ts).
class MeltTracker {
  private readonly lineage = new WeakMap<Cell, number>();
  private readonly pre = new Map<number, number>(); // board index -> root, -1 = melt-tagged
  private readonly reached = new Set<number>();
  roots = 0;
  get chains2() { return this.reached.size; }
  before(g: Game) {
    this.pre.clear();
    if (!g.levels.some((l) => l.thawTime)) return; // no thaw ice, no melts
    for (let i = 0; i < g.cells.length; i++) {
      const c = g.cells[i];
      if (!c) continue;
      const r = c.meltTag ? -1 : this.lineage.get(c);
      if (r !== undefined) this.pre.set(i, r);
    }
  }
  pop(g: Game, e: { cells: { x: number; y: number }[]; chain: number }) {
    if (!this.pre.size) return;
    let root: number | undefined;
    let fresh = false;
    for (const { x, y } of e.cells) {
      const r = this.pre.get(idx(g.cols, x, y));
      if (r === -1) fresh = true;
      else if (r !== undefined) root ??= r;
    }
    if (fresh) root = this.roots++; // what the game counts as a melt chain
    if (root === undefined) return;
    if (e.chain >= 2) this.reached.add(root);
    // the stacks this pop tagged (the game walks the same columns up to the first gap)
    for (const { x, y } of e.cells) {
      for (let yy = y - 1; yy >= 0; yy--) {
        const c = cellAt(g, x, yy);
        if (!c) break;
        this.lineage.set(c, root);
      }
    }
  }
}

// Where hand-made pieces sit (studio review item 3: do bosses and pieces kill?), as depth bands
// [from, to) around the placements the game records (g.pieces). A band starts one row above the
// piece (the mole stands on its top row) and ends one below (its last row coming down on the mole
// under it).
export interface Zone { from: number; to: number; boss: boolean }
export const pieceZones = (pieces: Placement[]): Zone[] =>
  pieces.map((p) => ({ from: p.top - 1, to: p.top + p.rows + 1, boss: p.boss }));
// share of [0, depth) inside boss / other piece bands (the baseline a death share is read against)
function zoneCover(zones: Zone[], depth: number): [number, number] {
  const cover = (boss: boolean) =>
    zones.filter((z) => z.boss === boss).reduce((n, z) => n + Math.max(0, Math.min(z.to, depth) - Math.max(z.from, 0)), 0) / Math.max(1, depth);
  return [cover(true), cover(false)];
}
const zoneAt = (zones: Zone[], depth: number) => zones.find((z) => depth >= z.from && depth < z.to);

export type Cause = 'won' | 'crushed' | 'suffocated' | 'timeout' | 'capped';
export interface Death { cause: 'crushed' | 'suffocated'; depth: number; zone: 'boss' | 'piece' | null }
export interface SimResult {
  won: boolean;
  depth: number; // deepest metre reached
  time: number;
  score: number;
  swings: number;
  livesLost: number;
  maxChain: number;
  meltChains: number;
  friends: number;
  levelCapsules: number[];
  clockSaved: number;
  airMin: number;
  cause: Cause;
  deaths: Death[]; // every life lost, with the metre it happened at
  chainSteps: [number, number, number, number]; // pops at cascade step 1 / 2 / 3 / 4+ (combo not added)
  maxCombo: number; // longest action combo (REN)
  meltChains2: number; // melt chains whose cascade reached step 2 (g.stats.meltChains2 if the game keeps one)
  meltRoots: number; // melt chains the tracker saw (equals meltChains; a self-check)
  comboPoints: number; // pop points above what the same pop scores with no action combo
  extends: number; // 1UPs from score
  pieceCover: [number, number]; // share of the course (endless: of the depth reached) in boss / piece bands
  bossMetres: number; // metres of boss band this run actually dug through
}
export interface SimOptions {
  dt?: number; // seconds per step (default 1/60)
  maxTime?: number; // simulated-time cap (default 15 min)
  stallTime?: number; // give up as 'timeout' after this long without a new depth (default 120 s)
  moveInterval?: number; // minimum seconds between sideways inputs, a human-ish input rate (default 0.1)
  window?: boolean; // speed-up, see BoardWindow (default true)
  maxDepth?: number; // stop as 'capped' once this deep (endless calibration; default none)
}

export function simulate(stage: StageDef, seed: number, policy: Policy, opts: SimOptions = {}): SimResult {
  const { dt = 1 / 60, maxTime = 15 * 60, stallTime = 120, moveInterval = 0.1, window = true, maxDepth = Infinity } = opts;
  const g = createGame(seed, stage);
  // endless stages grow the board when the bottom gets near, so a truncated window would fake that
  const win = window && !stage.endless ? new BoardWindow(g) : null;
  const ctx = { lastMove: -Infinity };
  let hazard: 'crushed' | 'suffocated' = 'crushed';
  let cause: Cause = 'timeout';
  let airMin = g.air;
  let depth = 0;
  let progressAt = 0;
  const deaths: Death[] = [];
  const chainSteps: SimResult['chainSteps'] = [0, 0, 0, 0];
  const melt = new MeltTracker();
  let comboPoints = 0;
  let extendsGot = 0;

  while (g.state === 'playing' && g.time < maxTime && g.time - progressAt < stallTime && depth < maxDepth) {
    win?.fit();
    runnerLastMove = ctx.lastMove;
    const lives = g.stats.livesLost;
    const a = policy(g);
    melt.before(g);
    apply(g, a, ctx, dt, moveInterval);
    for (const e of g.events) {
      if (e.type === 'crush') hazard = 'crushed';
      else if (e.type === 'suffocate') {
        hazard = 'suffocated';
        airMin = 0;
      } else if (e.type === 'lost') cause = hazard;
      else if (e.type === 'won') cause = 'won';
      else if (e.type === 'extend') extendsGot++;
      else if (e.type === 'pop') {
        chainSteps[Math.min(4, e.chain) - 1]++;
        melt.pop(g, e);
        // the combo's cut: points at the pop's step minus at its cascade step alone
        if (e.step > e.chain) comboPoints += Math.max(0, e.points - Math.round(SCORE_POP * e.cells.length * chainScoreMul(e.chain)));
      }
    }
    g.events.length = 0;
    if (g.stats.livesLost > lives) {
      const d = depthOf(g);
      const z = zoneAt(pieceZones(g.pieces), d);
      deaths.push({ cause: hazard, depth: d, zone: z ? (z.boss ? 'boss' : 'piece') : null });
    }
    airMin = Math.min(airMin, g.air);
    const d = depthOf(g);
    if (d > depth) {
      depth = d;
      progressAt = g.time;
    }
  }
  win?.restore();
  const statM2 = (g.stats as Partial<Record<'meltChains2', number>>).meltChains2;
  return {
    ...g.stats, // any stat the medal tests read, including ones added after this was written
    won: g.state === 'won',
    depth,
    time: g.time,
    score: g.score,
    swings: g.stats.swings,
    livesLost: g.stats.livesLost,
    maxChain: g.stats.maxChain,
    meltChains: g.stats.meltChains,
    friends: g.stats.friends,
    levelCapsules: [...g.stats.levelCapsules],
    clockSaved: g.stats.clockSaved,
    airMin: Math.max(0, airMin),
    cause: g.state === 'won' ? 'won' : g.state === 'lost' ? cause : depth >= maxDepth ? 'capped' : 'timeout',
    deaths,
    chainSteps,
    maxCombo: g.stats.maxCombo ?? 0,
    meltChains2: statM2 ?? melt.chains2,
    meltRoots: melt.roots,
    comboPoints,
    extends: extendsGot,
    pieceCover: zoneCover(pieceZones(g.pieces), stage.endless ? depth : g.levels.length * LEVEL_DEPTH),
    bossMetres: zoneCover(pieceZones(g.pieces), depth)[0] * Math.max(1, depth),
  };
}

// The game scans the whole board every tick, but rows well below the mole are untouched and
// full (generation fills every cell), so they behave exactly like the board's floor. The window
// hides them by truncating g.cells/g.rows at a row boundary no chunk crosses, and puts them back
// before the mole gets near. Results are identical to a full-board run (checked in sim.test.ts).
const WINDOW_AHEAD = 40; // rows kept below the mole
const WINDOW_REFIT = 20; // refit once the mole is this close to the cut

class BoardWindow {
  private readonly full: number;
  private readonly hidden: Game['cells'];
  private cut: number;
  private retryAt = -1; // mole row before which a failed search is not retried
  constructor(private readonly g: Game) {
    this.full = g.rows;
    this.hidden = g.cells.slice();
    this.cut = g.rows;
  }
  fit() {
    const g = this.g;
    if (this.cut < this.full && g.mole.y + WINDOW_REFIT < this.cut) return;
    if (this.cut === this.full && (g.mole.y + WINDOW_AHEAD >= this.full - 1 || g.mole.y < this.retryAt)) return;
    this.restore();
    const { labels } = computeChunks(g);
    for (let cut = g.mole.y + WINDOW_AHEAD; cut < this.full - 1; cut++) {
      let crosses = false;
      for (let x = 0; x < g.cols && !crosses; x++) {
        const a = idx(g.cols, x, cut - 1);
        crosses = !!g.cells[a] && labels[a] === labels[a + g.cols];
      }
      if (crosses) continue;
      g.cells = g.cells.slice(0, cut * g.cols);
      g.rows = this.cut = cut;
      return;
    }
    this.retryAt = g.mole.y + 5;
  }
  restore() {
    const g = this.g;
    if (this.cut === this.full) return;
    g.cells = g.cells.concat(this.hidden.slice(this.cut * g.cols));
    g.rows = this.cut = this.full;
  }
}

// ---------- calibration ----------

export interface CalRow {
  stage: string;
  policy: string;
  runs: number;
  clearRate: number;
  medianDepth: number;
  medianTime: number;
  medianSwingsWon: number | null;
  swingsWonRange: [number, number] | null;
  medianLivesLost: number;
  chain2Rate: number;
  causes: Record<Cause, number>;
  // medal inputs (won runs): p10/p25 clear time, median melt chains / friends, and the share of
  // clears that got through at least one level without taking a capsule
  wonTimeP10: number | null;
  wonTimeP25: number | null;
  medMeltWon: number | null;
  medFriendsWon: number | null;
  p75FriendsWon: number | null;
  dryCleanRate: number | null;
  // skill metrics (review item 6): every life lost, not just the last
  medianScore: number;
  deathsCrushed: number;
  deathsAir: number;
  deathHist: number[]; // lives lost per 10m band within a 100m level (0-9m, 10-19m, ...)
  chainSteps: [number, number, number, number]; // pops at chain step 1 / 2 / 3 / 4+, all runs
  maxCombo: number; // best over the runs
  // share of runs reaching each medal by the stage's own criteria (endless: depthMedals; a capped
  // endless run can't show a medal deeper than the cap)
  medalRates: { bronze: number; silver: number; gold: number };
  // review 3 measurement
  medMelt2Won: number | null; // melt chains reaching step 2 (thaw silver input)
  chain2Share: number; // pops at cascade step 2+ / all pops
  comboShare: number; // combo points / final score, all runs pooled
  extendRate: number; // runs with at least one 1UP from score
  deathsBoss: number;
  deathsPiece: number;
  pieceCover: [number, number]; // mean over runs, see SimResult
  // lives lost per 100m dug inside boss bands / everywhere else (round 3: the share of lives lost in
  // the boss reads low when the bot seldom gets there, e.g. greedy reaches aurora's boss 1 run in 5)
  bossHazard: [number, number];
}

// 0 none / 1 bronze / 2 silver / 3 gold, mirroring progress.medalFor on a sim run
function medalRank(info: StageInfo, r: SimResult): number {
  if (info.depthMedals) return info.depthMedals.filter((d) => r.depth >= d).length;
  if (!r.won) return 0;
  return info.gold?.test(r) ? 3 : info.silver?.test(r) ? 2 : 1;
}

const pctl = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// m; well past the endless silver (600 m). Gold (3000 m) needs uncapped runs (~30 s of CPU each
// for the planner), so it is calibrated by hand with maxDepth. Our choice.
const ENDLESS_CAP = 1500;

export function calibrate(seeds: number, opts: SimOptions = {}, policies: Record<string, Policy> = POLICIES): CalRow[] {
  const rows: CalRow[] = [];
  for (const info of STAGES) {
    const { def } = info;
    for (const [name, policy] of Object.entries(policies)) {
      const rs: SimResult[] = [];
      // fixed-course stages are calibrated on the course they ship with (review 2)
      // endless runs stop at ENDLESS_CAP: the planner otherwise digs ~2 km per run (30 s of CPU each)
      const o = def.endless ? { maxDepth: ENDLESS_CAP, ...opts } : opts;
      if (def.seed !== undefined) rs.push(simulate(def, def.seed, policy, o));
      else for (let s = 1; s <= seeds; s++) rs.push(simulate(def, s, policy, o));
      const won = rs.filter((r) => r.won);
      const causes = { won: 0, crushed: 0, suffocated: 0, timeout: 0, capped: 0 };
      for (const r of rs) causes[r.cause]++;
      const ws = won.map((r) => r.swings);
      const deaths = rs.flatMap((r) => r.deaths);
      rows.push({
        stage: def.id,
        policy: name,
        runs: rs.length,
        clearRate: won.length / rs.length,
        medianDepth: median(rs.map((r) => r.depth)),
        medianTime: median(rs.map((r) => r.time)),
        medianSwingsWon: ws.length ? median(ws) : null,
        swingsWonRange: ws.length ? [Math.min(...ws), Math.max(...ws)] : null,
        medianLivesLost: median(rs.map((r) => r.livesLost)),
        chain2Rate: rs.filter((r) => r.maxChain >= 2).length / rs.length,
        causes,
        // clock-adjusted for time attack (clockSaved is 0 elsewhere)
        wonTimeP10: pctl(won.map((r) => r.time - r.clockSaved), 0.1),
        wonTimeP25: pctl(won.map((r) => r.time - r.clockSaved), 0.25),
        medMeltWon: won.length ? median(won.map((r) => r.meltChains)) : null,
        medFriendsWon: won.length ? median(won.map((r) => r.friends)) : null,
        p75FriendsWon: pctl(won.map((r) => r.friends), 0.75),
        dryCleanRate: won.length
          ? won.filter((r) => def.levels.some((_, i) => (r.levelCapsules[i] ?? 0) === 0)).length / won.length
          : null,
        medianScore: median(rs.map((r) => r.score)),
        deathsCrushed: deaths.filter((d) => d.cause === 'crushed').length,
        deathsAir: deaths.filter((d) => d.cause === 'suffocated').length,
        deathHist: Array.from({ length: 10 }, (_, b) => deaths.filter((d) => Math.floor((d.depth % 100) / 10) === b).length),
        chainSteps: [0, 1, 2, 3].map((k) => rs.reduce((n, r) => n + r.chainSteps[k], 0)) as CalRow['chainSteps'],
        maxCombo: Math.max(0, ...rs.map((r) => r.maxCombo)),
        medalRates: {
          bronze: rs.filter((r) => medalRank(info, r) >= 1).length / rs.length,
          silver: rs.filter((r) => medalRank(info, r) >= 2).length / rs.length,
          gold: rs.filter((r) => medalRank(info, r) >= 3).length / rs.length,
        },
        medMelt2Won: won.length ? median(won.map((r) => r.meltChains2)) : null,
        chain2Share: (() => {
          const all = rs.reduce((n, r) => n + r.chainSteps.reduce((a, b) => a + b, 0), 0);
          return all ? rs.reduce((n, r) => n + r.chainSteps[1] + r.chainSteps[2] + r.chainSteps[3], 0) / all : 0;
        })(),
        comboShare: rs.reduce((n, r) => n + r.comboPoints, 0) / Math.max(1, rs.reduce((n, r) => n + r.score, 0)),
        extendRate: rs.filter((r) => r.extends > 0).length / rs.length,
        deathsBoss: deaths.filter((d) => d.zone === 'boss').length,
        deathsPiece: deaths.filter((d) => d.zone === 'piece').length,
        pieceCover: [0, 1].map((k) => rs.reduce((n, r) => n + r.pieceCover[k], 0) / rs.length) as [number, number],
        bossHazard: (() => {
          const bossM = rs.reduce((n, r) => n + r.bossMetres, 0), allM = rs.reduce((n, r) => n + r.depth, 0);
          const inBoss = deaths.filter((d) => d.zone === 'boss').length;
          return [(100 * inBoss) / Math.max(1, bossM), (100 * (deaths.length - inBoss)) / Math.max(1, allM - bossM)] as [number, number];
        })(),
      });
    }
  }
  return rows;
}

export function calibrationTable(rows: CalRow[]): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const out = [
    '| stage | policy | runs | clear | med depth (m) | med time (s) | med swings (won) [min-max] | med lives lost | maxChain>=2 | crushed / suffocated / timeout / capped | won time p10/p25 | med melt (won) | friends med/p75 (won) | clears w/ a no-capsule level |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const sw = r.medianSwingsWon === null ? '-' : `${r.medianSwingsWon} [${r.swingsWonRange![0]}-${r.swingsWonRange![1]}]`;
    out.push(
      `| ${r.stage} | ${r.policy} | ${r.runs} | ${pct(r.clearRate)} | ${r.medianDepth} | ${r.medianTime.toFixed(0)} | ${sw} | ` +
        `${r.medianLivesLost} | ${pct(r.chain2Rate)} | ${r.causes.crushed} / ${r.causes.suffocated} / ${r.causes.timeout} / ${r.causes.capped} | ` +
        `${r.wonTimeP10?.toFixed(0) ?? '-'}/${r.wonTimeP25?.toFixed(0) ?? '-'} | ${r.medMeltWon ?? '-'} | ` +
        `${r.medFriendsWon ?? '-'}/${r.p75FriendsWon ?? '-'} | ${r.dryCleanRate === null ? '-' : pct(r.dryCleanRate)} |`,
    );
  }
  out.push(
    '',
    '| stage | policy | med score | lives lost crushed / air | lives lost per 10m of a level (0..90) | pops at chain 1/2/3/4+ | max combo | bronze+ / silver+ / gold |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const r of rows) {
    out.push(
      `| ${r.stage} | ${r.policy} | ${r.medianScore} | ${r.deathsCrushed} / ${r.deathsAir} | ${r.deathHist.join(' ')} | ` +
        `${r.chainSteps.join('/')} | ${r.maxCombo} | ` +
        `${pct(r.medalRates.bronze)} / ${pct(r.medalRates.silver)} / ${pct(r.medalRates.gold)} |`,
    );
  }
  out.push(
    '',
    '| stage | policy | med melt chains step 2+ (won) | pops at chain 2+ | score from combo | runs with a 1UP | lives lost in boss / piece zones |',
    '|---|---|---|---|---|---|---|',
  );
  for (const r of rows) {
    out.push(
      `| ${r.stage} | ${r.policy} | ${r.medMelt2Won ?? '-'} | ${pct(r.chain2Share)} | ${pct(r.comboShare)} | ${pct(r.extendRate)} | ` +
        `${r.deathsBoss} / ${r.deathsPiece} of ${r.deathsCrushed + r.deathsAir} |`,
    );
  }
  // review 3 lines. chain need: what aiming for chains adds to a reading bot (target >= +15 points
  // on the lake and aurora, item 2; reported, not enforced). Zones: the share of greedy's lost
  // lives inside piece bands against the share of the course those bands cover (item 3 wants boss
  // >= 10%); a share well above the cover means the pieces are where it dies.
  out.push('');
  for (const stage of [...new Set(rows.map((r) => r.stage))]) {
    const row = (p: string) => rows.find((r) => r.stage === stage && r.policy === p);
    const pl = row('planner'), nc = row('plannerNoChain'), gr = row('greedy');
    const def = STAGES.find((st) => st.def.id === stage)!.def;
    const parts: string[] = [];
    if (pl && nc) {
      parts.push(def.endless
        ? `chain need: planner med ${pl.medianDepth} m vs plannerNoChain ${nc.medianDepth} m`
        : `chain need: planner ${pct(pl.clearRate)} - plannerNoChain ${pct(nc.clearRate)} = ${Math.round((pl.clearRate - nc.clearRate) * 100)} points`);
    }
    const sl = row('slow'), snc = row('slowNoChain');
    if (sl && snc) {
      parts.push(def.endless
        ? `slow chain need: slow med ${sl.medianDepth} m vs slowNoChain ${snc.medianDepth} m`
        : `slow chain need: slow ${pct(sl.clearRate)} - slowNoChain ${pct(snc.clearRate)} = ${Math.round((sl.clearRate - snc.clearRate) * 100)} points`);
    }
    if (pl && gr) {
      parts.push(`chain 2+ pops planner ${pct(pl.chain2Share)} vs greedy ${pct(gr.chain2Share)}`);
      parts.push(`score planner/greedy x${(pl.medianScore / Math.max(1, gr.medianScore)).toFixed(1)}`);
    }
    parts.push(`combo share ${rows.filter((r) => r.stage === stage).map((r) => `${r.policy} ${pct(r.comboShare)}`).join(', ')}`);
    parts.push(`1UP rate ${rows.filter((r) => r.stage === stage).map((r) => `${r.policy} ${pct(r.extendRate)}`).join(', ')}`);
    if (gr) {
      const lost = Math.max(1, gr.deathsCrushed + gr.deathsAir);
      parts.push(`greedy lives lost in boss ${pct(gr.deathsBoss / lost)} (covers ${pct(gr.pieceCover[0])}), ` +
        `in pieces ${pct(gr.deathsPiece / lost)} (covers ${pct(gr.pieceCover[1])}); ` +
        `greedy lives lost per 100m: boss ${gr.bossHazard[0].toFixed(2)} vs rest ${gr.bossHazard[1].toFixed(2)}`);
    }
    out.push(`${stage}: ${parts.join('; ')}`);
  }
  // skill gap: how much reading the board pays over digging blindly (target +25 points, review item 6).
  // The full planner clears nearly everything, so its lives lost and medal rate say more about a
  // stage's difficulty than its clear rate; endless has no clear, so its gap is in depth.
  out.push('');
  for (const stage of [...new Set(rows.map((r) => r.stage))]) {
    const row = (p: string) => rows.find((r) => r.stage === stage && r.policy === p);
    const pl = row('planner'), sh = row('slow'), gr = row('greedy');
    if (!pl || !gr) continue;
    const gap = (r: CalRow) => `${Math.round((r.clearRate - gr.clearRate) * 100)}`;
    const slowKo = sh ? `; slow ${pct(sh.clearRate)} (${gap(sh)}), lives lost ${sh.medianLivesLost}` : '';
    const endless = STAGES.find((st) => st.def.id === stage)?.def.endless;
    out.push(endless
      ? `depth gap ${stage}: planner med ${pl.medianDepth} m${sh ? ` / slow ${sh.medianDepth} m` : ''} vs greedy ${gr.medianDepth} m ` +
          `(x${(pl.medianDepth / gr.medianDepth).toFixed(1)}${sh ? ` / x${(sh.medianDepth / gr.medianDepth).toFixed(1)}` : ''})`
      : `skill gap ${stage}: planner ${pct(pl.clearRate)} - greedy ${pct(gr.clearRate)} = ${gap(pl)} points${slowKo}; ` +
          `planner lives lost ${pl.medianLivesLost}, silver+ ${pct(pl.medalRates.silver)}, gold ${pct(pl.medalRates.gold)}; ` +
          `med depth ${pl.medianDepth} vs ${gr.medianDepth} m`);
  }
  return out.join('\n');
}
