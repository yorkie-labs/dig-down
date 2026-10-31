// Background props (on by default, ?props=0 turns them off): free low-poly props from polyfork.dev (GLB, commercial use, no
// attribution; files live in public/models/polyfork/) dressed in the style-A look: every
// material becomes the two-tone toon ramp in its own colour, plus an inverted-hull ink outline,
// so flat-shaded low poly reads like the gouache board instead of a separate 3D asset pack.
// Surface: spruces, a penguin with its sledge (joined by every friend rescued in the run: the
// flock), a log pile and cairn, plus a few camp extras. Shaft: one theme per 100m band set into
// the cliff faces (layout and pools in propsCatalog.ts), so depth gets landmarks.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SURFACE_EXTRAS, shaftLayout } from './propsCatalog';

export interface PropDeps {
  scene: THREE.Scene;
  ramp: THREE.Texture;
  ink: string;
  /** world y of the top of the shaft (the snowline under the hero's feet) */
  shaftTop: number;
  /** world y of a depth in metres */
  yOfDepth: (depth: number) => number;
  placeDeep: (o: THREE.Object3D, x: number, y: number, z: number) => void;
}

// Loaded from Polyfork's public CDN rather than shipped: its licence allows hotlinking the free
// models but not redistributing the files from our own site (public/models/polyfork/ stays local).
const DIR = 'https://polyfork.dev/cdn/';
const NIGHT = new THREE.Color('#aebfe2');
// What each 100m band shows (pools, landmarks, seeded layout) lives in propsCatalog.ts.
const SHAFT_BANDS = 15; // dressed down to 1500m (endless runs past that keep the painted cliffs)
// Cliff edges the xOffsets count out from. The board spans -0.5..8.5, but the right-hand props
// read a cell further out (as the old hand placement had them), so that edge is 9.5: our tuning.
const EDGE_L = -0.5, EDGE_R = 9.5;
// amber-lump-f3a85d is downloaded but left out: its translucent shell over an opaque core still
// renders as an ink blob under the toon conversion (needs a custom material if we keep it)

// Near-black palettes (basalt, obsidian) sink into the ink outline and the night tint, so the prop
// reads as a hole. Raise each vertex colour to a minimum brightness, keeping its hue. Geometry is
// shared by every clone of a file, so do it once.
const MIN_LUMA = 0.32; // our tuning: dark rock still reads darker than the cliff paint
function liftDark(geo: THREE.BufferGeometry) {
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!col || geo.userData.lifted) return;
  geo.userData.lifted = true;
  for (let i = 0; i < col.count; i++) {
    const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma >= MIN_LUMA) continue;
    const k = MIN_LUMA - luma; // add grey, so a black stays a dark slate rather than tinting
    col.setXYZ(i, Math.min(1, r + k), Math.min(1, g + k), Math.min(1, b + k));
  }
  col.needsUpdate = true;
}

// Convert a loaded model to the house style. Outline = back faces of a slightly inflated copy.
function inkify(root: THREE.Object3D, ramp: THREE.Texture, ink: string, outline: number) {
  const inkMat = new THREE.MeshBasicMaterial({ color: ink, side: THREE.BackSide, fog: false });
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const m of meshes) {
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    // moonlit: pull the daylight palette toward the night-blue scene so white snow isn't the
    // brightest thing on screen (the board blocks must stay the focus)
    const color = (src.color ?? new THREE.Color('#ffffff')).clone().multiply(NIGHT);
    // keep whatever carries the palette (vertex colours on most Polyfork files, a map on some),
    // and give normal-less meshes normals: without them toon lighting goes black (the amber lump)
    if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals();
    liftDark(m.geometry);
    m.material = new THREE.MeshToonMaterial({
      color, gradientMap: ramp, fog: false, side: THREE.DoubleSide,
      vertexColors: !!m.geometry.getAttribute('color'), map: src.map ?? null,
      transparent: src.transparent, opacity: src.opacity, depthWrite: !src.transparent,
    });
    if (src.transparent) continue; // a see-through shell (amber) gets no ink hull, or it reads as a solid blob
    // a rigged model (the penguin) needs a skinned hull bound to the same skeleton, or the
    // outline stays in bind pose somewhere else
    const sk = m as THREE.SkinnedMesh;
    const hull = sk.isSkinnedMesh ? new THREE.SkinnedMesh(m.geometry, inkMat) : new THREE.Mesh(m.geometry, inkMat);
    if (sk.isSkinnedMesh) (hull as unknown as THREE.SkinnedMesh).bind(sk.skeleton, sk.bindMatrix);
    hull.scale.setScalar(1 + outline);
    m.add(hull);
  }
}

