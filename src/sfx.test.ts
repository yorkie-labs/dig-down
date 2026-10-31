import { describe, expect, it, vi } from 'vitest';
import * as sfx from './sfx';

const sounds = (): (() => void)[] => [
  sfx.sfxHammer, sfx.sfxWhiff, () => sfx.sfxBreak(3), () => sfx.sfxXChip(2), sfx.sfxXBreak,
  () => sfx.sfxPop(1), () => sfx.sfxPop(20), () => sfx.sfxCombo(9), sfx.sfxCapsule, sfx.sfxLand,
  sfx.sfxWobbleTick, sfx.sfxDangerTick, sfx.sfxHeartbeat, sfx.sfxCrush, sfx.sfxSuffocate, sfx.sfxShield,
  sfx.sfxLevelUp, sfx.sfxClearRow, sfx.sfxFriend, sfx.sfxClock, sfx.sfxWin, sfx.sfxLose, sfx.sfxStep,
];

// Minimal stand-in for the WebAudio graph: every node method is a no-op, sources are counted.
let started = 0;
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
const node = (extra: object = {}) => ({ connect() {}, ...extra });
const source = () => node({ frequency: param(), type: '', buffer: null, onended: null, start() { started++; }, stop() {} });
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  createGain() { return node({ gain: param() }); }
  createOscillator() { return source(); }
  createBufferSource() { return source(); }
  createBiquadFilter() { return node({ type: '', frequency: param(), Q: param() }); }
  createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
  createBuffer(_c: number, len: number) { const d = new Float32Array(len); return { getChannelData: () => d }; }
  resume() { return Promise.resolve(); }
}

