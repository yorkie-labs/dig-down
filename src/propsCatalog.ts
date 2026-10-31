// Which background prop goes where in the shaft, as pure data + a seeded layout, so props3d.ts only
// loads and dresses models. Every id is a free polyfork.dev GLB in public/models/polyfork/.
// Bands are 100m each. The first seven keep the original geology walk (topsoil → fossils → bones →
// crystals → obsidian → lava → fumaroles); 700-1500m adds its own strata so an endless run keeps
// finding somewhere new instead of cycling back to the fossil bed.

export interface BandTheme {
  name: string;
  /** ids for the ordinary cliff props (≥4, so the twice-per-band cap can always fill 8 slots) */
  pool: string[];
  /** the one big piece at the band's start */
  landmark: string;
}

export const BAND_THEMES: BandTheme[] = [
  { name: 'rocky topsoil', landmark: 'frozen-waterfall-5d1fc6',
    pool: ['basalt-boulder-a1929c', 'petrified-log-413693', 'boulder-field-cluster-08e364', 'root-intrusion-9f1eaa'] },
  { name: 'fossil bed', landmark: 'dinosaur-skull-4c3a3c',
    pool: ['dinosaur-skull-4c3a3c', 'fossil-ribcage-b243c5', 'hatching-egg-ff3379', 'petrified-log-413693'] },
  { name: 'bone layer', landmark: 'dinosaur-bone-pile-3c285a',
    pool: ['dinosaur-bone-pile-3c285a', 'fossil-ribcage-b243c5', 'bone-scatter-90313d', 'petrified-log-413693'] },
  { name: 'crystal caves', landmark: 'mineral-geode-cluster-299927',
    pool: ['crystal-cluster-624138', 'mineral-geode-cluster-299927', 'ice-chunk-b23ad7', 'glowing-rune-stone-5a5558'] },
  { name: 'obsidian', landmark: 'obsidian-shard-cluster-c8f5d3',
    pool: ['obsidian-shard-cluster-c8f5d3', 'crystal-cluster-624138', 'volcanic-boulder-cluster-7e29ea', 'basalt-boulder-a1929c'] },
  { name: 'lava rock', landmark: 'lava-rock-pile-d56d19',
    pool: ['lava-rock-pile-d56d19', 'obsidian-shard-cluster-c8f5d3', 'volcanic-boulder-cluster-7e29ea', 'basalt-boulder-a1929c'] },
  { name: 'fumaroles', landmark: 'fumarole-vent-8280ba',
    pool: ['fumarole-vent-8280ba', 'lava-rock-pile-d56d19', 'volcanic-boulder-cluster-7e29ea', 'obsidian-shard-cluster-c8f5d3'] },
  // endless strata (700-1500m)
  { name: 'frozen mine', landmark: 'mine-cart-21d7f0',
    pool: ['ore-barrow-3e2464', 'timber-crate-ba0739', 'root-intrusion-9f1eaa', 'basalt-boulder-a1929c', 'ice-chunk-b23ad7'] },
  { name: 'mushroom grotto', landmark: 'bracket-fungus-log-2deef4',
    pool: ['giant-mushroom-cluster-868de6', 'mushroom-cluster-18dc1d', 'root-intrusion-9f1eaa', 'petrified-log-413693'] },
  { name: 'ancient ice', landmark: 'frozen-waterfall-5d1fc6',
    pool: ['ice-chunk-b23ad7', 'boulder-field-cluster-08e364', 'glowing-rune-stone-5a5558', 'crystal-cluster-624138'] },
  { name: 'rune vault', landmark: 'stone-cairn-a9bf48',
    pool: ['glowing-rune-stone-5a5558', 'bone-scatter-90313d', 'root-intrusion-9f1eaa', 'timber-crate-ba0739'] },
  { name: 'giants\' graveyard', landmark: 'fossil-ribcage-b243c5',
    pool: ['dinosaur-skull-4c3a3c', 'dinosaur-bone-pile-3c285a', 'hatching-egg-ff3379', 'bone-scatter-90313d', 'fossil-ribcage-b243c5'] },
  { name: 'geode vault', landmark: 'crystal-cluster-624138',
    pool: ['mineral-geode-cluster-299927', 'crystal-cluster-624138', 'obsidian-shard-cluster-c8f5d3', 'ice-chunk-b23ad7'] },
  { name: 'hot mine', landmark: 'mine-cart-21d7f0',
    pool: ['ore-barrow-3e2464', 'timber-crate-ba0739', 'lava-rock-pile-d56d19', 'volcanic-boulder-cluster-7e29ea'] },
  { name: 'the core', landmark: 'fumarole-vent-8280ba',
    pool: ['fumarole-vent-8280ba', 'obsidian-shard-cluster-c8f5d3', 'lava-rock-pile-d56d19', 'crystal-cluster-624138', 'mineral-geode-cluster-299927'] },
];

/** Theme for a band; past the list (deeper than 1500m) it cycles again from the fossil bed. */
export function bandTheme(band: number): BandTheme {
  const n = BAND_THEMES.length;
  return BAND_THEMES[band < n ? band : 1 + ((band - 1) % (n - 1))];
}