// Scale a model so its largest side is `size` world units (1 unit = 1 cell) and rest it on y=0.
function fit(root: THREE.Object3D, size: number) {
  const box = new THREE.Box3().setFromObject(root);
  const dims = box.getSize(new THREE.Vector3());
  const s = size / Math.max(dims.x, dims.y, dims.z);
  root.scale.setScalar(s);
  // centre on x/z too: some files (the penguin) carry their rig root off-centre
  const c = box.getCenter(new THREE.Vector3());
  root.position.set(-c.x * s, -box.min.y * s, -c.z * s);
}


export interface Props {
  update(dt: number, viewY: number): void;
  /** a frozen friend was rescued; `count` = rescues so far this run (game event 'friend') */
  onFriend(count: number): void;
  /** the run ended: the flock cheers (won) or droops (lost) */
  celebrate(won: boolean): void;
  /** a new run: back to the single base penguin, once the last run's flock is out of view */
  reset(): void;
}

// Surface flock: slot 0 is the base penguin by the sledge; rescued friends fill the rest in order,
// alternating sides. Each waddles only inside [lo, hi] (centre x, our tuning). The base penguin
// keeps the strip between the board (8.5) and the right spruce (10.4) at the snowline z; the
// friends stand in a front row (z 0.3) before the camp on the left and the spruce/toboggan on the
// right, so none hides behind a tree. Neighbours sit >= PEN_W apart, so they never overlap (props3d.test.ts).
export const PEN_W = 0.72; // widest penguin (size 0.95) across its wings, world units
export const FLOCK_SLOTS: { x: number; z: number; lo: number; hi: number; home: number }[] = [
  { x: 9.4, z: -0.25, lo: 8.95, hi: 9.9, home: -0.5 }, // home yaw: face the board
  { x: -1.15, z: 0.3, lo: -1.2, hi: -1.1, home: 0.5 },
  { x: 10.4, z: 0.3, lo: 10.35, hi: 10.45, home: -0.5 },
  { x: -2.0, z: 0.3, lo: -2.05, hi: -1.95, home: 0.5 },
  { x: 11.25, z: 0.3, lo: 11.2, hi: 11.3, home: -0.5 },
  { x: -2.85, z: 0.3, lo: -2.9, hi: -2.8, home: 0.5 },
  { x: 12.1, z: 0.3, lo: 12.05, hi: 12.15, home: -0.5 },
  { x: -3.7, z: 0.3, lo: -3.75, hi: -3.65, home: 0.5 },
];
const RIGHT_NEIGHBOUR = 2; // the front-row slot beside the base penguin's strip
export const BASE_HI_FLOCKED = 9.6; // base penguin's right bound once slot 2 is taken
interface Pen {
  holder: THREE.Group; inner: THREE.Group; mixer: THREE.AnimationMixer;
  idle?: THREE.AnimationAction; walk?: THREE.AnimationAction;
  lw?: THREE.Object3D; rw?: THREE.Object3D; head?: THREE.Object3D; // rig bones for flap / droop
  ph: number; z: number; home: number; lo: number; hi: number;
  x: number; target: number; rest: number; facing: number;
  active: boolean; pop: number; // pop: seconds into the arrival hop, -1 = none
}
const PEN_Y_OFF = -0.05, PEN_SPEED = 0.55; // cells/s, our tuning
const POP_T = 0.45, LAND_T = 0.22, POP_HOP = 0.4, POP_GAP = 0.35; // arrival: hop, squash, stagger (s / cells), our tuning
const CHEER_T = 3, CHEER_HOP = 0.25, CHEER_HOPS = 1.8; // win: seconds, hop height, hops per second, our tuning
const DROOP_T = 2.2; // loss: seconds heads hang, our tuning
const FLAP = THREE.MathUtils.degToRad(40), FLAP_RATE = 18; // wing lift (the rig's range) and rad/s, our tuning
// Only props within this many world units of the camera are drawn: ~150 props x (mesh + ink
// hull) is a lot of draw calls for a phone, and the screen shows ~15 rows.
const DRAW_RANGE = 24;

