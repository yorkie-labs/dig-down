// Synthesized sound effects (WebAudio, zero asset files). Palette: soft toy
// xylophone/marimba — sine/triangle partials with short filtered-noise
// transients — not harsh 8-bit square waves. Every call is a safe no-op when
// AudioContext is missing (SSR/tests) or not yet unlocked by a user gesture.
//
// Wiring (renderer consumes g.events from src/game.ts):
//   input dig with a block hit       -> sfxHammer()        (every swing that connects)
//   input dig into empty/air         -> sfxWhiff()
//   'drill' { cells }                -> sfxBreak(cells.length)
//   'chip'  { hp }                   -> sfxXChip(hp)        (X block hit, hp = hits left)
//   'xbreak'                         -> sfxXBreak()
//   'pop'   { step }                 -> sfxPop(step)        (step = chain + combo; climbs the pentatonic)
//   'combo' { n }                    -> sfxCombo(n + 1)     (n >= 7 rises a semitone per extra combo)
//   'capsule'                        -> sfxCapsule()
//   'land'                           -> sfxLand()           (self rate-limited, call per event)
//   cell.wobble > 0 (each ~0.25s)    -> sfxWobbleTick()     (self rate-limited)
//   wobbling block in hero's column  -> sfxDangerTick()     (self rate-limited, call every frame it holds)
//   air low (e.g. <= 25%, each ~0.8s)-> sfxHeartbeat()
//   'crush'                          -> sfxCrush()
//   'suffocate'                      -> sfxSuffocate()
//   respawn/invulnerable shield on   -> sfxShield()
//   'level'                          -> sfxLevelUp()
//   'levelclear'                     -> sfxClearRow()
//   'friend'                         -> sfxFriend()
//   'clock'                          -> sfxClock()
//   'won'                            -> sfxWin()
//   'lost'                           -> sfxLose()
//   mole moved one cell              -> sfxStep()           (self rate-limited)
// Call initSfx() once at boot (loads mute pref, arms gesture unlock) and
// unlockSfx() from key/pointer handlers too; toggleMuted() for the M key.
//
// Voices are prioritized (studio review 2, item 7): when all MAX_VOICES are busy a new sound
// steals the oldest voice of the lowest priority at or below its own, so a crush or the
// lose jingle is never the sound that gets dropped at the climax of a big cascade.

const STORE_KEY = 'dig-down:sfx:v1';
const MASTER_GAIN = 0.4; // spec value
// our tuning: was 18, which a combo arpeggio + chain pops + breaks filled at the climax and the
// crush that followed was silently dropped (studio review 2). 32 is cheap on any phone.
const MAX_VOICES = 32;
const JITTER = 0.08; // ±8% pitch so repeated hits don't sound machine-gunned
const NOISE_SECS = 1; // shared noise buffer: the longest burst plus room for a random offset (our tuning)

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
// Priorities (studio review 2): 3 = crush/lose/win (must be heard), 2 = pop/combo, 1 = the rest.
type Prio = 1 | 2 | 3;
interface Voice {
  src: AudioScheduledSourceNode;
  gain: GainNode | null;
  prio: Prio;
}
const voices: Voice[] = []; // oldest first
let prio: Prio = 1; // priority of the sound being built; set by withPrio()
let armed = false;
const lastAt = new Map<string, number>();

function readPref(): void {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (raw) muted = !!JSON.parse(raw).muted;
  } catch {
    /* storage blocked or corrupt: keep default */
  }
}

function writePref(): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify({ muted }));
  } catch {
    /* storage blocked: mute still works for this session */
  }
}

export function initSfx(): void {
  readPref();
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const once = () => {
    unlockSfx();
    if (ctx?.state === 'running') {
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, once);
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, once, { passive: true });
}