describe('sfx', () => {
  it('no-ops without AudioContext (node/SSR)', () => {
    expect(() => {
      sfx.initSfx();
      sfx.unlockSfx();
      for (const s of sounds()) s();
    }).not.toThrow();
  });

  it('mute toggles and survives missing storage', () => {
    const before = sfx.isMuted();
    expect(sfx.toggleMuted()).toBe(!before);
    sfx.setMuted(false);
    expect(sfx.isMuted()).toBe(false);
  });

  it('plays through a WebAudio graph, respects mute and voice limit', () => {
    (globalThis as any).AudioContext = FakeAudioContext;
    try {
      sfx.unlockSfx();
      sfx.setMuted(true);
      for (const s of sounds()) s();
      expect(started).toBe(0);
      sfx.setMuted(false);
      expect(() => { for (const s of sounds()) s(); }).not.toThrow();
      expect(started).toBeGreaterThan(0);
      // Voices never end in the fake: the pool must stay at the cap however much is played.
      for (let i = 0; i < 50; i++) sfx.sfxWin();
      expect(sfx._voicePrios().length).toBe(32);
    } finally {
      delete (globalThis as any).AudioContext;
    }
  });

  it('resumes an interrupted context and never runs a noise burst off the end of its buffer', async () => {
    vi.resetModules();
    const fresh = await import('./sfx'); // a module with no context yet
    const starts: [number, number, number][] = [];
    let resumed = 0, bufSecs = 0;
    class Ctx extends FakeAudioContext {
      state = 'interrupted'; // WebKit after a call or Siri (bug review 5)
      createBufferSource() { return node({ buffer: null as { getChannelData: () => Float32Array } | null, onended: null, start(t: number, off: number, dur: number) { starts.push([t, off, dur]); }, stop() {} }); }
      createBuffer(_c: number, len: number) { bufSecs = len / this.sampleRate; const d = new Float32Array(len); return { getChannelData: () => d }; }
      resume() { resumed++; this.state = 'running'; return Promise.resolve(); }
    }
    (globalThis as any).AudioContext = Ctx;
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      fresh.setMuted(false);
      fresh.unlockSfx();
      expect(resumed).toBe(1);
      fresh.sfxCrush();
      fresh.sfxSuffocate();
      expect(starts.length).toBeGreaterThan(0);
      for (const [, off, dur] of starts) expect(off + dur).toBeLessThanOrEqual(bufSecs + 1e-9);
    } finally {
      rnd.mockRestore();
      delete (globalThis as any).AudioContext;
    }
  });

  // Records every oscillator's start/glide frequency and its envelope peak (tone() creates the
  // oscillator, then its gain), so tests can check what a sound actually schedules.
  interface Osc { f: number; to: number; peak: number; type: string }
  async function record(play: (m: typeof sfx) => void): Promise<Osc[]> {
    vi.resetModules();
    const m = await import('./sfx');
    const oscs: Osc[] = [];
    let last: Osc | null = null;
    class Ctx extends FakeAudioContext {
      createOscillator() {
        const o: Osc = { f: 0, to: 0, peak: 0, type: '' };
        oscs.push(o);
        last = o;
        const s = source();
        return { ...s, frequency: { ...param(), setValueAtTime(v: number) { o.f = v; o.to = o.to || v; }, exponentialRampToValueAtTime(v: number) { o.to = v; } }, set type(t: string) { o.type = t; } };
      }
      createBufferSource() { last = null; return source(); }
      createGain() {
        const o = last;
        last = null;
        return node({ gain: { ...param(), linearRampToValueAtTime(v: number) { if (o) o.peak = Math.max(o.peak, v); } } });
      }
    }
    (globalThis as any).AudioContext = Ctx;
    try {
      m.setMuted(false);
      m.unlockSfx();
      play(m);
    } finally {
      delete (globalThis as any).AudioContext;
    }
    return oscs;
  }
  const rnd = () => vi.spyOn(Math, 'random').mockReturnValue(0.5); // jit() = 1: exact frequencies

  it('a crush always gets its voices after a burst, and a later burst cannot steal them', async () => {
    vi.resetModules();
    const m = await import('./sfx');
    (globalThis as any).AudioContext = FakeAudioContext;
    const r = rnd();
    let now = 0;
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => (now += 100)); // pass every gate
    try {
      m.setMuted(false);
      m.unlockSfx();
      m.sfxCrush();
      const crushVoices = m._voicePrios().filter((p) => p === 3).length;
      expect(crushVoices).toBe(4); // 1 noise + 3 tones
      for (let i = 0; i < 40; i++) { m.sfxBreak(4); m.sfxPop(i % 16 + 1); m.sfxCombo(9); m.sfxHammer(); }
      expect(m._voicePrios().length).toBe(32);
      // full of pops/combos (prio 2) and the newest breaks; a crush must still get all its voices
      m.sfxCrush();
      expect(m._voicePrios().filter((p) => p === 3).length).toBe(crushVoices * 2);
      for (let i = 0; i < 40; i++) { m.sfxPop(5); m.sfxCombo(6); m.sfxBreak(2); }
      expect(m._voicePrios().filter((p) => p === 3).length).toBe(crushVoices * 2);
      // a low-priority sound steals only low-priority voices; with none left it is dropped
      const before = m._voicePrios().slice();
      for (let i = 0; i < 40; i++) m.sfxHammer();
      expect(m._voicePrios().filter((p) => p >= 2).length).toBe(before.filter((p) => p >= 2).length);
    } finally {
      perf.mockRestore();
      r.mockRestore();
      delete (globalThis as any).AudioContext;
    }
  });

  it('steals the oldest voice of the lowest priority first', async () => {
    vi.resetModules();
    const m = await import('./sfx');
    (globalThis as any).AudioContext = FakeAudioContext;
    let now = 0;
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => (now += 100));
    try {
      m.setMuted(false);
      m.unlockSfx();
      m.sfxPop(1); // 7 prio-2 voices, oldest
      for (let i = 0; i < 20; i++) m.sfxHammer(); // prio 1 fills to the cap
      expect(m._voicePrios().slice(0, 7)).toEqual([2, 2, 2, 2, 2, 2, 2]);
      m.sfxCombo(2); // 2 prio-2 voices take the two oldest prio-1 slots, not the older pop
      const p = m._voicePrios();
      expect(p.length).toBe(32);
      expect(p.slice(0, 7)).toEqual([2, 2, 2, 2, 2, 2, 2]);
      expect(p.slice(-2)).toEqual([2, 2]);
      expect(p.filter((x) => x === 2).length).toBe(9);
    } finally {
      perf.mockRestore();
      delete (globalThis as any).AudioContext;
    }
  });

  it('combo: 2..6 notes on the shared pentatonic, 7+ keeps 6 notes and rises a semitone each', () => {
    const scale = new Set<number>();
    for (let d = 0; d < 15; d++) scale.add(Math.round(sfx.pentaFreq(d)));
    expect(sfx.comboFreqs(2).length).toBe(2);
    const six = sfx.comboFreqs(6), eight = sfx.comboFreqs(8);
    expect(six.length).toBe(6);
    expect(eight.length).toBe(6);
    for (const f of six) expect(scale.has(Math.round(f))).toBe(true);
    expect(eight.map(Math.round)).not.toEqual(six.map(Math.round));
    eight.forEach((f, i) => expect(f / six[i]).toBeCloseTo(2 ** (2 / 12), 6));
    expect(sfx.comboFreqs(7)[0] / six[0]).toBeCloseTo(2 ** (1 / 12), 6);
    expect(sfx.comboFreqs(99)[5]).toBeCloseTo(six[5] * 2, 6); // capped an octave up
  });

  it('combo runs use fundamentals only: half the voices of a partial-doubled run', async () => {
    const r = rnd();
    try {
      const six = await record((m) => m.sfxCombo(6));
      expect(six.length).toBe(6);
      const eight = await record((m) => m.sfxCombo(8));
      expect(eight.map((o) => Math.round(o.f))).not.toEqual(six.map((o) => Math.round(o.f)));
    } finally {
      r.mockRestore();
    }
  });

  it('pop: step climbs the pentatonic monotonically to a capped root, every note in the scale', async () => {
    const scale = new Set<number>();
    for (let d = 0; d < 20; d++) scale.add(Math.round(sfx.pentaFreq(d)));
    let prev = -1;
    for (let s = 1; s <= sfx.POP_STEP_CAP; s++) {
      const d = sfx.popDegree(s);
      expect(d).toBeGreaterThanOrEqual(prev);
      if (s <= 6) expect(d).toBe(s - 1);
      prev = d;
    }
    expect(sfx.popDegree(16)).toBe(sfx.popDegree(40));
    expect(sfx.pentaFreq(sfx.popDegree(16))).toBeLessThan(2200); // C7, not C8
    const r = rnd();
    try {
      for (const s of [1, 3, 9, 16]) {
        const oscs = await record((m) => m.sfxPop(s));
        const fundamentals = oscs.filter((o) => o.type === 'sine' && o.peak >= 0.2);
        expect(fundamentals.length).toBe(3);
        for (const o of fundamentals) expect(scale.has(Math.round(o.f))).toBe(true);
      }
    } finally {
      r.mockRestore();
    }
  });

  // Phone/laptop speakers roll off below ~150Hz; a danger cue must carry energy above that.
  it('danger cues reach the phone-speaker band', async () => {
    const r = rnd();
    try {
      const band = (oscs: Osc[], lo: number, gain: number) => oscs.filter((o) => Math.min(o.f, o.to) >= lo && o.peak >= gain);
      const heart = await record((m) => m.sfxHeartbeat());
      expect(heart.some((o) => o.f === 124 && o.type === 'triangle')).toBe(true);
      expect(heart.some((o) => o.f === 186 && o.type === 'triangle')).toBe(true);
      expect(heart.some((o) => o.f === 2000)).toBe(true);
      expect(band(heart, 100, 0.2).length).toBeGreaterThanOrEqual(2);
      const land = await record((m) => m.sfxLand());
      expect(land.some((o) => o.f === 160 && o.peak >= 0.3)).toBe(true);
      const crush = await record((m) => m.sfxCrush());
      expect(band(crush, 150, 0.25).length).toBeGreaterThanOrEqual(1);
      const tick = await record((m) => m.sfxDangerTick());
      expect(tick).toEqual([{ f: 700, to: 700, peak: 0.12, type: 'triangle' }]);
    } finally {
      r.mockRestore();
    }
  });
});