export function addProps(d: PropDeps): Props {
  const loader = new GLTFLoader();
  const cache = new Map<string, Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] }>>();
  const load = (id: string) => {
    if (!cache.has(id)) cache.set(id, loader.loadAsync(`${DIR}${id}.glb`).then((g) => ({ scene: g.scene, clips: g.animations })));
    // plain clone() breaks skinned meshes
    return cache.get(id)!.then(({ scene, clips }) => ({ model: cloneSkinned(scene), clips }));
  };
  // seeded so the props sit in the same spots every run
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const placed: { holder: THREE.Group; y: number }[] = [];
  const place = (id: string, size: number, x: number, y: number, z: number, yaw: number, outline = 0.06, cull = true) =>
    load(id).then(({ model, clips }) => {
      inkify(model, d.ramp, d.ink, outline);
      const holder = new THREE.Group();
      const inner = new THREE.Group();
      inner.add(model);
      fit(model, size);
      inner.rotation.y = yaw;
      holder.add(inner);
      d.placeDeep(holder, x, y, z);
      d.scene.add(holder);
      if (cull) placed.push({ holder, y }); // the flock does its own visibility
      ((globalThis as any).__props ??= []).push({ id, holder }); // dev inspection
      return { holder, inner, model, clips };
    });
  const quiet = (p: Promise<unknown>) => p.catch(() => { /* a missing file only loses that prop */ });
  const PEN_Y = d.shaftTop + PEN_Y_OFF;

  // surface: spruces either side of the board, a penguin (the frozen friends are penguins)
  // waiting by its sledge, and a little camp on the left
  for (const [x, sz] of [[-2.2, 2.6], [-3.6, 1.9], [10.4, 2.3], [12.1, 2.9]] as [number, number][])
    quiet(place('snow-laden-spruce-36716e', sz, x, d.shaftTop - 0.05, -0.4, rnd() * Math.PI * 2));
  quiet(place('wooden-toboggan-940bbc', 0.9, 11.4, d.shaftTop - 0.05, -0.3, 1.2));
  quiet(place('snow-capped-log-pile-8719e7', 1.3, -1.4, d.shaftTop - 0.05, -0.3, 0.4));
  quiet(place('stone-cairn-a9bf48', 0.9, -3.0, d.shaftTop - 0.05, -0.35, 0));
  quiet(place('snow-fence-run-55a09a', 1.6, 13.4, d.shaftTop - 0.05, -0.45, -0.3));
  for (const e of SURFACE_EXTRAS) quiet(place(e.id, e.size, e.x, d.shaftTop - 0.05, e.z, e.yaw));

  // The flock: the base penguin idles by its sledge and now and then waddles to a new spot (its
  // file ships Idle/Walk clips); every friend rescued this run joins it on the snowfields. All
  // FLOCK_SLOTS clones load up front (hidden), so a rescue costs no allocation mid-run.
  const flock: (Pen | null)[] = FLOCK_SLOTS.map(() => null);
  let fseed = 11; // own seed: the shared rnd() must keep the spruces where they are
  const frnd = () => ((fseed = (fseed * 16807) % 2147483647) / 2147483647);
  FLOCK_SLOTS.forEach((sl, i) => {
    const size = i === 0 ? 0.9 : 0.8 + frnd() * 0.15; // slight size variety, our tuning
    const ph = frnd();
    quiet(place('penguin-base', size, sl.x, PEN_Y, sl.z, sl.home, 0.06, false).then(({ holder, inner, model, clips }) => {
      const mixer = new THREE.AnimationMixer(model);
      const clip = (n: string) => clips.find((c) => c.name === n);
      const idle = clip('Idle') && mixer.clipAction(clip('Idle')!);
      const walk = clip('Walk') && mixer.clipAction(clip('Walk')!);
      idle?.play();
      walk?.play();
      walk?.setEffectiveWeight(0);
      // de-sync the flock: each starts its idle loop at its own point and breathes at its own rate
      if (idle) { idle.time = ph * idle.getClip().duration; idle.timeScale = 0.85 + ph * 0.3; }
      holder.visible = false;
      flock[i] = {
        holder, inner, mixer, idle, walk, ph, z: sl.z, home: sl.home, lo: sl.lo, hi: sl.hi,
        lw: model.getObjectByName('LeftWing'), rw: model.getObjectByName('RightWing'), head: model.getObjectByName('Head'),
        x: sl.x, target: sl.x, rest: 1 + ph * 3, facing: sl.home, active: i === 0, pop: -1,
      };
    }));
  });
  let want = 0; // friends rescued this run (capped at the extra slots)
  let shown = 0; // extra penguins standing on the snow
  let popWait = 0; // stagger between arrivals seen on screen
  let cheer = 0, droop = 0; // seconds of win celebration / loss droop left (count down only while seen)
  let clock = 0;
  // reset() leaves the last run's flock (and its cheer / droop) standing: runs end deep, so the
  // retry or title screen at the surface is the only place they are ever seen. It clears once the
  // snowfield is off screen, or at the new run's first rescue.
  let stale = false;
  const clear = () => {
    stale = false;
    want = shown = 0;
    cheer = droop = popWait = 0;
    for (let i = 1; i < flock.length; i++) {
      const p = flock[i];
      if (p) { p.active = false; p.holder.visible = false; p.pop = -1; }
    }
    const b = flock[0];
    if (b) { b.hi = FLOCK_SLOTS[0].hi; b.pop = -1; }
  };

  const activate = (i: number, pop: boolean) => {
    const p = flock[i]!;
    p.active = true;
    p.pop = pop ? 0 : -1;
    p.x = p.target = (p.lo + p.hi) / 2;
    p.facing = p.inner.rotation.y = p.home;
    p.rest = 1 + p.ph * 3;
    shown = i;
    // a second penguin on the right strip: the base one keeps to the board side of it
    const b = flock[0];
    if (i === RIGHT_NEIGHBOUR && b) { b.hi = BASE_HI_FLOCKED; b.target = Math.min(b.target, b.hi); } // waddle back if past it
  };

  const step = (p: Pen, dt: number) => {
    const busy = p.pop >= 0 || cheer > 0 || droop > 0; // no wandering off mid-celebration
    if (busy) p.target = p.x;
    const moving = Math.abs(p.target - p.x) > 0.02;
    if (moving) {
      const stp = Math.sign(p.target - p.x) * Math.min(Math.abs(p.target - p.x), PEN_SPEED * dt);
      p.x += stp;
      p.facing = stp > 0 ? 1.2 : -1.2; // turn toward where it waddles (+x = screen right)
    } else if (!busy && (p.rest -= dt) <= 0) {
      p.target = p.lo + frnd() * (p.hi - p.lo);
      p.rest = 2.5 + frnd() * 4;
      if (Math.abs(p.target - p.x) < Math.min(0.25, (p.hi - p.lo) / 2)) p.target = p.x; // too short a hop: keep idling
    } else p.facing += ((cheer > 0 ? p.home * 0.3 : p.home) - p.facing) * Math.min(1, dt * 3); // settle back (cheer: face us)
    // cross-fade so the waddle starts and stops softly
    const w = p.walk?.getEffectiveWeight() ?? 0;
    const nw = w + ((moving ? 1 : 0) - w) * Math.min(1, dt * 8);
    p.walk?.setEffectiveWeight(nw);
    p.idle?.setEffectiveWeight(1 - nw);
    p.inner.rotation.y += (p.facing - p.inner.rotation.y) * Math.min(1, dt * 6);

    // arrival pop, cheer hops and the loss droop, layered as hop height / squash / flap / bow
    let hop = 0, sy = 1, grow = 1, flap = 0, bow = 0;
    if (p.pop >= 0) {
      p.pop += dt;
      const k = Math.min(1, p.pop / POP_T);
      const b = k - 1; // ease-out-back: grows past full size and settles
      grow = 1 + 2.7 * b * b * b + 1.7 * b * b;
      hop = Math.sin(Math.PI * k) * POP_HOP;
      flap = 1;
      const q = (p.pop - POP_T) / LAND_T;
      if (q > 0) sy = q < 1 ? 1 - 0.22 * Math.sin(Math.PI * q) : 1; // squash on touchdown
      if (q >= 1) p.pop = -1;
    }
    if (cheer > 0) {
      const env = Math.min(1, cheer / 0.4); // fade out over the last 0.4s
      const s = Math.abs(Math.sin(Math.PI * (clock * CHEER_HOPS + p.ph)));
      hop += CHEER_HOP * s * env;
      sy *= 1 + env * (0.08 * s - 0.14 * (1 - s) ** 8); // stretch in the air, squash at each landing
      flap = Math.max(flap, env);
    }
    if (droop > 0) bow = Math.min(1, droop / 0.5, (DROOP_T - droop) / 0.3);
    const side = grow / Math.sqrt(sy); // keep the volume while squashing
    p.inner.scale.set(side, grow * sy, side);
    d.placeDeep(p.holder, p.x, PEN_Y + hop, p.z);

    p.mixer.update(dt);
    // the clips rewrite every bone each update, so these rotate on top of this frame's pose
    // (+z lifts LeftWing, -z RightWing; +x tips the Head forward)
    if (flap > 0 || bow > 0) {
      const a = flap * FLAP * (0.5 + 0.5 * Math.sin(clock * FLAP_RATE + p.ph * 6)) - bow * 0.15;
      p.lw?.rotateZ(a);
      p.rw?.rotateZ(-a);
      p.head?.rotateX(bow * 0.55);
    }
  };

  // shaft: props set into the cliff faces (z just in front of their plane), plus one landmark
  // per band. Mirroring by scale.x = -1 is safe for the ink hull: three flips the front face for a
  // negative-determinant world matrix, so the BackSide hull still shows its outer rim.
  for (const sp of shaftLayout(7, SHAFT_BANDS)) {
    const x = sp.side < 0 ? EDGE_L - sp.xOffset : EDGE_R + sp.xOffset;
    quiet(place(sp.id, sp.size, x, d.yOfDepth(sp.depth), sp.landmark ? -0.5 : -0.45, sp.yaw).then(({ inner }) => {
      inner.rotation.z = sp.tilt;
      if (sp.mirror) inner.scale.x = -1;
    }));
  }

  return {
    update(dt: number, viewY: number) {
      for (let i = 0; i < placed.length; i++) placed[i].holder.visible = Math.abs(placed[i].y - viewY) < DRAW_RANGE;
      const near = Math.abs(d.shaftTop - viewY) < DRAW_RANGE;
      if (stale && !near) clear();
      // rescues made deep are simply there when the surface comes back into view; one made with
      // the surface on screen pops in (one at a time)
      while (shown < want && flock[shown + 1] && !near) activate(shown + 1, false);
      if (near && shown < want && flock[shown + 1] && (popWait -= dt) <= 0) { activate(shown + 1, true); popWait = POP_GAP; }
      for (let i = 0; i < flock.length; i++) {
        const p = flock[i];
        if (p) p.holder.visible = p.active && near;
      }
      if (!near) return; // unseen: no mixers, and a celebration waits until the snowfield is on screen
      clock += dt;
      for (let i = 0; i < flock.length; i++) {
        const p = flock[i];
        if (p?.active) step(p, dt);
      }
      cheer = Math.max(0, cheer - dt);
      droop = Math.max(0, droop - dt);
    },
    onFriend(count: number) {
      if (stale) clear();
      want = Math.min(count, FLOCK_SLOTS.length - 1);
    },
    celebrate(won: boolean) {
      cheer = won ? CHEER_T : 0;
      droop = won ? 0 : DROOP_T;
    },
    reset() { stale = true; },
  };
}
