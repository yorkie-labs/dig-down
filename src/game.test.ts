import { describe, expect, it } from 'vitest';
import {
  levelTempo, levelAirTempo, TEMPO_START, TEMPO_END, AIR_START, AIR_END,
  AIR_CAPSULE, AIR_CHAIN, AIR_DRAIN, AIR_RESPAWN_SUFFOCATE, AIR_MAX, AIR_XBLOCK, CAPSULE, cellAt, CLEAR, computeChunks, createGame,
  DEFAULT_STAGE, depthOfRow, drill, stageRows, DRILL_COOLDOWN, EXTEND_SCORES, Game, LEVEL_COLORS, levelOfDepth, makeCell, move,
  SCORE_CAPSULE, SCORE_DRILL, SCORE_LEVEL_CLEAR, SCORE_LIFE_BONUS, SCORE_POP, START_LIVES, tick,
  CLOCK, FRIEND, SCORE_FRIEND, THAW, TICK, update, WOBBLE_TIME, XBLOCK, XBLOCK_HP,
  AIR_RESPAWN_CRUSH, capsuleGap, chainAir, chainScoreMul, popScoreMul, COMBO_WINDOW, ensureRows, idx,
  CHUNK_EVERY, chunkFits, COLS, LEVEL_DEPTH, SKY_ROWS, StageDef, mirrorRows, Placement, ENDLESS_BOSS_EVERY, ENDLESS_BOSS_FROM,
  keyPieceBelow,
} from './game';
import { ALL_CHUNKS, Chunk, chunkColors, SNOWY_CHUNKS } from './chunks';
import { STAGES, stageById } from './stages';

// Builds a game from rows of chars: '.' empty, 'a'..'d' colors, 'X' X block, 'O' capsule,
// '=' level-clear row block, 'T' thaw ice, 'F' frozen friend, 'M' mole.
function fromAscii(rows: string[]): Game {
  const g = createGame(1);
  g.cols = rows[0].length;
  g.rows = rows.length;
  g.cells = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === 'M') g.mole = { ...g.mole, x, y };
      if (ch === '.' || ch === 'M') g.cells.push(null);
      else g.cells.push(makeCell(ch === 'X' ? XBLOCK : ch === 'O' ? CAPSULE : ch === '=' ? CLEAR : ch === 'T' ? THAW : ch === 'F' ? FRIEND : ch === 'C' ? CLOCK : ch.charCodeAt(0) - 97));
    });
  });
  return g;
}

function ascii(g: Game): string[] {
  const out: string[] = [];
  for (let y = 0; y < g.rows; y++) {
    let row = '';
    for (let x = 0; x < g.cols; x++) {
      const c = cellAt(g, x, y);
      if (g.mole.x === x && g.mole.y === y) row += 'M';
      else if (!c) row += '.';
      else row += c.color === XBLOCK ? 'X' : c.color === CAPSULE ? 'O' : c.color === CLEAR ? '=' : c.color === THAW ? 'T' : c.color === FRIEND ? 'F' : String.fromCharCode(97 + c.color);
    }
    out.push(row);
  }
  return out;
}

const ticks = (g: Game, n: number) => { for (let i = 0; i < n; i++) tick(g); };
const run = (g: Game, seconds: number) => ticks(g, Math.round(seconds / TICK));
// Drill repeatedly, stepping time past the cooldown each swing.
const drillN = (g: Game, n: number) => { for (let i = 0; i < n; i++) { g.time += DRILL_COOLDOWN; drill(g); } };

describe('createGame', () => {
  it('starts stable: nothing falls on a fresh field', () => {
    const g = createGame(42);
    const before = ascii(g);
    run(g, 3);
    expect(ascii(g)).toEqual(before);
  });

  it('ends every level with a full clear row', () => {
    const g = createGame(7);
    for (const depth of [100, 200, 300, 400, 500]) {
      const y = depth + 1; // depth 0 is the surface row
      const row = Array.from({ length: g.cols }, (_, x) => cellAt(g, x, y)!.color);
      expect(row.every((c) => c === CLEAR)).toBe(true);
    }
  });

  it('uses only the preset number of colors per level', () => {
    const g = createGame(9);
    for (let y = 2; y < g.rows; y++) {
      const max = LEVEL_COLORS[levelOfDepth(depthOfRow(y)) - 1];
      for (let x = 0; x < g.cols; x++) {
        const c = cellAt(g, x, y)!.color;
        if (c >= 0) expect(c).toBeLessThan(max);
      }
    }
  });
});

describe('stages', () => {
  it('a stage is data: its levels set depth, colours and drain', () => {
    const stage = {
      id: 'test', capsuleChance: 0, air: { kind: 'time' as const },
      levels: [
        { ...DEFAULT_STAGE.levels[0], colors: 1, xChance: 0 },
        { ...DEFAULT_STAGE.levels[1], colors: 2, xChance: 0, airDrain: 9 },
      ],
    };
    const g = createGame(3, stage);
    expect(g.rows).toBe(stageRows(stage));
    expect(g.rows).toBe(2 + 200);
    for (let y = 2; y < 2 + 99; y++) for (let x = 0; x < 9; x++) expect(cellAt(g, x, y)!.color).toBe(0);
    expect(cellAt(g, 0, 201)!.color).toBe(CLEAR); // last row of the last level
    g.level = 2;
    g.air = 100;
    const tempo = levelAirTempo(g); // the in-level air tempo scales the drain
    update(g, 1);
    expect(g.air).toBeCloseTo(100 - 9 * tempo, 5);
  });
});

describe('swing air (hammer igloo)', () => {
  const swingStage = {
    ...DEFAULT_STAGE, id: 'swing',
    air: { kind: 'swing' as const, perSwing: [1.5, 1.5, 1.5, 1.5, 1.5], xBreakAir: 0 },
  };
  const board = (rows: string[]) => { const g = fromAscii(rows); g.stage = swingStage; g.levels = [...swingStage.levels]; return g; };

  it('time does not drain air', () => {
    const g = board(['M', 'a', 'b']);
    update(g, 5);
    expect(g.air).toBe(AIR_MAX);
  });

  it('each landed swing costs air, X chips included, and the X break costs no extra', () => {
    const g = board(['M', 'X', 'a']);
    move(g, 'down');
    drillN(g, XBLOCK_HP);
    expect(g.stats.swings).toBe(XBLOCK_HP);
    expect(g.air).toBeCloseTo(AIR_MAX - 1.5 * XBLOCK_HP, 5);
  });

  it('a swing at nothing is free', () => {
    const g = board(['M', '.', 'a']);
    move(g, 'down');
    drillN(g, 3);
    expect(g.stats.swings).toBe(0);
    expect(g.air).toBe(AIR_MAX);
  });
});

