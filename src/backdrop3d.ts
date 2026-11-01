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
const WIDTH = 16; // units outward from the board edge: past the screen edge on wide shots
const SX = 1, SY = 0.5; // lattice spacing: fine in y so a ledge is one short steep facet
// Rock face depth: the front-most point stays behind the shaft props (z -0.45) and crystals (-0.5)
const Z_FRONT = -0.62, Z_BACK = -2.2;
const Z_REF = -0.85;
// Desaturated slate in the backdrop's value band (block hues never appear here); the depth tint
// (CAVE_TINT) multiplies on top, as it did the painting
const ROCK = [new THREE.Color('#4d5a7e'), new THREE.Color('#58658a')];
const UNDER = new THREE.Color('#3b4668'); // overhangs, facing down
const SNOW = new THREE.Color('#b9c5dd');
const SNOW_UP = 0.5; // facet normal.y above this holds snow

// Strata of rock slabs: the segment is cut into horizontal bands 2-4.5 units tall, each band into
// slabs 2-4.5 units wide, and every slab sticks out by its own amount. Where a slab stands proud of
// the one above, the step between them faces up and holds snow (a ledge); where it sits back, the
// step faces down into shadow. Bands wrap at SEG, so a segment tiles with itself.
function wallGeometry(seed: number, side: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const q = (v: number, step: number) => Math.round(v / step) * step;
  const bounds = [0];
  while (SEG - bounds[bounds.length - 1] > 4.5) bounds.push(bounds[bounds.length - 1] + q(2 + rnd() * 2.5, SY));
  bounds.push(SEG);
  const bands = bounds.slice(0, -1).map(() => {
    const cuts = [0];
    while (cuts[cuts.length - 1] < WIDTH) cuts.push(cuts[cuts.length - 1] + q(2 + rnd() * 2.5, SX));
    return { cuts, out: cuts.map(() => rnd()), shade: cuts.map(() => (rnd() < 0.5 ? 0 : 1)) };
  });
  const bandAt = (dist: number) => {
    const d = ((dist % SEG) + SEG) % SEG;
    let k = 0;
    while (k < bands.length - 1 && d >= bounds[k + 1] - 1e-6) k++;
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
    const b = bandAt(dist);
    const out = b.out[slabAt(b.cuts, x)];
    const n = jit[(j % ny) * nx + i];
    // slabs further out sit a little further back, so the wall turns away from the board
    const t = THREE.MathUtils.clamp(0.08 + 0.62 * (1 - out) + 0.3 * (x / WIDTH) + n * 0.08, 0, 1);
    return new THREE.Vector3(side * (x + (i ? n * 0.18 : 0)), -dist, THREE.MathUtils.lerp(Z_FRONT, Z_BACK, t));
  };
  const verts: number[] = [], cols: number[] = [];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    if (n.z < 0) { [b, c] = [c, b]; n.negate(); } // face the camera (+z) on both sides
    n.normalize();
    const cx = Math.abs(a.x + b.x + c.x) / 3, cd = -(a.y + b.y + c.y) / 3;
    const band = bandAt(cd);
    const col = n.y > SNOW_UP ? SNOW : n.y < -SNOW_UP ? UNDER : ROCK[band.shade[slabAt(band.cuts, cx)]];
    for (const v of [a, b, c]) { verts.push(v.x, v.y, v.z); cols.push(col.r, col.g, col.b); }
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = pos(i, j), b = pos(i + 1, j), c = pos(i, j + 1), d = pos(i + 1, j + 1);
      if ((i + j) % 2) { tri(a, b, d); tri(a, d, c); } else { tri(a, b, c); tri(b, d, c); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals(); // unindexed: every triangle keeps its own normal, so facets stay flat
  return g;
}

export function addIceWalls(d: IceWallDeps) {
  const mat = new THREE.MeshToonMaterial({ gradientMap: d.ramp, vertexColors: true, fog: false });
  // ink only on the sharper creases, a touch thinner than the board's line (backdrop recedes)
  const inkMat = new LineMaterial({ color: new THREE.Color(d.ink).lerp(ROCK[0], 0.2).getHex(), linewidth: 1.6 });
  const copies: { group: THREE.Group; side: number; slot: number }[] = [];
  for (const side of [-1, 1]) {
    const geo = wallGeometry(side < 0 ? 7 : 19, side);
    const edges = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo, 30));
    for (let slot = 0; slot < 3; slot++) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geo, mat), new LineSegments2(edges, inkMat));
      d.scene.add(group);
      copies.push({ group, side, slot });
    }
  }
  return {
    /** tint per depth band (as the painted cliffs: CAVE_TINT) */
    material: mat,
    setResolution(w: number, h: number) { inkMat.resolution.set(w, h); },
    /** keep three segments per side around the camera; none above the shaft top */
    update(camY: number) {
      const base = Math.floor((d.shaftTop - camY) / SEG) - 1;
      for (const c of copies) {
        const k = base + c.slot;
        c.group.visible = k >= 0;
        if (k < 0) continue;
        // place as if the face sat at Z_REF (the inner column's depth), so the oblique shear does
        // not open a gap at the board rim; the relief still shears around it
        d.placeDeep(c.group, c.side < 0 ? d.edgeL : d.edgeR, d.shaftTop - k * SEG, Z_REF);
        c.group.position.z = 0;
      }
    },
  };
}
