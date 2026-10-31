import { describe, expect, it } from 'vitest';
import { createGame, drill, move, update } from './game';
import { calibrate, calibrationTable, careful, greedy, pieceZones, planner, plannerNoChain, POLICIES, simulate, slowPlanner } from './sim';
import { STAGES } from './stages';

const snowy = STAGES[0].def;

describe('sim smoke', () => {
  it('runs two short seeds per policy and returns sane numbers', () => {
    for (const policy of [greedy, careful, slowPlanner, planner]) {
      for (const seed of [1, 2]) {
        const r = simulate(snowy, seed, policy, { maxTime: 40 });
        expect(r.time).toBeGreaterThan(0);
        expect(r.time).toBeLessThanOrEqual(40 + 1 / 60 + 1e-6); // summed float dt can run one step over
        expect(r.depth).toBeGreaterThan(10); // the bot actually digs
        expect(r.swings).toBeGreaterThan(0);
        expect(r.score).toBeGreaterThan(0);
        expect(r.livesLost).toBeGreaterThanOrEqual(0);
        expect(r.airMin).toBeGreaterThanOrEqual(0);
        expect(r.airMin).toBeLessThanOrEqual(100);
        expect(['won', 'crushed', 'suffocated', 'timeout']).toContain(r.cause);
        expect(r.won).toBe(r.cause === 'won');
        expect(r.deaths.length).toBe(r.livesLost);
        expect(r.chainSteps.slice(1).some((n) => n > 0)).toBe(r.maxChain >= 2);
      }
    }
  });

  it('the board window speed-up gives the same result as a full-board run', () => {
    for (const { def } of STAGES) {
      const opts = { maxTime: 30 };
      expect(simulate(def, 3, careful, { ...opts, window: true })).toEqual(
        simulate(def, 3, careful, { ...opts, window: false }),
      );
    }
  }, 30_000); // ~6s alone; the default 5s limit flaked when the suite runs in parallel

  it('the planner gives the same result with and without the board window', () => {
    for (const { def } of [STAGES[0], STAGES[2]]) {
      const opts = { maxTime: 20 };
      expect(simulate(def, 4, planner, { ...opts, window: true })).toEqual(
        simulate(def, 4, planner, { ...opts, window: false }),
      );
    }
  }, 30_000);

  it('planning never touches the real game', () => {
    const g = createGame(5, snowy);
    for (let t = 0; t < 600 && g.state === 'playing'; t++) {
      const before = JSON.stringify({ ...g, rand: 0, stage: 0 });
      const a = planner(g);
      slowPlanner(g);
      expect(JSON.stringify({ ...g, rand: 0, stage: 0 })).toBe(before);
      if (a === 'drill') drill(g);
      else if (a !== 'wait') move(g, a);
      update(g, 1 / 60);
      g.events.length = 0;
    }
  });

  it('medal rates follow the stage criteria and nest', () => {
    const rows = calibrate(2, { maxTime: 25 }, { greedy });
    for (const r of rows) {
      const m = r.medalRates;
      expect(m.bronze).toBeGreaterThanOrEqual(m.silver);
      expect(m.silver).toBeGreaterThanOrEqual(m.gold);
      // a clear is at least bronze on finite stages
      if (!STAGES.find((s) => s.def.id === r.stage)!.depthMedals) expect(m.bronze).toBe(r.clearRate);
    }
    expect(calibrationTable(rows)).toContain('bronze+ / silver+ / gold');
  }, 30_000);

  it('the chain-blind planner plays differently from the planner', () => {
    const a = simulate(snowy, 1, planner, { maxTime: 25 });
    const b = simulate(snowy, 1, plannerNoChain, { maxTime: 25 });
    expect(b.depth).toBeGreaterThan(10);
    expect(b).not.toEqual(a);
  }, 30_000);

  it('melt chains: the tracker finds every melt chain the game counts, and step 2+ ones are a subset', () => {
    const thaw = STAGES.find((s) => s.def.id === 'thaw-cave')!.def;
    let melts = 0;
    for (const seed of [1, 2]) {
      const r = simulate(thaw, seed, greedy, { maxTime: 50 });
      expect(r.meltRoots).toBe(r.meltChains);
      expect(r.meltChains2).toBeLessThanOrEqual(r.meltChains);
      melts += r.meltChains;
    }
    expect(melts).toBeGreaterThan(0); // the check above is not vacuous
  }, 30_000);

  it('score economy fields are consistent', () => {
    const r = simulate(snowy, 2, greedy, { maxTime: 30 });
    expect(r.comboPoints).toBeGreaterThanOrEqual(0);
    expect(r.comboPoints).toBeLessThanOrEqual(r.score);
    expect(r.extends).toBeGreaterThanOrEqual(0);
  });

  it('lost lives are placed in the piece bands the game recorded', () => {
    const aurora = STAGES.find((s) => s.def.id === 'aurora-north')!.def;
    let lost = 0;
    for (const seed of [1, 2, 3]) {
      const zones = pieceZones(createGame(seed, aurora).pieces); // a finite board is whole from the start
      expect(zones.filter((z) => z.boss).length).toBe(1);
      expect(zones.find((z) => z.boss)!.to).toBe(aurora.levels.length * 100 + 1); // right above the goal
      const r = simulate(aurora, seed, greedy, { maxTime: 40 });
      lost += r.deaths.length;
      for (const d of r.deaths) {
        const z = zones.find((z) => d.depth >= z.from && d.depth < z.to);
        expect(d.zone).toBe(z ? (z.boss ? 'boss' : 'piece') : null);
      }
      expect(r.pieceCover[0] + r.pieceCover[1]).toBeGreaterThan(0);
      expect(r.pieceCover[0] + r.pieceCover[1]).toBeLessThan(1);
    }
    expect(lost).toBeGreaterThan(0); // the label check above is not vacuous
  }, 30_000);

  it('a bot shuffling between two X floors breaks one instead of stalling (round 3)', () => {
    // seed 1 on the igloo stalled at 216m until the run timed out
    const igloo = STAGES.find((s) => s.def.id === 'hammer-igloo')!.def;
    expect(simulate(igloo, 1, planner).cause).not.toBe('timeout');
  }, 60_000);

  it('the chain-blind planners ignore chain air and key columns; the slow one has its own', () => {
    expect(POLICIES.slowNoChain).toBeDefined();
    const a = simulate(snowy, 3, slowPlanner, { maxTime: 25 });
    const b = simulate(snowy, 3, POLICIES.slowNoChain, { maxTime: 25 });
    expect(b.depth).toBeGreaterThan(10);
    expect(b).not.toEqual(a);
  }, 30_000);

  it('caps endless runs at maxDepth', () => {
    const endless = STAGES.find((s) => s.def.endless)!.def;
    const r = simulate(endless, 1, greedy, { maxDepth: 40 });
    expect(r.cause).toBe('capped');
    expect(r.depth).toBe(40);
  });
});

// CALIBRATE=1 npx vitest run src/sim.test.ts   (CAL_SEEDS=n to change the seed count, default 40;
// CAL_BOTS=greedy,planner to run only some bots: the planners (planner, plannerNoChain, slow) are
// ~10x / ~10x / ~4x the CPU of the others)
describe.runIf(import.meta.env.CALIBRATE === '1')('calibration', () => {
  it('prints the calibration table', () => {
    const seeds = Number(import.meta.env.CAL_SEEDS ?? 40);
    const t0 = performance.now();
    const bots = String(import.meta.env.CAL_BOTS ?? Object.keys(POLICIES).join(',')).split(',');
    const table = calibrationTable(calibrate(seeds, {}, Object.fromEntries(bots.map((b) => [b, POLICIES[b]]))));
    console.log(`\n${table}\n\n(${seeds} seeds per row, ${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }, 30 * 60_000);
});