describe('thaw ice', () => {
  const thawStage = { ...DEFAULT_STAGE, id: 'thaw', levels: DEFAULT_STAGE.levels.map((l) => ({ ...l, thawTime: 2 })) };
  const board = (rows: string[]) => { const g = fromAscii(rows); g.stage = thawStage; g.levels = [...thawStage.levels]; return g; };

  it('never joins anything, even other thaw ice', () => {
    const g = board(['TT', 'aa']);
    const sizes = computeChunks(g).chunks.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 1, 2]);
  });

  it('one hit breaks it', () => {
    const g = board(['M', 'T', 'a']);
    move(g, 'down');
    drill(g);
    expect(cellAt(g, 0, 1)).toBeNull();
  });

  it('only melts while a side is open, then vanishes and drops what it held', () => {
    // fully enclosed: no melting
    const g = board(['aaa.', 'aTa.', 'aaa.', 'bbbM', 'cccc']);
    run(g, 3);
    expect(cellAt(g, 1, 1)!.color).toBe(THAW);
    // open its left side: melts after thawTime
    g.cells[1 * 4 + 0] = null;
    run(g, 1.5);
    expect(cellAt(g, 1, 1)!.color).toBe(THAW);
    run(g, 0.7);
    expect(cellAt(g, 1, 1)).toBeNull();
    expect(g.events.some((e) => e.type === 'melt')).toBe(true);
  });

  it('a pop caused by a melt drop counts as a melt chain', () => {
    // 'a' rests on thaw ice beside a hole; when it melts, 'a' falls onto 'aaa' and pops
    const g = board(['.a..', '.T..', 'aaa.', 'bbbM', 'cccc']);
    run(g, 6);
    expect(g.events.some((e) => e.type === 'pop')).toBe(true);
    expect(g.stats.meltChains).toBe(1);
    expect(g.stats.meltChains2).toBe(0); // the drop just popped: nothing further fell
  });

  it('a melt chain whose cascade reaches step 2 counts once toward meltChains2', () => {
    // the melt drops a onto a(2,2)+a(1,3): that pop takes a(3,2) from under b, which falls onto bbb
    const g = board(['.....', '.a.b.', '.Taa.', 'Mabbb', 'ccccc']);
    run(g, 8);
    const pops = g.events.filter((e) => e.type === 'pop') as { chain: number }[];
    expect(pops.map((e) => e.chain)).toEqual([1, 2]);
    expect(g.stats.meltChains).toBe(1);
    expect(g.stats.meltChains2).toBe(1);
  });

  it('a step-2 pop with no melt at its root is not a melt chain', () => {
    // the same cascade, set off by a plain drop instead of a melt
    const g = board(['.a.b.', '..aa.', 'Mabbb', 'ccccc']);
    run(g, 8);
    expect((g.events.filter((e) => e.type === 'pop') as { chain: number }[]).map((e) => e.chain)).toEqual([1, 2]);
    expect(g.stats.meltChains).toBe(0);
    expect(g.stats.meltChains2).toBe(0);
  });
});

describe('capsule supply per level', () => {
  it('capsuleMul scales the capsule rate of a level (0 = none)', () => {
    const count = (mul: number) => {
      const stage = { ...DEFAULT_STAGE, id: 'm', capsuleChance: 0.05, levels: [{ ...DEFAULT_STAGE.levels[0], capsuleMul: mul }] };
      const g = createGame(5, stage);
      return g.cells.filter((c) => c?.color === CAPSULE).length;
    };
    expect(count(0)).toBe(0);
    expect(count(3)).toBeGreaterThan(count(1) * 2);
  });
});

describe('frozen friends', () => {
  const friendStage = { ...DEFAULT_STAGE, id: 'f', friends: true };
  const board = (rows: string[]) => { const g = fromAscii(rows); g.stage = friendStage; g.levels = [...friendStage.levels]; return g; };

  it('a 4+ X-block pop leaves a frozen friend in one of the popped cells', () => {
    const g = board(['X....', '.....', 'XXX.M', 'aaaaa']);
    run(g, 3);
    expect(g.cells.filter((c) => c?.color === FRIEND).length).toBe(1);
  });

  it('no friends on stages without the rule', () => {
    const g = fromAscii(['X....', '.....', 'XXX.M', 'aaaaa']);
    run(g, 3);
    expect(g.cells.some((c) => c?.color === FRIEND)).toBe(false);
  });

  it('rescuing friends pays 765 x n and counts them', () => {
    const g = board(['MFF', 'aaa']);
    move(g, 'right');
    move(g, 'right');
    expect(g.stats.friends).toBe(2);
    expect(g.score).toBe(SCORE_FRIEND * (1 + 2));
  });
});

describe('endless', () => {
  const endless = {
    ...DEFAULT_STAGE, id: 'endless', lives: 1,
    levels: [DEFAULT_STAGE.levels[0]],
    endless: (n: number) => ({ ...DEFAULT_STAGE.levels[4], colors: 1 + (n % 4) }),
  };

  it('appends the next 100m level as the mole nears the bottom, and never wins', () => {
    const g = createGame(9, endless);
    expect(g.rows).toBe(2 + 100);
    expect(g.lives).toBe(1);
    g.mole.y = g.rows - 30;
    g.cells[(g.mole.y + 1) * g.cols + g.mole.x] = null; // let it keep falling
    tick(g);
    expect(g.rows).toBe(2 + 200);
    expect(g.levels.length).toBe(2);
    expect(g.levels[1].colors).toBe(3);
    expect(cellAt(g, 0, 201)!.color).toBe(CLEAR);
    g.mole.y = g.rows - 1;
    tick(g);
    expect(g.state).toBe('playing');
  });

  it('the same seed builds the same endless board', () => {
    const a = createGame(4, endless), b = createGame(4, endless);
    for (const g of [a, b]) { g.mole.y = g.rows - 30; tick(g); }
    expect(a.cells.map((c) => c?.color)).toEqual(b.cells.map((c) => c?.color));
  });
});

describe('stage air tweaks', () => {
  it('airCap lets a stage bank air above 100', () => {
    const g = fromAscii(['MOO', 'bbb']);
    g.stage = { ...DEFAULT_STAGE, airCap: 150 };
    g.air = 95;
    move(g, 'right');
    move(g, 'right');
    expect(g.air).toBe(95 + 2 * AIR_CAPSULE);
  });

  it('friendAir: rescuing a friend also restores air', () => {
    const g = fromAscii(['MF', 'bb']);
    g.stage = { ...DEFAULT_STAGE, friends: true, friendAir: 10 };
    g.air = 50;
    move(g, 'right');
    expect(g.air).toBe(60);
  });

  it('counts capsules taken per level', () => {
    const g = fromAscii(['MO', 'bb']);
    g.level = 2;
    move(g, 'right');
    expect(g.stats.levelCapsules).toEqual([0, 1]);
  });
});

