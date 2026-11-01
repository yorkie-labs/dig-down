// Prototype (?bg=3d): the shaft walls as low-poly 3D ice rock instead of the painted cliff tiles,
// in the same language as the Polyfork props: flat-shaded facets on the shared two-tone toon ramp,
// snow on the facets that face up, and inked creases at a constant screen width.
// One segment geometry per side, SEG units tall and periodic in y, leapfrogged down the shaft by
// the camera (3 copies per side), so the walls cost a few draw calls at any depth.
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

export interface IceWallDeps {
  scene: THREE.Scene;
  ramp: THREE.Texture;
  ink: string;
  /** world y of the shaft top (walls start here and go down) */
  shaftTop: number;
  /** x of the board's left and right outer edges (walls grow outward from them) */
  edgeL: number;
  edgeR: number;
  placeDeep: (o: THREE.Object3D, x: number, y: number, z: number) => void;
}

const SEG = 24; // world units per segment (= rows), our tuning
const WIDTH = 16; // units across a wall: past the screen edge on wide shots
const SX = 1, SY = 0.5; // lattice spacing: fine in y so a ledge is one short steep facet
const SNOW_UP = 0.5; // facet normal.y above this holds snow

// A wall's look. The side walls sit in the backdrop's value band (desaturated slate, block hues
// never appear); the far wall, seen only through holes in the board, is darker and further back.
// The depth tint (CAVE_TINT) multiplies on top of both, as it did the painting.
interface WallStyle {
  zFront: number; zBack: number;
  /** depth the copies are placed at, so the oblique shear lines the wall up with the board */
  zRef: number;
  rock: THREE.Color[]; under: THREE.Color; snow: THREE.Color;
  /** some slabs are clear blue ice instead of rock */
  ice: THREE.Color; iceShare: number;
  /** icicles hang under overhangs (null: none, e.g. the far wall) */
  icicle: THREE.Color | null;
  ink: number; inkWidth: number;
}
// side walls: the front-most point stays behind the shaft props (z -0.45) and crystals (-0.5)
const SIDE: Omit<WallStyle, 'ink'> = {
  zFront: -0.62, zBack: -2.2, zRef: -0.85, inkWidth: 1.6,
  rock: [new THREE.Color('#4d5a7e'), new THREE.Color('#58658a')],
  under: new THREE.Color('#3b4668'), snow: new THREE.Color('#b9c5dd'),
  ice: new THREE.Color('#6f93c9'), iceShare: 0.18, icicle: new THREE.Color('#cfe2f6'),
};
const FAR: Omit<WallStyle, 'ink'> = {
  zFront: -5, zBack: -7, zRef: -5.6, inkWidth: 1.1,
  rock: [new THREE.Color('#2a3563'), new THREE.Color('#303c6c')],
  under: new THREE.Color('#1f2850'), snow: new THREE.Color('#5d6b98'),
  ice: new THREE.Color('#34477d'), iceShare: 0.12, icicle: null,
};
// Painted form light: facets are banded by how squarely they face the key light (upper left,
// in front, like the sun), in three cel steps, on top of the toon ramp. Recessed rock darkens.
const KEY = new THREE.Vector3(-0.45, 0.6, 0.66).normalize();
const cel = (n: THREE.Vector3) => { const d = n.dot(KEY); return d > 0.82 ? 1.06 : d > 0.55 ? 0.9 : 0.72; };