export interface PropSpot {
  id: string;
  /** metres below the surface */
  depth: number;
  side: -1 | 1;
  /** cells outward from the cliff edge, 0.8-1.6 */
  xOffset: number;
  /** largest side in cells */
  size: number;
  yaw: number;
  /** small roll, radians */
  tilt: number;
  /** flip on x (scale.x = -1), a cheap second variant of the same file */
  mirror: boolean;
  landmark: boolean;
}

const PROPS_PER_BAND = 8; // ~1.2 per screen per side (6 read as sparse in review)
const MAX_PER_BAND = 2; // no id more than twice per band among the ordinary props (the landmark is extra)
const BASE_SIZE = 1.55; // cells, our tuning (was 1.3-1.8)
// Long or flat files whose largest side is not what reads on screen, so they'd shrink to a sliver.
const SIZE_MUL: Record<string, number> = {
  'bone-scatter-90313d': 1.15, // a flat floor scatter
  'petrified-log-413693': 1.15,
  'ore-barrow-3e2464': 1.1, // 1.5m long, 0.5m wide
};
const CLEAR_TOP = 6; // metres: the hero's start rows stay unframed

/**
 * Deterministic cliff dressing for `bands` 100m bands: one landmark at each band start
 * (alternating sides) plus ~8 props, sorted by depth. Same seed → same layout.
 */
export function shaftLayout(seed: number, bands: number): PropSpot[] {
  // Park-Miller, as in props3d.ts; folded so 0 and negatives still give a valid state
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const out: PropSpot[] = [];
  const last: Record<number, string> = {}; // last id per side, across band edges too
  for (let band = 0; band < bands; band++) {
    const theme = bandTheme(band);
    const lmSide: -1 | 1 = band % 2 ? 1 : -1;
    // band 0: just below the surface but past the clear rows
    const lmDepth = Math.max(CLEAR_TOP + 0.5, band * 100 + 4 + 2.8);
    out.push({
      id: theme.landmark, depth: lmDepth, side: lmSide, xOffset: 1.5,
      size: 2.6 + rnd() * 0.6, yaw: lmSide * 0.5 + (rnd() - 0.5) * 0.3, tilt: 0, mirror: rnd() < 0.5, landmark: true,
    });
    last[lmSide] = theme.landmark;

    const sides = Array.from({ length: PROPS_PER_BAND }, (_, k): -1 | 1 => ((k + band) % 2 ? 1 : -1));
    const ids = pickIds(theme.pool, sides, { ...last }, rnd);
    for (let k = 0; k < PROPS_PER_BAND; k++) {
      const side = sides[k], id = ids[k];
      last[side] = id;
      out.push({
        id, side,
        depth: band * 100 + 14 + k * (84 / PROPS_PER_BAND) + rnd() * 5,
        xOffset: 0.8 + rnd() * 0.8,
        size: BASE_SIZE * (SIZE_MUL[id] ?? 1) * (0.8 + rnd() * 0.4),
        // face the board a little, with a wide spread so repeats don't line up
        yaw: side * 0.6 + (rnd() - 0.5) * 1.6,
        tilt: rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) * (0.05 + rnd() * 0.13) : 0,
        mirror: rnd() < 0.5,
        landmark: false,
      });
    }
  }
  return out.sort((a, b) => a.depth - b.depth);
}

// Fill the slots in order: never the id last used on that side, at most MAX_PER_BAND each.
// Seeded shuffle per slot + backtracking, so a valid fill is always found (pools have ≥4 ids).
function pickIds(pool: string[], sides: (-1 | 1)[], last: Record<number, string>, rnd: () => number): string[] {
  const used = new Map<string, number>();
  const picked: string[] = [];
  const orders = sides.map(() => shuffle([...pool], rnd));
  const fill = (k: number): boolean => {
    if (k === sides.length) return true;
    const side = sides[k];
    const prev = last[side];
    for (const id of orders[k]) {
      if (id === prev || (used.get(id) ?? 0) >= MAX_PER_BAND) continue;
      used.set(id, (used.get(id) ?? 0) + 1);
      last[side] = id;
      picked.push(id);
      if (fill(k + 1)) return true;
      picked.pop();
      last[side] = prev;
      used.set(id, used.get(id)! - 1);
    }
    return false;
  };
  if (!fill(0)) throw new Error(`prop pool too small: ${pool.join(',')}`);
  return picked;
}

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface SurfaceExtra { id: string; x: number; size: number; yaw: number; z: number }
// Extra surface camp dressing, kept off the board (x -0.5..8.5) and the penguin's lane (8.9..9.9).
// y is the snowline (shaftTop - 0.05, like the other surface props); z behind the board plane.
export const SURFACE_EXTRAS: SurfaceExtra[] = [
  { id: 'trail-signpost-bd29a7', x: -4.6, size: 1.5, yaw: 0.5, z: -0.5 }, // "this way down"
  { id: 'frozen-water-trough-61c835', x: -5.8, size: 1.2, yaw: 1.3, z: -0.6 },
  { id: 'probe-and-shovel-set-06d115', x: 14.6, size: 1.0, yaw: -0.4, z: -0.4 }, // a dig crew's kit
  { id: 'piste-marker-pole-7480c3', x: 15.6, size: 1.5, yaw: 0, z: -0.5 },
];