describe('time attack', () => {
  const ta = { ...DEFAULT_STAGE, id: 'ta', air: { kind: 'none' as const }, clocks: 3 };

  it('no air at all: time and X blocks cost nothing', () => {
    const g = fromAscii(['M', 'X', 'a']);
    g.stage = ta;
    update(g, 10);
    move(g, 'down');
    drillN(g, XBLOCK_HP);
    expect(g.air).toBe(AIR_MAX);
  });

  it('clocks replace capsules and taking one saves seconds', () => {
    const g = createGame(5, { ...ta, capsuleChance: 0.05 });
    expect(g.cells.some((c) => c?.color === CAPSULE)).toBe(false);
    expect(g.cells.some((c) => c?.color === CLOCK)).toBe(true);
    const h = fromAscii(['MC', 'bb']);
    h.stage = ta;
    move(h, 'right');
    expect(h.stats.clockSaved).toBe(3);
  });
});

describe('run stats', () => {
  it('counts swings, lives lost and the longest chain', () => {
    const g = fromAscii(['a...', '....', '.b..', 'aaa.', 'bbbM', 'cccc']);
    run(g, 5);
    expect(g.stats.maxChain).toBe(2);
    g.lives = 3;
    g.air = 0.01;
    update(g, 0.05);
    expect(g.stats.livesLost).toBe(1);
  });
});

describe('levels', () => {
  it('maps depth to 100m levels', () => {
    expect([1, 100, 101, 250, 500].map(levelOfDepth)).toEqual([1, 1, 2, 3, 5]);
  });
});

describe('computeChunks', () => {
  it('merges same colors and X blocks; capsules stand alone', () => {
    const g = fromAscii(['aaXX', 'OObb']);
    const sizes = computeChunks(g).chunks.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 1, 2, 2, 2]);
  });
});

describe('move', () => {
  it('walks into empty cells but not into blocks', () => {
    const g = fromAscii(['.M.a', 'bbbb']);
    move(g, 'left');
    expect(g.mole.x).toBe(0);
    move(g, 'right');
    move(g, 'right');
    expect(g.mole.x).toBe(2);
    move(g, 'right'); // 'a' blocks and there is no row above to climb into
    expect(g.mole.x).toBe(2);
  });

  it('climbs a one-high ledge', () => {
    const g = fromAscii(['...', 'Ma.', 'bbb']);
    move(g, 'right');
    expect([g.mole.x, g.mole.y]).toEqual([1, 0]);
  });

  it('walking into a capsule takes it', () => {
    const g = fromAscii(['MO', 'bb']);
    g.air = 50;
    move(g, 'right');
    expect(g.mole.x).toBe(1);
    expect(g.air).toBe(50 + AIR_CAPSULE);
  });

  it('up/down only turn the drill', () => {
    const g = fromAscii(['M', 'a']);
    move(g, 'down');
    expect(g.mole.facing).toBe('down');
    expect(cellAt(g, 0, 1)).not.toBeNull();
  });
});

describe('drill', () => {
  it('clears the whole same-colored chunk in the facing direction', () => {
    const g = fromAscii(['M..', 'aab', 'abb']);
    move(g, 'down');
    drill(g);
    expect(ascii(g)).toEqual(['M..', '..b', '.bb']);
    expect(g.score).toBe(SCORE_DRILL * 3);
  });

  it('needs five hits on an X block and costs air', () => {
    const g = fromAscii(['M', 'X']);
    move(g, 'down');
    drillN(g, XBLOCK_HP - 1);
    expect(cellAt(g, 0, 1)).not.toBeNull();
    drillN(g, 1);
    expect(cellAt(g, 0, 1)).toBeNull();
    expect(g.air).toBe(AIR_MAX - AIR_XBLOCK);
  });

  it('breaks only the struck X block, not its whole chunk', () => {
    const g = fromAscii(['M..', 'XXX', 'aaa']);
    move(g, 'down');
    drillN(g, XBLOCK_HP);
    expect(ascii(g)[1]).toBe('.XX');
  });

  it('drilling the clear row wipes everything above it and pays the level bonus', () => {
    const g = fromAscii(['ab...', 'Mbaab', '=====', 'ccccc']);
    move(g, 'down');
    drill(g);
    expect(ascii(g)).toEqual(['.....', 'M....', '.....', 'ccccc']);
    expect(g.score).toBe(1 * SCORE_LEVEL_CLEAR);
  });

  it('respects the cooldown', () => {
    const g = fromAscii(['M', 'X']);
    move(g, 'down');
    g.time = 1;
    drill(g);
    drill(g);
    expect(cellAt(g, 0, 1)!.hp).toBe(XBLOCK_HP - 1);
  });

  it('capsule points escalate: 100, 200, 300', () => {
    const g = fromAscii(['MOOO', 'bbbb']);
    move(g, 'right');
    move(g, 'right');
    move(g, 'right');
    expect(g.score).toBe(SCORE_CAPSULE * (1 + 2 + 3));
  });
});