// Strata of rock slabs: the segment is cut into horizontal bands 1.5-5.5 units tall, each band
// into slabs 1.5-6 units wide, and every slab sticks out by its own amount. Where a slab stands
// proud of the one above, the step between them faces up and holds snow (a ledge); where it sits
// back, the step faces down into shadow. The band lines wander up and down across the wall so
// ledges break and tilt instead of running ruler-straight. Bands wrap at SEG: a segment tiles.
function wallGeometry(seed: number, side: number, st: WallStyle) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const q = (v: number, step: number) => Math.round(v / step) * step;
  const bounds = [0];
  while (SEG - bounds[bounds.length - 1] > 5.5) bounds.push(bounds[bounds.length - 1] + q(1.5 + rnd() * 4, SY));
  bounds.push(SEG);
  const bands = bounds.slice(0, -1).map(() => {
    const cuts = [0];
    while (cuts[cuts.length - 1] < WIDTH) cuts.push(cuts[cuts.length - 1] + q(1.5 + rnd() * 4.5, SX));
    return {
      cuts, out: cuts.map(() => rnd()), shade: cuts.map(() => (rnd() < 0.5 ? 0 : 1)),
      // each slab face leans its own way (depth per unit across / down), so faces catch the light
      // differently instead of all reading as one flat plane
      tiltX: cuts.map(() => (rnd() - 0.5) * 0.5), tiltY: cuts.map(() => (rnd() - 0.5) * 0.4),
      ice: cuts.map(() => rnd() < st.iceShare),
    };
  });
  // band-line wander: piecewise linear in x, knots every 2 units, up to ±0.75 units
  const knots = Array.from({ length: Math.ceil(WIDTH / 2) + 2 }, () => (rnd() - 0.5) * 1.5);
  const wander = (x: number) => {
    const k = Math.min(knots.length - 2, Math.floor(x / 2)), f = x / 2 - k;
    return knots[k] * (1 - f) + knots[k + 1] * f;
  };
  let bandTop = 0, bandH = 1; // of the last bandAt lookup: where in its band a point sits
  const bandAt = (dist: number, x: number) => {
    const d = ((((dist + wander(x)) % SEG) + SEG) % SEG);
    let k = 0;
    while (k < bands.length - 1 && d >= bounds[k + 1] - 1e-6) k++;
    bandTop = d - bounds[k];
    bandH = bounds[k + 1] - bounds[k];
    return bands[k];
  };
  const slabAt = (cuts: number[], x: number) => {
    let c = 0;
    while (c < cuts.length - 1 && x >= cuts[c + 1] - 1e-6) c++;
    return c;
  };
  const nx = Math.ceil(WIDTH / SX) + 1;
  const ny = Math.round(SEG / SY);
  const jit: number[] = [];
  for (let i = 0; i < nx * ny; i++) jit.push(rnd() - 0.5);
  const pos = (i: number, j: number) => {
    const x = i * SX, dist = j * SY;
    const b = bandAt(dist, x);
    const c = slabAt(b.cuts, x);
    const out = b.out[c];
    const n = jit[(j % ny) * nx + i];
    const across = (x - b.cuts[c]) / Math.max(1, (b.cuts[c + 1] ?? WIDTH) - b.cuts[c]) - 0.5; // -0.5..0.5
    const down = bandTop / bandH - 0.5;
    // slabs further out sit a little further back, so the wall turns away from the board
    const t = THREE.MathUtils.clamp(0.1 + 0.55 * (1 - out) + 0.3 * (x / WIDTH) + b.tiltX[c] * across + b.tiltY[c] * down + n * 0.06, 0, 1);
    return new THREE.Vector3(side * (x + (i ? n * 0.18 : 0)), -dist, THREE.MathUtils.lerp(st.zFront, st.zBack, t));
  };
  const verts: number[] = [], cols: number[] = [];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    if (n.z < 0) { [b, c] = [c, b]; n.negate(); } // face the camera (+z) on both sides
    n.normalize();
    const cx = Math.abs(a.x + b.x + c.x) / 3, cd = -(a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
    const band = bandAt(cd, cx);
    const slab = slabAt(band.cuts, cx);
    const base = n.y > SNOW_UP ? st.snow : n.y < -SNOW_UP ? st.under : band.ice[slab] ? st.ice : st.rock[band.shade[slab]];
    const recess = THREE.MathUtils.clamp((st.zFront - cz) / (st.zFront - st.zBack), 0, 1);
    col.copy(base).multiplyScalar(cel(n) * (1 - 0.28 * recess));
    for (const v of [a, b, c]) { verts.push(v.x, v.y, v.z); cols.push(col.r, col.g, col.b); }
    // an icicle under some overhangs, hung from the facet's lower edge, in front of the rock
    if (st.icicle && n.y < -SNOW_UP && rnd() < 0.35) {
      const lowY = Math.min(a.y, b.y, c.y), w = 0.12 + rnd() * 0.1, len = 0.35 + rnd() * 0.5;
      const x0 = (a.x + b.x + c.x) / 3, z0 = Math.max(a.z, b.z, c.z) + 0.04;
      icicles.push([x0, lowY, z0, w, len]);
    }
  };
  const col = new THREE.Color();
  const icicles: [number, number, number, number, number][] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = pos(i, j), b = pos(i + 1, j), c = pos(i, j + 1), d = pos(i + 1, j + 1);
      if ((i + j) % 2) { tri(a, b, d); tri(a, d, c); } else { tri(a, b, c); tri(b, d, c); }
    }
  }
  // icicle: two facets meeting at a ridge that stands forward (wound to face the camera); the
  // left one, toward the key light, is the lit side
  for (const [x, y, z, w, len] of icicles) {
    const L = [x - w, y, z], R = [x + w, y, z], top = [x, y, z + w * 0.8], tip = [x + (rnd() - 0.5) * 0.06, y - len, z + 0.02];
    const ic = st.icicle!;
    for (const [p, k] of [[L, 1.06], [tip, 1.06], [top, 1.06], [top, 0.82], [tip, 0.82], [R, 0.82]] as [number[], number][]) {
      verts.push(p[0], p[1], p[2]);
      cols.push(ic.r * k, ic.g * k, ic.b * k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals(); // unindexed: every triangle keeps its own normal, so facets stay flat
  return g;
}

export function addIceWalls(d: IceWallDeps) {
  const inkOn = (st: Omit<WallStyle, 'ink'>, k: number): WallStyle => ({ ...st, ink: new THREE.Color(d.ink).lerp(st.rock[0], k).getHex() });
  // side walls either side of the board, and one far wall across behind it (seen through holes)
  const walls = [
    { st: inkOn(SIDE, 0.2), side: -1, x: d.edgeL, seed: 7 },
    { st: inkOn(SIDE, 0.2), side: 1, x: d.edgeR, seed: 19 },
    { st: inkOn(FAR, 0.5), side: 1, x: d.edgeL - 3, seed: 31 },
  ];
  const mats: THREE.MeshToonMaterial[] = [];
  const inks: LineMaterial[] = [];
  const copies: { group: THREE.Group; x: number; zRef: number; slot: number }[] = [];
  for (const w of walls) {
    const geo = wallGeometry(w.seed, w.side, w.st);
    // ink only on the sharper creases, thinner than the board's line (the backdrop recedes)
    const edges = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo, 30));
    const mat = new THREE.MeshToonMaterial({ gradientMap: d.ramp, vertexColors: true, fog: false });
    const ink = new LineMaterial({ color: w.st.ink, linewidth: w.st.inkWidth });
    mats.push(mat);
    inks.push(ink);
    for (let slot = 0; slot < 3; slot++) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geo, mat), new LineSegments2(edges, ink));
      d.scene.add(group);
      copies.push({ group, x: w.x, zRef: w.st.zRef, slot });
    }
  }
  return {
    /** tinted per depth band (as the painted cliffs: CAVE_TINT) */
    materials: mats,
    setResolution(w: number, h: number) { for (const ink of inks) ink.resolution.set(w, h); },
    /** keep three segments per wall around the camera; none above the shaft top */
    update(camY: number) {
      const base = Math.floor((d.shaftTop - camY) / SEG) - 1;
      for (const c of copies) {
        const k = base + c.slot;
        c.group.visible = k >= 0;
        if (k < 0) continue;
        // place as if the face sat at zRef, so the oblique shear does not open a gap at the board
        // rim; the relief still shears around it
        d.placeDeep(c.group, c.x, d.shaftTop - k * SEG, c.zRef);
        c.group.position.z = 0;
      }
    },
  };
}
