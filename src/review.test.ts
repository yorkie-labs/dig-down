import { describe, expect, it } from 'vitest';
import {
  CAPSULE, cellAt, CLEAR, createGame, DEFAULT_STAGE, drill, Game, LevelDef, makeCell, StageDef, THAW, tick, TICK, XBLOCK,
} from './game';

function fromAscii(rows: string[]): Game {
  const g = createGame(1);
  g.cols = rows[0].length;
  g.rows = rows.length;
  g.cells = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === 'M') g.mole = { ...g.mole, x, y };
      if (ch === '.' || ch === 'M') g.cells.push(null);
      else g.cells.push(makeCell(ch === 'X' ? XBLOCK : ch === 'O' ? CAPSULE : ch === '=' ? CLEAR : ch === 'T' ? THAW : ch.charCodeAt(0) - 97));
    });
  });
  return g;
}
const run = (g: Game, seconds: number) => { for (let i = 0; i < Math.round(seconds / TICK); i++) tick(g); };
const base = DEFAULT_STAGE.levels[0];
const noThaw: LevelDef = { ...base };
const thaw: LevelDef = { ...base, thawChance: 1, thawTime: 1 };

describe('review: melt-chain attribution', () => {
  it('stale melts are never pruned once the mole is on a level without thawTime', () => {
    const g = fromAscii(['T...', 'a...', 'd...', 'aaaM', 'bbbb']);
    g.levels = [thaw, noThaw];
    run(g, 1.5); // the thaw ice melts while on a thaw level
    expect(g.events.some((e) => e.type === 'melt')).toBe(true);
    g.level = 2; // mole moves on to a level with no thaw ice (Aurora 4->5, endless 3->4)
    run(g, 10); // much later
    g.cells[2 * 4 + 0] = null; // an unrelated drop in the same column, 10s later
    run(g, 3);
    expect(g.events.some((e) => e.type === 'pop')).toBe(true);
    expect(g.stats.meltChains).toBe(0); // actual: 1 (melts list kept forever)
  });
});

describe('review: thaw timer uses the mole level, not the cell level', () => {
  it('next level top-row thaw ice stays frozen while the mole stands on the cleared row', () => {
    const stage: StageDef = { id: 'r', levels: [noThaw, thaw], capsuleChance: 0, air: { kind: 'time' } };
    const g = createGame(3, stage);
    for (let x = 0; x < g.cols; x++) {
      g.cells[102 * g.cols + x] = makeCell(THAW); // first row of level 2 (depth 101): thaw ice
      g.cells[103 * g.cols + x] = makeCell(0);
    }
    g.mole.y = 100;
    g.mole.facing = 'down';
    drill(g); // the CLEAR row at y=101 (depth 100): wipes everything above
    run(g, 5); // mole falls onto the cleared row (still level 1) and waits
    expect(g.mole.y).toBeGreaterThanOrEqual(101); // with the fix the ice under it melts and it drops further
    const left = Array.from({ length: g.cols }, (_, x) => cellAt(g, x, 102)?.color).filter((c) => c === THAW).length;
    expect(left).toBe(0); // exposed for 5s with thawTime 1; actual: all 9 still frozen
  });
});

describe('review: swing air', () => {
  it('a swing that suffocates the last life does not still land and score', () => {
    const stage: StageDef = { ...DEFAULT_STAGE, id: 's', air: { kind: 'swing', perSwing: [1, 1, 1, 1, 1], xBreakAir: 0 } };
    const g = fromAscii(['Mb', 'aa']);
    g.stage = stage;
    g.lives = 1;
    g.air = 0.5;
    g.mole.facing = 'right';
    drill(g);
    expect(g.state).toBe('lost');
    expect(cellAt(g, 1, 0)).not.toBeNull(); // the block survives: the swing never landed
    expect(g.score).toBe(0);
  });

  it('grabbing a capsule with the hammer is free, like walking into it', () => {
    const stage: StageDef = { ...DEFAULT_STAGE, id: 's', air: { kind: 'swing', perSwing: [1, 1, 1, 1, 1], xBreakAir: 0 } };
    const g = fromAscii(['MO', 'aa']);
    g.stage = stage;
    g.air = 0.5;
    g.mole.facing = 'right';
    drill(g);
    expect(g.state).toBe('playing');
    expect(g.stats.swings).toBe(0);
    expect(g.capsules).toBe(1);
  });
});