describe('gravity', () => {
  it('wobbles an unsupported chunk before it falls', () => {
    const g = fromAscii(['a..', '...', 'bbM', 'ccc']);
    const wobble = WOBBLE_TIME[0] / levelTempo(g); // wobble shortens as the level's tempo builds
    run(g, wobble - 0.1);
    expect(ascii(g)[0]).toBe('a..');
    run(g, 0.3);
    expect(ascii(g)[0]).toBe('...');
  });

  it('a falling block sticks to a supported block of the same color', () => {
    // 'a' falls and stops beside the supported 'a' instead of dropping to the floor.
    const g = fromAscii(['a..', '...', '.a.', '.bM', 'ccc']);
    run(g, 2);
    expect(ascii(g)).toEqual(['...', '...', 'aa.', '.bM', 'ccc']);
  });

  it('clears a landed chunk of 4+ and chains', () => {
    // 'a' lands on 'aaa' -> clears; that drops 'b' onto 'bbb' -> clears as chain 2.
    const g = fromAscii(['a...', '....', '.b..', 'aaa.', 'bbbM', 'cccc']);
    run(g, 5);
    const pops = g.events.filter((e) => e.type === 'pop') as { chain: number }[];
    expect(pops.map((e) => e.chain)).toEqual([1, 2]);
    expect(g.score).toBe(SCORE_POP * (4 * 0.5 + 4 * 2)); // a lone pop is 0.5x, step 2 is 2x
  });

  it('chain steps from 2 up restore air', () => {
    const g = fromAscii(['a...', '....', '.b..', 'aaa.', 'bbbM', 'cccc']);
    g.air = 50;
    run(g, 5);
    const pops = g.events.filter((e) => e.type === 'pop') as { air: number }[];
    expect(pops.map((e) => e.air)).toEqual([0, AIR_CHAIN[2]]);
    expect(g.air).toBeGreaterThan(50); // tick() alone never drains, so only the chain's +8 moved it
  });

  it('an unrelated pop elsewhere does not continue a chain', () => {
    // Two independent single pops: each must be chain 1, even while the other is still falling.
    const g = fromAscii(['a....b', '......', 'aaa.bb', 'ccc.bc', 'dddMdd']);
    run(g, 5);
    const pops = g.events.filter((e) => e.type === 'pop') as { chain: number }[];
    expect(pops.map((e) => e.chain)).toEqual([1, 1]);
  });

  it('four X blocks that land together clear as well', () => {
    const g = fromAscii(['X....', '.....', 'XXX.M', 'aaaaa']);
    run(g, 3);
    expect(ascii(g)).toEqual(['.....', '.....', '....M', 'aaaaa']);
  });

  it('a big chunk that never fell does not clear', () => {
    const g = fromAscii(['M...', 'aaaa', 'bbbb']);
    run(g, 3);
    expect(g.events.some((e) => e.type === 'pop')).toBe(false);
  });

  it('crushes the mole and respawns with full air', () => {
    const g = fromAscii(['.a.', '...', '.M.', 'ccc']);
    g.air = 40;
    run(g, 2);
    expect(g.lives).toBe(START_LIVES - 1);
    expect(g.air).toBe(AIR_MAX);
  });

  it('a falling capsule is taken instead of crushing', () => {
    const g = fromAscii(['.O.', '...', '.M.', 'ccc']);
    run(g, 2);
    expect(g.lives).toBe(START_LIVES);
    expect(g.capsules).toBe(1);
  });
});

describe('air', () => {
  it('drains over time and costs a life at zero', () => {
    const g = fromAscii(['M', 'a', 'b']);
    update(g, 1);
    expect(g.air).toBeCloseTo(AIR_MAX - AIR_DRAIN[0] * levelAirTempo(g), 5);
    g.air = 0.01;
    update(g, 0.05);
    expect(g.lives).toBe(START_LIVES - 1);
    expect(g.air).toBe(AIR_RESPAWN_SUFFOCATE); // suffocating only partly refills (a crush refills fully)
  });

  it('game over when the last life runs out', () => {
    const g = fromAscii(['M', 'a', 'b']);
    g.lives = 1;
    g.air = 0.01;
    update(g, 0.05);
    expect(g.state).toBe('lost');
  });
});

describe('extend', () => {
  it('awards one extra life when the score crosses the first threshold', () => {
    const g = fromAscii(['MOO', 'bbb']);
    g.score = EXTEND_SCORES[0] - 50;
    move(g, 'right'); // capsule worth 100 crosses the threshold
    expect(g.lives).toBe(START_LIVES + 1);
    expect(g.events.some((e) => e.type === 'extend')).toBe(true);
    move(g, 'right'); // already past it: no second life
    expect(g.lives).toBe(START_LIVES + 1);
  });

  it('thresholds are 100k (sourced) and 300k, one life each', () => {
    expect(EXTEND_SCORES).toEqual([100000, 300000]);
    const g = fromAscii(['MOO', 'bbb']);
    g.score = EXTEND_SCORES[1] - 50; // a jump past both (e.g. a big bonus) still gives both lives
    move(g, 'right');
    expect(g.lives).toBe(START_LIVES + 2);
    expect(g.extends).toBe(2);
  });
});

describe('goal', () => {
  it('reaching the bottom wins with a bonus per spare life', () => {
    const g = fromAscii(['M', 'a']);
    move(g, 'down');
    drill(g);
    update(g, 0.1);
    expect(g.state).toBe('won');
    expect(g.score).toBe(SCORE_DRILL + START_LIVES * SCORE_LIFE_BONUS);
  });
});

describe('studio review: shield', () => {
  it('a block landing on an invulnerable mole shatters with a shield event, not a crush', () => {
    const g = fromAscii(['.a.', '...', '.M.', 'ccc']);
    g.mole.invuln = 10;
    run(g, 2);
    expect(g.lives).toBe(START_LIVES);
    expect(g.events.some((e) => e.type === 'crush')).toBe(false);
    expect(g.events.filter((e) => e.type === 'shield')).toEqual([{ type: 'shield', x: 1, y: 2 }]);
  });
});

describe('studio review: whiff and drill result', () => {
  const whiffs = (g: Game) => g.events.filter((e) => e.type === 'whiff');

  it('a swing at nothing whiffs once per swing time and reports empty', () => {
    const g = fromAscii(['M.', 'aa']);
    move(g, 'right');
    g.time = 1;
    expect(drill(g)).toBe('empty'); // the renderer must not retry this one
    expect(drill(g)).toBe('empty'); // held key: same frame again
    expect(whiffs(g)).toEqual([{ type: 'whiff', dir: 'right' }]);
    g.time += DRILL_COOLDOWN;
    drill(g);
    expect(whiffs(g).length).toBe(2);
  });

  it('a falling target whiffs; a hit reports hit; a press in the cooldown is silent', () => {
    const g = fromAscii(['M', 'a', 'b']);
    move(g, 'down');
    g.time = 1;
    g.cells[1]!.falling = true;
    expect(drill(g)).toBe('falling');
    expect(whiffs(g).length).toBe(1);
    g.cells[1]!.falling = false;
    g.time += DRILL_COOLDOWN;
    expect(drill(g)).toBe('hit');
    g.events.length = 0;
    g.time += 0.01;
    expect(drill(g)).toBe('cooldown'); // still swinging: the renderer buffers this press
    expect(whiffs(g).length).toBe(0);
  });

  it('a quiet retry (held key, buffer) never whiffs; the next fresh press still can', () => {
    const g = fromAscii(['M.', 'aa']);
    move(g, 'right');
    g.time = 1;
    for (let i = 0; i < 30; i++, g.time += DRILL_COOLDOWN) expect(drill(g, { quiet: true })).toBe('empty');
    expect(whiffs(g).length).toBe(0);
    expect(drill(g)).toBe('empty');
    expect(whiffs(g)).toEqual([{ type: 'whiff', dir: 'right' }]);
    // quiet still reports a falling target, so the renderer keeps buffering it
    const h = fromAscii(['M', 'a', 'b']);
    move(h, 'down');
    h.time = 1;
    h.cells[1]!.falling = true;
    expect(drill(h, { quiet: true })).toBe('falling');
    expect(whiffs(h).length).toBe(0);
  });
});