/** Create/resume the AudioContext. Must run inside a user-gesture handler to satisfy autoplay policy. */
export function unlockSfx(): void {
  try {
    if (!ctx) {
      const AC: typeof AudioContext | undefined =
        (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      // Light compression so stacked chain pops don't clip; gentle, not pumping.
      const comp = ctx.createDynamicsCompressor();
      // -10 / 3 (was -14 / 4): the old setting squashed a 6-pop climax into mush (studio review 2)
      comp.threshold.value = -10;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.15;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_GAIN;
      master.connect(comp);
      comp.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * NOISE_SECS);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    // not just 'suspended': WebKit leaves the context 'interrupted' after a call, Siri or a trip to
    // the background, and only a resume inside a gesture brings it back (bug review 5)
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  } catch {
    ctx = null;
    master = null;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  writePref();
  if (ctx && master) {
    // Short ramp instead of a hard cut so ringing notes don't click.
    master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

// ---- synthesis helpers ----

/** Audio is live and audible; returns start time or null. */
function now(): number | null {
  if (muted || !ctx || !master || ctx.state !== 'running') return null;
  return ctx.currentTime;
}

/** Drop a sound if the same key fired less than `ms` ago (e.g. 10 cells landing in one frame). */
function gate(key: string, ms: number): boolean {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prev = lastAt.get(key);
  if (prev !== undefined && t - prev < ms) return false;
  lastAt.set(key, t);
  return true;
}

const jit = () => 1 + (Math.random() * 2 - 1) * JITTER;

/** Build a sound at priority p: every voice tone()/noise() claims inside fn carries it. */
function withPrio(p: Prio, fn: () => void): void {
  const prev = prio;
  prio = p;
  try {
    fn();
  } finally {
    prio = prev;
  }
}

function drop(v: Voice): void {
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
}

/** Pick the voice to steal for a new one at priority p: lowest priority first, oldest within it. */
function victim(p: Prio): Voice | null {
  let best: Voice | null = null;
  for (const v of voices) if (v.prio <= p && (!best || v.prio < best.prio)) best = v; // first hit = oldest
  return best;
}

/** Reserve a voice slot; when full, steal one of equal or lower priority, else drop the new sound. */
function claim(node: AudioScheduledSourceNode): Voice | null {
  if (voices.length >= MAX_VOICES) {
    const v = victim(prio);
    if (!v) return null;
    drop(v);
    try {
      // 5ms fade instead of a hard cut so the stolen note doesn't click
      const t = ctx!.currentTime;
      v.gain?.gain.cancelScheduledValues(t);
      v.gain?.gain.setTargetAtTime(0, t, 0.005);
      v.src.stop(t + 0.03);
    } catch {
      /* already stopped: the slot is free either way */
    }
  }
  const v: Voice = { src: node, gain: null, prio };
  voices.push(v);
  node.onended = () => drop(v);
  return v;
}

/** Test hook: priorities of the live voices, oldest first. */
export function _voicePrios(): number[] {
  return voices.map((v) => v.prio);
}

function env(g: GainNode, t: number, peak: number, attack: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  to?: number; // glide target frequency
  delay?: number;
  lowpass?: number;
}

function tone(freq: number, dur: number, o: ToneOpts = {}): void {
  const t0 = now();
  if (t0 === null) return;
  const c = ctx!;
  const t = t0 + (o.delay ?? 0);
  const osc = c.createOscillator();
  const v = claim(osc);
  if (!v) return;
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = c.createGain();
  v.gain = g;
  env(g, t, o.gain ?? 0.3, o.attack ?? 0.004, dur);
  let out: AudioNode = osc;
  if (o.lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lowpass;
    osc.connect(f);
    out = f;
  }
  out.connect(g);
  g.connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

interface NoiseOpts {
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number; // filter sweep target
  q?: number;
  delay?: number;
}

function noise(dur: number, o: NoiseOpts = {}): void {
  const t0 = now();
  if (t0 === null || !noiseBuf) return;
  const c = ctx!;
  const t = t0 + (o.delay ?? 0);
  const src = c.createBufferSource();
  const v = claim(src);
  if (!v) return;
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = o.filter ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq ?? 2000, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  v.gain = g;
  env(g, t, o.gain ?? 0.2, 0.002, dur);
  src.connect(f);
  f.connect(g);
  g.connect(master!);
  // Random offset into the buffer so consecutive bursts aren't identical, never so late that the
  // buffer ends before the burst does (a 0.4s offset into 0.5s cut the crush tail; bug review 7)
  src.start(t, Math.random() * Math.max(0, NOISE_SECS - dur - 0.03), dur + 0.03);
}

/** Struck-bar note: fundamental + quiet high partial (xylophone bars ring ~3x/4x). partial=false
 *  plays the fundamental alone, for fast runs where the partial would double the voice count. */
function bar(freq: number, dur: number, gain: number, delay = 0, partial = true): void {
  tone(freq, dur, { type: 'sine', gain, delay });
  if (partial) tone(freq * 3.0, dur * 0.35, { type: 'sine', gain: gain * 0.18, delay });
}

// One scale for every musical cue: C major pentatonic from C5 (the spec'd pop base). The old combo
// run sat on G with a B (x1.25) that clashed against the C-rooted pops it plays over (studio
// review 2, item 9); with one five-note scale any two cues can overlap without a semitone rub.
const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3]; // C D E G A (just ratios)
const BASE = 523; // C5
/** Frequency of pentatonic degree d (0 = C5, 5 = C6, ...). */
export function pentaFreq(d: number): number {
  return BASE * 2 ** Math.floor(d / 5) * PENTA[((d % 5) + 5) % 5];
}

// ---- sounds ----

export function sfxHammer(): void {
  if (!gate('hammer', 30)) return;
  const j = jit();
  noise(0.03, { freq: 2600 * j, q: 1.4, gain: 0.22 });
  tone(240 * j, 0.06, { type: 'triangle', to: 150 * j, gain: 0.25 });
}

export function sfxWhiff(): void {
  if (!gate('whiff', 60)) return;
  noise(0.09, { freq: 700 * jit(), to: 2200, q: 0.8, gain: 0.08 });
}

/** size = cells removed by one drill; bigger clumps ring lower and a bit louder. */
export function sfxBreak(size = 1): void {
  if (!gate('break', 25)) return;
  const n = Math.max(1, Math.min(size, 8));
  const f = (1046 / (1 + 0.07 * (n - 1))) * jit(); // C6 down toward ~G5 for big clumps (our tuning)
  bar(f, 0.16, 0.22 + 0.02 * n);
  noise(0.04, { freq: 4500, q: 0.9, gain: 0.12 + 0.01 * n, filter: 'highpass' });
}

/** X block chipped; hpLeft = hits remaining. Pitch climbs as it nears breaking. */
export function sfxXChip(hpLeft = 1): void {
  if (!gate('xchip', 30)) return;
  const f = (380 / (1 + 0.18 * Math.max(0, hpLeft))) * jit();
  tone(f, 0.09, { type: 'triangle', to: f * 0.8, gain: 0.3 });
  noise(0.05, { freq: 1200, q: 2, gain: 0.16 });
}

export function sfxXBreak(): void {
  noise(0.18, { filter: 'lowpass', freq: 1800, to: 300, gain: 0.28 });
  tone(420, 0.2, { type: 'triangle', to: 140, gain: 0.25 });
  bar(1568 * jit(), 0.25, 0.12, 0.05);
}

export const POP_STEP_CAP = 16; // e.step = chain + combo; above this nothing changes (our tuning)

/** Pentatonic degree of the pop root for a step: one degree per step up to C6, then one per two
 *  steps so step 16 tops out at C7 (2.1kHz) instead of C8 (4.2kHz, shrill). Our tuning. */
export function popDegree(step: number): number {
  const s = Math.max(1, Math.min(Math.floor(step), POP_STEP_CAP));
  return s <= 6 ? s - 1 : 5 + Math.ceil((s - 6) / 2);
}

/** step = the pop event's chain + combo, 1..16; the root climbs the pentatonic and plays a
 *  root / +2 / +4 degree arpeggio (C-E-A, D-G-C, ...), always inside the one scale. */
export function sfxPop(step = 1): void {
  if (!gate('pop', 20)) return;
  const d = popDegree(step);
  withPrio(2, () => {
    [0, 2, 4].forEach((k, i) => bar(pentaFreq(d + k), 0.2, 0.2, i * 0.045));
    tone(pentaFreq(d) / 2, 0.18, { type: 'triangle', gain: 0.1 }); // soft low body
  });
}

export const COMBO_NOTES = 6;
export const COMBO_RISE_CAP = 12; // semitones; a 19-combo would otherwise run past 4kHz (our tuning)

/** Frequencies of the combo run: min(n,6) pentatonic notes up from G5; from n = 7 the 6-note run
 *  rises a semitone per extra combo (capped an octave up) so a long combo keeps climbing. */
export function comboFreqs(n: number): number[] {
  const k = Math.max(2, Math.min(Math.floor(n), COMBO_NOTES));
  const rise = 2 ** (Math.min(Math.max(0, Math.floor(n) - COMBO_NOTES), COMBO_RISE_CAP) / 12);
  return Array.from({ length: k }, (_, i) => pentaFreq(3 + i) * rise);
}

/** n = combo count (renderer passes event n + 1); faster as it grows. */
export function sfxCombo(n = 2): void {
  const fs = comboFreqs(n);
  const gap = 0.06 - 0.005 * fs.length;
  // fundamentals only: the 3x partials doubled a 6-note run to 12 voices on top of the pops
  withPrio(2, () => fs.forEach((f, i) => bar(f, 0.15, 0.16, i * gap, false)));
}

export function sfxCapsule(): void {
  tone(660, 0.12, { to: 990, gain: 0.28, attack: 0.01 }); // spec glide
  bar(1980, 0.12, 0.08, 0.1);
}

/** Rate-limited: a whole stack settling in one frame makes one thump, not ten. */
// Danger cues need energy above ~150Hz: phone and laptop speakers roll off below that, and the old
// 40-80Hz thumps were silent on them (studio review 2, item 8). Sub layers stay for headphones.
export function sfxLand(): void {
  if (!gate('land', 40)) return;
  const j = jit();
  tone(160 * j, 0.07, { type: 'triangle', to: 120 * j, gain: 0.4 }); // fundamental a phone can play
  tone(80 * j, 0.06, { to: 52, gain: 0.25 }); // sub thump for headphones
  noise(0.03, { filter: 'lowpass', freq: 900, gain: 0.18 });
}

export function sfxWobbleTick(): void {
  if (!gate('wobble', 70)) return;
  tone(1300 * jit(), 0.025, { type: 'triangle', gain: 0.07 });
}

/** Short wooden tick for a block wobbling over the hero's own column: more urgent than the
 *  generic wobble tick, mid-band so it cuts through on any speaker. */
export function sfxDangerTick(): void {
  if (!gate('danger', 120)) return;
  tone(700, 0.04, { type: 'triangle', gain: 0.12 });
}

export function sfxHeartbeat(): void {
  if (!gate('heart', 300)) return;
  // lub-dub: the 62/55Hz sub is felt on headphones; the 124/186Hz triangles (octave and twelfth,
  // odd harmonics up to ~1kHz) and a 10ms 2kHz click carry it on a phone speaker
  tone(62, 0.1, { to: 45, gain: 0.4, attack: 0.008 });
  tone(124, 0.1, { type: 'triangle', to: 100, gain: 0.3, attack: 0.006 });
  tone(2000, 0.01, { type: 'triangle', gain: 0.15, attack: 0.001 });
  tone(55, 0.12, { to: 40, gain: 0.3, attack: 0.008, delay: 0.17 });
  tone(186, 0.1, { type: 'triangle', to: 150, gain: 0.22, attack: 0.006, delay: 0.17 });
}

export function sfxCrush(): void {
  withPrio(3, () => {
    noise(0.28, { filter: 'lowpass', freq: 900, to: 150, gain: 0.32 });
    tone(140, 0.32, { to: 40, gain: 0.4 }); // sub drop for headphones
    tone(320, 0.26, { type: 'triangle', to: 160, gain: 0.3 }); // body that stays above 150Hz
    tone(660, 0.3, { type: 'triangle', to: 330, gain: 0.12, delay: 0.12 }); // sad "boing"
  });
}

export function sfxSuffocate(): void {
  tone(400, 0.4, { type: 'sawtooth', to: 60, gain: 0.18, lowpass: 1100, attack: 0.01 }); // spec; lowpass keeps it soft
  noise(0.35, { freq: 900, to: 300, q: 0.7, gain: 0.06 });
}

export function sfxShield(): void {
  bar(1046, 0.35, 0.12);
  bar(1568, 0.35, 0.1, 0.06);
  noise(0.25, { filter: 'highpass', freq: 6000, gain: 0.04, delay: 0.03 });
}

export function sfxLevelUp(): void {
  [523, 659, 784, 1046].forEach((f, i) => bar(f, 0.22, 0.2, i * 0.07)); // C E G C
}

export function sfxClearRow(): void {
  // G5..G6 on the shared scale (was G major pentatonic, whose B rubbed against the C pops)
  for (let i = 0; i < 6; i++) bar(pentaFreq(3 + i), 0.14, 0.14, i * 0.035);
}

export function sfxFriend(): void {
  tone(880, 0.08, { type: 'triangle', to: 1320, gain: 0.2 });
  tone(1100, 0.1, { type: 'triangle', to: 1650, gain: 0.18, delay: 0.1 });
}

export function sfxClock(): void {
  tone(1500, 0.04, { type: 'triangle', gain: 0.18 });
  tone(1000, 0.05, { type: 'triangle', gain: 0.18, delay: 0.12 });
  bar(1319, 0.2, 0.1, 0.24);
}

export function sfxWin(): void {
  withPrio(3, () => {
    [523, 659, 784].forEach((f, i) => bar(f, 0.18, 0.2, i * 0.1));
    [1046, 1319, 1568].forEach((f) => bar(f, 0.8, 0.13, 0.32)); // held C major chord
  });
}

export function sfxLose(): void {
  withPrio(3, () => {
    [784, 659, 523].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.18, delay: i * 0.22 }));
    tone(262, 0.7, { type: 'triangle', to: 196, gain: 0.18, delay: 0.66 });
  });
}

export function sfxStep(): void {
  if (!gate('step', 70)) return;
  noise(0.025, { filter: 'lowpass', freq: 900 * jit(), gain: 0.05 });
}