describe('studio review: superlinear chains', () => {
  it('air comes from a per-step table capped at its last entry; points double per step', () => {
    expect([1, 2, 3, 4, 5, 9].map(chainAir)).toEqual([0, 3, 20, 32, 45, 45]);
    expect([1, 2, 3, 4, 5, 8, 20].map(chainScoreMul)).toEqual([0.5, 2, 4, 8, 16, 16, 16]);
  });

  it('combo adds 10% per step, capped at x2; the chain part caps at x16', () => {
    expect([0, 1, 5, 10, 30].map((n) => popScoreMul(1, n))).toEqual([0.5, 0.55, 0.75, 1, 1]);
    expect(popScoreMul(3, 2)).toBeCloseTo(4 * 1.2, 9);
    expect(popScoreMul(9, 99)).toBe(32); // the most a pop can ever be worth: 16 x 2
  });

  it('a three-step cascade pays the table: air and points per pop', () => {
    // a -> aaa pops (1); drops b onto the b group (2); that drops c onto the c group (3)
    const g = fromAscii(['a.....', '......', '.b.c..', 'aaab.M', 'bbbbcc', 'dddccd', 'dddddd']);
    g.air = 10;
    run(g, 8);
    const pops = g.events.filter((e) => e.type === 'pop') as { chain: number; air: number; points: number; cells: unknown[] }[];
    expect(pops.map((e) => e.chain)).toEqual([1, 2, 3]);
    expect(pops.map((e) => e.air)).toEqual([0, AIR_CHAIN[2], AIR_CHAIN[3]]);
    expect(pops.map((e) => e.points)).toEqual(pops.map((e, i) => SCORE_POP * e.cells.length * [0.5, 2, 4][i]));
    expect(g.air).toBe(10 + AIR_CHAIN[2] + AIR_CHAIN[3]);
  });

  it('a crush still respawns with a full tank', () => {
    const g = fromAscii(['.a.', '...', '.M.', 'ccc']);
    g.air = 40;
    run(g, 2);
    expect(g.air).toBe(AIR_RESPAWN_CRUSH);
  });
});

describe('studio review: action combo', () => {
  // 'a' drops onto aaa and pops by itself (opening the window); drilling d then drops c onto the
  // ccc group: a pop the player made.
  const board = () => {
    const g = fromAscii(['a...c.', '...Mdc', 'aaabcc', 'bbbbbb']);
    move(g, 'right');
    return g;
  };
  const untilPop = (g: Game) => { for (let i = 0; i < 600 && !g.events.some((e) => e.type === 'pop'); i++) tick(g); };
  const pops = (g: Game) => g.events.filter((e) => e.type === 'pop') as { chain: number; step: number; air: number }[];

  it('a hammer-made pop inside the window adds combo, which adds 10% to its score', () => {
    const g = board();
    untilPop(g);
    run(g, 0.5);
    expect(drill(g)).toBe('hit');
    run(g, 3);
    expect(g.events.filter((e) => e.type === 'combo')).toEqual([{ type: 'combo', n: 1 }]);
    // step (pitch) is chain + combo; points are the 1-chain's x1.1; air stays on the cascade step
    expect(pops(g).map((e) => [e.chain, e.step, e.air])).toEqual([[1, 1, 0], [1, 2, 0]]);
    expect((g.events.filter((e) => e.type === 'pop')[1] as { points: number }).points).toBe(Math.round(SCORE_POP * 4 * 0.5 * 1.1));
    expect(g.stats.maxCombo).toBe(1);
    run(g, COMBO_WINDOW + 0.1);
    expect(g.combo).toBe(0); // the window ran out without another pop
  });

  it('a drill after the window closed starts nothing', () => {
    const g = board();
    untilPop(g);
    run(g, COMBO_WINDOW + 0.1);
    drill(g);
    run(g, 3);
    expect(g.events.some((e) => e.type === 'combo')).toBe(false);
    expect(pops(g).map((e) => e.step)).toEqual([1, 1]);
  });

  it('a hammer-made pop landing after the window would close still counts', () => {
    const g = board();
    untilPop(g);
    run(g, 1.2); // drilled late in the window; the drop lands after it ends
    drill(g);
    run(g, 3);
    expect(g.stats.maxCombo).toBe(1);
  });

  it('only the block resting on the broken cell is the hit\'s doing', () => {
    const g = fromAscii(['b', 'a', 'd', 'M']);
    g.comboTimer = 1;
    g.mole.facing = 'up';
    g.time = 1;
    expect(drill(g)).toBe('hit');
    expect(cellAt(g, 0, 1)!.comboTag).toBe(true);
    expect(cellAt(g, 0, 0)!.comboTag).toBe(false); // only falls because a does
  });

  it('accidental pops do not renew a running combo', () => {
    const g = fromAscii(['a...', '....', 'aaa.', 'bbbb', 'cccc']);
    g.mole = { ...g.mole, x: 3, y: 2 };
    g.combo = 2; // a combo is running; the a drop below is nobody's doing
    g.comboTimer = 1.4;
    untilPop(g);
    expect(g.comboTimer).toBeLessThan(0.5); // not renewed to COMBO_WINDOW
    run(g, 0.5);
    expect(g.combo).toBe(0);
  });

  it('a stack set loose before a death does not pop a combo after the respawn (bug review 4)', () => {
    const g = board();
    untilPop(g);
    run(g, 0.5);
    expect(drill(g)).toBe('hit'); // tags c, which drops onto ccc a second later
    g.air = 0.001;
    update(g, 0.05); // suffocates before it lands
    expect(g.stats.livesLost).toBe(1);
    run(g, 3);
    expect(g.events.some((e) => e.type === 'combo')).toBe(false);
    expect(g.stats.maxCombo).toBe(0);
  });
});

describe('studio review: capsule fairness guard', () => {
  // Rows (a, b] between reachable capsules each cost 1/K of their level; a gap may cost at most 1.
  const reachable = (g: Game, x: number, y: number) =>
    [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) =>
      nx >= 0 && nx < g.cols && ny >= 0 && ny < g.rows && cellAt(g, nx, ny)?.color !== XBLOCK);
  const worstGap = (g: Game) => {
    const kAt = (y: number) => capsuleGap(g.stage, g.levels[Math.min(g.levels.length, Math.floor(Math.max(0, depthOfRow(y) - 1) / 100) + 1) - 1]);
    let a = 1, worst = 0, rows = 0;
    for (let b = 2; b <= g.rows; b++) {
      const anchor = b === g.rows || kAt(b) === Infinity ||
        Array.from({ length: g.cols }, (_, x) => x).some((x) => cellAt(g, x, b)?.color === CAPSULE && reachable(g, x, b));
      if (!anchor) continue;
      let cost = 0;
      for (let y = a + 1; y <= b; y++) cost += 1 / kAt(y);
      worst = Math.max(worst, cost);
      rows = Math.max(rows, b - a);
      a = b;
    }
    return { worst, rows };
  };

  it('never leaves more than K rows without a reachable capsule, on every stage', () => {
    for (const s of STAGES) {
      for (let seed = 1; seed <= 40; seed++) {
        const g = createGame(seed, s.def);
        if (s.def.endless) ensureRows(g, 600); // grow a few generated levels too
        const { worst } = worstGap(g);
        if (s.def.air.kind === 'none') expect(worst).toBe(0);
        else expect(worst, `${s.def.id} seed ${seed}`).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('K follows the level air drain, clamped; dry levels get 1.5x', () => {
    const lvl = DEFAULT_STAGE.levels[0];
    expect(capsuleGap(DEFAULT_STAGE, { ...lvl, airDrain: 1.32 })).toBe(45);
    expect(capsuleGap(DEFAULT_STAGE, { ...lvl, airDrain: 2.16 })).toBe(28);
    expect(capsuleGap(DEFAULT_STAGE, { ...lvl, airDrain: 5 })).toBe(25);
    expect(capsuleGap(DEFAULT_STAGE, { ...lvl, airDrain: 1.0, capsuleMul: 0.4 })).toBe(75);
    expect(capsuleGap({ ...DEFAULT_STAGE, air: { kind: 'none' } }, lvl)).toBe(Infinity);
    expect(capsuleGap(DEFAULT_STAGE, { ...lvl, capsuleMul: 0 })).toBe(Infinity);
  });
});

describe('studio review: hand-made pieces', () => {
  const isBoss = (c: Chunk) => c.id.endsWith('-boss');
  // a chunk on its own: an empty sky row above, a clear row as a floor that never pops
  const alone = (rows: string[]) => {
    const g = fromAscii(['.'.repeat(COLS), ...rows.map((r) => r.replace(/~/g, 'T')), '='.repeat(COLS)]);
    g.levels = [{ ...DEFAULT_STAGE.levels[0], thawChance: 0.1, thawTime: 2 }];
    return g;
  };
  const moving = (g: Game) => g.cells.some((c) => c && (c.falling || c.wobble > 0));
  const step = (g: Game) => { g.air = AIR_MAX; update(g, TICK); };
  // The mole comes down column x and digs straight down, stepping off the board (out of harm's
  // way) whenever something moves, like a player who waits for a stack to land; returns the
  // longest cascade and whether an X block stopped it.
  const descend = (g: Game, x: number) => {
    const PARK = -1e6;
    g.mole = { ...g.mole, x, y: 0, facing: 'down', invuln: 0 };
    let hitX = false;
    const settle = () => {
      if (!moving(g)) return true;
      const y = g.mole.y;
      g.mole.y = PARK;
      for (let t = 0; t < 900 && moving(g); t++) step(g);
      g.mole.y = y;
      return !cellAt(g, x, y);
    };
    for (let n = 0; n < 80; n++) {
      for (let t = 0; t < 60 && !cellAt(g, x, g.mole.y + 1); t++) step(g);
      if (!settle()) break;
      const below = cellAt(g, x, g.mole.y + 1);
      if (!below || below.color === CLEAR) break;
      if (below.color === XBLOCK) { hitX = true; break; }
      g.time += DRILL_COOLDOWN;
      drill(g);
      ticks(g, 3);
      if (!settle()) break;
    }
    g.mole.y = PARK;
    for (let t = 0; t < 900 && moving(g); t++) step(g);
    return { chain: g.stats.maxChain, hitX };
  };
  // a way from the top row to the bottom one through cells that are not X (walking and digging)
  const openPath = (rows: string[]) => {
    const h = rows.length;
    const open = (x: number, y: number) => rows[y][x] !== 'X';
    const seen = new Set<number>();
    const stack = [...Array(COLS).keys()].filter((x) => open(x, 0));
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i)) continue;
      seen.add(i);
      const x = i % COLS, y = Math.floor(i / COLS);
      if (y === h - 1) return true;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y + 1]]) {
        if (nx >= 0 && nx < COLS && ny < h && open(nx, ny)) stack.push(ny * COLS + nx);
      }
    }
    return false;
  };
  const boardRows = (g: Game, from: number, n: number) =>
    ascii(g).slice(from, from + n).map((r) => r.replace(/M/g, '.'));

  it('every piece is 9 wide, 6-12 rows (a boss 16-20), in the legend', () => {
    for (const c of ALL_CHUNKS) {
      expect(c.rows.length, c.id).toBeGreaterThanOrEqual(isBoss(c) ? 16 : 6);
      expect(c.rows.length, c.id).toBeLessThanOrEqual(isBoss(c) ? 20 : 12);
      for (const r of c.rows) expect(r, c.id).toMatch(/^[abcdXO~.]{9}$/);
    }
  });

  it('every piece has a way down that never breaks an X (a boss: once its key has fired)', () => {
    for (const c of ALL_CHUNKS) {
      if (!c.gates) { expect(openPath(c.rows), c.id).toBe(true); continue; }
      expect(openPath(c.rows), `${c.id} is gated`).toBe(false);
      const g = alone(c.rows);
      for (const x of c.gates) descend(g, x); // open each X-lock in turn
      expect(openPath(boardRows(g, 1, c.rows.length)), c.id).toBe(true);
    }
  });

  it('a bait piece chains from its key columns, and only from them (mirrored too)', () => {
    for (const c of ALL_CHUNKS.filter((c) => c.bait)) {
      const { keys, chain } = c.bait!;
      for (const mirror of [false, true]) {
        const rows = mirror ? mirrorRows(c.rows) : c.rows;
        for (let x = 0; x < COLS; x++) {
          const key = keys.includes(mirror ? COLS - 1 - x : x);
          const r = descend(alone(rows), x);
          const label = `${c.id}${mirror ? ' mirrored' : ''} column ${x}`;
          if (key) expect(r.chain, label).toBeGreaterThanOrEqual(chain);
          else expect(r.chain, label).toBeLessThan(chain);
        }
      }
    }
  });

  // A player who digs straight down at a steady rate and never waits (round 3 review: the parked
  // player above is kinder than anyone at the keyboard). 0.13 s is the hammer cooldown.
  const digStraight = (rows: string[], x: number, level: number, rate: number) => {
    const g = alone(rows);
    g.levels = [{ ...DEFAULT_STAGE.levels[level] }];
    g.mole = { ...g.mole, x, y: 0, facing: 'down', invuln: 0 };
    let next = 0;
    for (let t = 0; t < 60 * 20 && g.state === 'playing'; t++) {
      const below = cellAt(g, x, g.mole.y + 1);
      if (g.mole.x === x && below && !below.falling && below.color !== CLEAR && g.time >= next) {
        g.mole.facing = 'down';
        drill(g);
        next = g.time + rate;
      }
      step(g);
      if (g.mole.y >= g.rows - 2 && !moving(g)) break;
    }
    g.mole.y = -1e6;
    for (let t = 0; t < 900 && moving(g); t++) step(g);
    return { chain: g.stats.maxChain, lost: g.stats.livesLost };
  };
  // (2-colour pieces sit in boards that chain on their own, so only 3+ colours are held to it)
  it('a key piece also chains for a player who digs straight down without waiting', () => {
    for (const c of ALL_CHUNKS.filter((c) => c.bait && c.bait.chain >= 2 && !isBoss(c) && chunkColors(c) >= 3)) {
      const { keys, chain } = c.bait!;
      for (let x = 0; x < COLS; x++) {
        for (const [level, rate] of [[0, 0.13], [0, 0.3], [2, 0.45], [4, 0.13], [4, 0.3]]) {
          const r = digStraight(c.rows, x, level, rate);
          const label = `${c.id} column ${x} level ${level + 1} swing every ${rate}s`;
          if (keys.includes(x)) {
            expect(r.chain, label).toBeGreaterThanOrEqual(chain);
            expect(r.lost, label).toBe(0);
          } else expect(r.chain, label).toBeLessThan(chain); // a wrong column never gets the promise
        }
      }
    }
  });

  // the cue the key tip teaches (main3d TIPS.key): a hole under a block bridge that leans on an X;
  // the key is the hole's neighbour column on the side away from that X
  it('every key piece shows its key the way the tip says', () => {
    for (const c of ALL_CHUNKS.filter((c) => c.bait && c.bait.chain >= 2 && !isBoss(c))) {
      const key = c.bait!.keys[0];
      const cued = c.rows.some((row, r) => r > 0 && [...row].some((ch, h) => {
        if (ch !== '.' || !/[a-d]/.test(c.rows[r - 1][h])) return false;
        return (c.rows[r - 1][h - 1] === 'X' && key === h + 1) || (c.rows[r - 1][h + 1] === 'X' && key === h - 1);
      }));
      expect(cued, c.id).toBe(true);
    }
  });

  it("the snowy exam's key columns chain for a straight digger too", () => {
    const c = ALL_CHUNKS.find((c) => c.id === 'snowy-boss')!;
    for (const x of c.bait!.keys) for (const [level, rate] of [[2, 0.13], [2, 0.45]]) {
      expect(digStraight(c.rows, x, level, rate).chain, `column ${x}`).toBeGreaterThanOrEqual(c.bait!.chain);
    }
  });

  it('a boss gates the way down: every column but the key runs into X', () => {
    for (const c of ALL_CHUNKS.filter((c) => c.gates)) {
      for (let x = 0; x < COLS; x++) {
        if (c.bait!.keys.includes(x)) continue;
        expect(descend(alone(c.rows), x).hitX, `${c.id} column ${x}`).toBe(true);
      }
    }
  });

  it('thaw-drop: digging beside a stack melts its ice and drops it into a melt chain', () => {
    const c = ALL_CHUNKS.find((c) => c.id === 'thaw-drop')!;
    const g = alone(c.rows.map((r, y) => (y < 3 ? r.slice(0, 3) + '.' + r.slice(4) : r))); // dug down column 3
    g.mole = { ...g.mole, x: 3, y: 3 };
    run(g, 6);
    expect(g.stats.meltChains).toBeGreaterThanOrEqual(1);
  });

  it('a stamped board is stable at rest on every stage', () => {
    for (const s of STAGES) {
      for (let seed = 1; seed <= 8; seed++) {
        const g = createGame(seed, s.def);
        const before = ascii(g);
        run(g, 3);
        expect(ascii(g), `${s.def.id} seed ${seed}`).toEqual(before);
      }
    }
  }, 30_000); // every stage x 8 seeds: ~4.5s here, 8.4s on the CI runner (default limit 5s)

  // the stamped cells at a placement: X, capsule, thaw and holes as drawn, letters one colour each
  const stampedAt = (g: Game, p: Placement) => {
    const c = ALL_CHUNKS.find((c) => c.id === p.id)!;
    const rows = p.mirror ? mirrorRows(c.rows) : c.rows;
    const map = new Map<string, number>();
    return rows.every((row, r) => [...row].every((ch, x) => {
      const cell = cellAt(g, x, p.top + SKY_ROWS - 1 + r);
      if (ch === 'X') return cell?.color === XBLOCK;
      if (ch === 'O') return cell?.color === CAPSULE || cell?.color === CLOCK;
      if (ch === '~') return cell?.color === THAW;
      if (ch === '.') return !cell;
      if (!cell || cell.color < 0) return false;
      if (!map.has(ch)) map.set(ch, cell.color);
      return cell.color === map.get(ch);
    })) && new Set(map.values()).size === map.size; // distinct letters, distinct colours
  };

  it('g.pieces lists what was stamped, where, and mirrored or not', () => {
    for (const s of STAGES) {
      const g = createGame(5, s.def);
      if (s.def.endless) ensureRows(g, 1600);
      expect(g.pieces.length, s.def.id).toBeGreaterThan(5);
      for (const p of g.pieces) expect(stampedAt(g, p), `${s.def.id} ${p.id} at ${p.top}m`).toBe(true);
    }
  });

  it('snowy hill stamps its tutorial script as written at 25/50/75m and the boss above the goal', () => {
    const def = stageById('snowy-hill')!.def;
    const g = createGame(11, def);
    const pieces = g.pieces.filter((p) => !p.boss);
    const script = SNOWY_CHUNKS.script!.flatMap((slots, li) => slots.flatMap((c, k) => (c ? [{ c, top: li * LEVEL_DEPTH + (k + 1) * CHUNK_EVERY }] : [])));
    expect(pieces.map((p) => [p.id, p.top, p.mirror])).toEqual(script.map(({ c, top }) => [c.id, top, false]));
    const boss = g.pieces.find((p) => p.boss)!;
    expect([boss.id, boss.top]).toEqual([SNOWY_CHUNKS.boss!.id, def.levels.length * LEVEL_DEPTH - SNOWY_CHUNKS.boss!.rows.length]);
    expect(def.levels[0].colors).toBe(3);
    expect(stageById('snowy-hill')!.levelPromptsKo).toHaveLength(def.levels.length);
  });

  it('pool draws: a bag (no piece twice in a row, all of a level\'s pieces before a repeat), half mirrored', () => {
    let mirrored = 0, total = 0;
    for (const s of STAGES.filter((s) => !s.def.chunks?.script)) {
      const pool = s.def.chunks!.pool;
      expect(new Set(pool).size, `${s.def.id} pool has a duplicate`).toBe(pool.length);
      for (let seed = 1; seed <= 30; seed++) {
        const g = createGame(seed, s.def);
        if (s.def.endless) ensureRows(g, 1000);
        const slots = g.pieces.filter((p) => !p.boss); // pool draws and the shelf before a dry level
        const drawn = slots.filter((p) => pool.some((c) => c.id === p.id));
        slots.forEach((p, i) => { if (i) expect(p.id, `${s.def.id} seed ${seed} at ${p.top}m`).not.toBe(slots[i - 1].id); });
        for (const p of drawn) { total++; if (p.mirror) mirrored++; }
        // within a level, a piece comes back only once every piece that fits the level was drawn
        for (let li = 0; li < g.levels.length; li++) {
          const fits = pool.filter((c) => chunkFits(c, g.levels[li])).length;
          const here = drawn.filter((p) => Math.floor((p.top - 1) / LEVEL_DEPTH) === li).map((p) => p.id);
          if (fits >= here.length) expect(new Set(here).size, `${s.def.id} seed ${seed} level ${li + 1}`).toBe(here.length);
        }
      }
    }
    expect(mirrored / total).toBeGreaterThan(0.4);
    expect(mirrored / total).toBeLessThan(0.6);
  });

  it('endless glacier: a boss above every 500m clear row past 1300m, none before', () => {
    const def = stageById('endless-glacier')!.def;
    const g = createGame(3, def);
    ensureRows(g, 2600);
    const bosses = g.pieces.filter((p) => p.boss);
    expect(bosses.map((p) => p.top + p.rows)).toEqual([1500, 2000, 2500]);
    expect(new Set(bosses.map((p) => p.id)).size).toBeGreaterThan(1); // they take turns
    for (const p of bosses) expect(stampedAt(g, p), `${p.id} at ${p.top}m`).toBe(true);
    expect(ENDLESS_BOSS_FROM).toBe(1300);
    expect(ENDLESS_BOSS_EVERY).toBe(500);
  });

  it('keyPieceBelow finds the key column of a key piece just below, mirrored with it', () => {
    const igloo = stageById('hammer-igloo')!.def;
    let checked = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = createGame(seed, igloo);
      for (const p of g.pieces.filter((p) => !p.boss)) {
        const c = ALL_CHUNKS.find((c) => c.id === p.id)!;
        const top = p.top + SKY_ROWS - 1;
        g.mole = { ...g.mole, y: top - 3 };
        const k = keyPieceBelow(g, 8);
        if (!c.bait || c.bait.chain < 2) continue;
        checked++;
        expect(k, p.id).toEqual({ x: p.mirror ? COLS - 1 - c.bait.keys[0] : c.bait.keys[0], chain: c.bait.chain });
        g.mole = { ...g.mole, y: top - 9 };
        expect(keyPieceBelow(g, 8)).toBeNull(); // too far above
        g.mole = { ...g.mole, y: top };
        expect(keyPieceBelow(g, 8)).toBeNull(); // already in it
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('a level only gets pieces it can show (colours, thaw timing)', () => {
    const lvl = DEFAULT_STAGE.levels[0];
    const two = ALL_CHUNKS.find((c) => c.id === 'key-chain2')!;
    const thaw = ALL_CHUNKS.find((c) => c.id === 'thaw-drop')!;
    expect(chunkFits(two, { ...lvl, colors: 3 })).toBe(true);
    expect(chunkFits(two, { ...lvl, colors: 2 })).toBe(false);
    expect(chunkFits(thaw, { ...lvl, colors: 3 })).toBe(false);
    expect(chunkFits(thaw, { ...lvl, colors: 3, thawTime: 2 })).toBe(true);
  });
});

describe('studio review: structured twists', () => {
  it('thaw ice sits under a same-colour stack of 2+', () => {
    const def = stageById('thaw-cave')!.def;
    let thaw = 0, stacked = 0, colored = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const g = createGame(seed, def);
      g.cells.forEach((c, i) => {
        if (c && c.color >= 0) colored++;
        if (c?.color !== THAW) return;
        thaw++;
        const a1 = g.cells[i - g.cols], a2 = g.cells[i - 2 * g.cols];
        if (a1 && a2 && a1.color >= 0 && a1.color === a2.color) stacked++;
      });
    }
    expect(stacked / thaw).toBeGreaterThan(0.97); // the rest: the thaw boss's keyholes
    // about the levels' thawChance (6-18%) of the coloured cells, not far fewer
    expect(thaw / (thaw + colored)).toBeGreaterThan(0.06);
  });

  it('xCluster grows X groups', () => {
    const groups = (stage: StageDef) => {
      let big = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const g = createGame(seed, stage);
        for (const m of computeChunks(g).chunks) if (g.cells[m[0]]!.color === XBLOCK && m.length >= 3) big++;
      }
      return big;
    };
    const plain: StageDef = { ...DEFAULT_STAGE, id: 'x0' };
    const clustered: StageDef = { ...plain, levels: plain.levels.map((l) => ({ ...l, xCluster: 0.3 })) };
    expect(groups(clustered)).toBeGreaterThan(groups(plain) * 2);
  });
});

describe('tempo', () => {
  it('builds within a level and resets at the next one (sawtooth)', () => {
    const g = createGame(1, DEFAULT_STAGE);
    g.mole.y = 2; g.level = 1;
    expect(levelTempo(g)).toBeCloseTo(TEMPO_START, 2);
    expect(levelAirTempo(g)).toBeCloseTo(AIR_START, 2); // easy breathing after the clear row
    g.mole.y = 2 + 95;
    expect(levelTempo(g)).toBeGreaterThan(1.25);
    expect(levelTempo(g)).toBeLessThanOrEqual(TEMPO_END);
    expect(levelAirTempo(g)).toBeGreaterThan(1.45); // the squeeze before the next clear row
    expect(levelAirTempo(g)).toBeLessThanOrEqual(AIR_END);
    g.mole.y = 2 + 102; g.level = 2; // just past the clear row
    expect(levelAirTempo(g)).toBeLessThan(1);
  });
});

describe('update beforeTick (input runs on the fixed tick)', () => {
  it('runs once per logic tick, however the frame time is cut', () => {
    const coarse = createGame(5), fine = createGame(5);
    let a = 0, b = 0;
    update(coarse, 10 * TICK + 1e-6, () => a++); // one long frame (a 6 fps hitch)
    for (let i = 0; i < 40; i++) update(fine, TICK / 4 + 1e-9, () => b++); // 240 Hz frames, same span
    expect(a).toBe(10);
    expect(b).toBe(10);
  });
  it('stops the ticks once it ends the run (a swing that used the last air)', () => {
    const g = createGame(5);
    let calls = 0;
    update(g, 3 * TICK + 1e-6, () => { calls++; g.state = 'lost'; });
    expect(calls).toBe(1);
  });
});
