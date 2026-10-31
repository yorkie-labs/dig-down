// SPIKE: 3D renderer for the same game logic, in style A "Ink & Gouache Storybook"
// (tasks/20261028-style-a-todo.md): flat gouache blocks with one constant ink line around each
// chunk, a painted ice-cave backdrop with parallax cliffs and icicles, and a flat 2D hero.
// Input/HUD code is copied from main.ts on purpose (spike, not shared yet).
import './style.css'; // legacy base + design tokens
import './game3d.css'; // the 3D page's styles: after style.css, so they override it
import * as THREE from 'three';
import './loading'; // first: hooks the loading manager before any texture starts loading
import { startVersionCheck } from './version';
import { addProps } from './props3d';
import {
  Badge, BADGES, Cosmetic, COSMETICS, cosmeticForBadge, CosmeticSlot, dailyHistory, dailyOf, dailyRecord, dailyShareText, equippedCosmetics,
  isUnlocked, LiveStats, loadProgress, Medal, medalMetric, medalStars, maxStars, nextStageAfter, Progress, recordRun, RunResult, saveProgress,
  silverGap, StageRecord, statsOf, toggleCosmetic, totalStars, unlockedCosmetics,
} from './progress';
import { dailyKey, dailyStage, isDailyId, isDryLevel, ruleOf, STAGES, StageInfo, stageById, stageDepth } from './stages';
import {
  AIR_CAPSULE, AIR_MAX, AIR_WARNING, CAPSULE, levelTempo, levelAirTempo, levelProgress, AIR_START, AIR_END, Cell, cellAt, CLEAR, CLOCK, ensureRows, FRIEND, levelIn, THAW, XBLOCK_HP, createGame, depthOf, depthOfRow, Dir,
  COMBO_WINDOW, drill, DrillResult, Game, GameEvent, GOAL_DEPTH, keyPieceBelow, ROWS, levelOfDepth, move, SKY_ROWS, update, XBLOCK,
} from './game';
import {
  initSfx, isMuted, sfxBreak, sfxCapsule, sfxClearRow, sfxClock, sfxCombo, sfxCrush, sfxDangerTick, sfxFriend, sfxHammer, sfxHeartbeat,
  sfxLand, sfxLevelUp, sfxLose, sfxPop, sfxShield, sfxStep, sfxSuffocate, sfxWhiff, sfxWin, sfxWobbleTick, sfxXBreak,
  sfxXChip, toggleMuted, unlockSfx,
  musicStop, musicTick,
} from './sfx';

// Storybook palettes per level: four saturated gouache hues with separated values, so chunks
// stay readable; all mood lives in the backdrop, never on the 9 playable columns.
const PALETTES = [
  ['#e2578c', '#edc750', '#40b5ae', '#3799ed'], // sampled from the style-A mockup
  ['#f2667f', '#f7b844', '#36c2b4', '#5b86f0'],
  ['#e8567a', '#efd250', '#4cc98c', '#7a7cf0'],
  ['#f05a72', '#f4cf63', '#2fbfc8', '#5f8cf5'],
  ['#ef6a98', '#f7dc6a', '#47d1b0', '#8f7cf2'],
];
const INK = '#2b2a4a'; // warm navy (review: #1b2238 read near-black); the UI's --ink in style.css matches
const XBLOCK_COLOR = '#46557a'; // frozen rock
const CLEAR_COLOR = '#9ff7ff'; // aurora ice
const THAW_COLOR = '#bfe3f6'; // thin ice: pale, cooler than any block hue
// Backdrop tint per level: the painted cave darkens and cools as you descend.
// Stronger per-level shift so depth reads: surface ice → glacier blue → violet → deep indigo.
const CAVE_TINT = ['#ffffff', '#bcd0ff', '#a9a6f2', '#8a86d8', '#6a68b6'];
// Oblique view (see applyOblique): screen shift per unit of depth toward the camera.
const OBLIQUE = { x: -0.14, y: 0.2 };
// Place a layer at depth z so that, after the oblique shear, it appears at (x, y).
const placeDeep = (o: THREE.Object3D, x: number, y: number, z: number) =>
  o.position.set(x - OBLIQUE.x * z, y - OBLIQUE.y * z, z);
const VIEW_ROWS = 15; // the mockup shows ~15 rows
const WINDOW_ROWS = 22; // rows above/below the camera that get instances
// A narrow lens pulled far back is nearly orthographic: no side faces on the outer columns and
// no vanishing point fighting the flat sprite, but depth layers still get natural parallax.
const FOV = 14;

const levelOfRow = (y: number) => levelOfDepth(depthOfRow(y)) - 1;
// Mood tables (tints, glows) have 5 depth bands; longer stages (Aurora: 7 levels) stay in the last.
const moodBand = () => Math.min(4, game.level - 1);
const colorOf = (color: number, y: number) =>
  color === XBLOCK ? XBLOCK_COLOR : color === CAPSULE || color === FRIEND ? '#e8fbff' : color === CLEAR ? CLEAR_COLOR
    : color === THAW ? THAW_COLOR
    : PALETTES[levelOfRow(y)][color];

// ---- three setup ----
const canvas = document.getElementById('game') as HTMLCanvasElement;
const fx = document.getElementById('fx') as HTMLCanvasElement;
const fxCtx = fx.getContext('2d')!;
// canvas text outlines: round joins, or sharp glyph corners (ㅅ ㅈ ㄱ, V, ×) grow miter spikes
const resetFxText = () => { fxCtx.lineJoin = 'round'; fxCtx.miterLimit = 2; };
resetFxText();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
// Flat storybook shading: no shadow maps (the hero gets a blob shadow), and Neutral tone mapping
// so the gouache block colors keep their hue instead of ACES' desaturated shift.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#163d7a');
scene.fog = new THREE.Fog('#0b1a3d', 60, 120); // only reaches the backdrop layers
const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 400);

// two-tone gouache ramp: one shadow tone, one lit tone
const ramp = new THREE.DataTexture(new Uint8Array([175, 255]), 2, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;
const toon = (color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

const hemi = new THREE.HemisphereLight('#d8ecff', '#2a3d6e', 1.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#f2f8ff', 2.6);
scene.add(sun, sun.target);
const headlamp = new THREE.PointLight('#ffd28a', 2, 5, 1.6);
scene.add(headlamp);

// world: column x -> x, row y -> -y
const wx = (x: number) => x;
const wy = (y: number) => -y;

// ---- painted backdrop (style A) ----
// Everything behind and beside the 9 columns is drawn into canvas textures in the same ink and
// gouache rules as the blocks, at three depths so it parallaxes as the camera descends.
const shaftH = 6000; // tall enough for Aurora's 700m and long endless runs
const shaftTop = wy(SKY_ROWS - 0.5);
const shaftMidY = shaftTop - shaftH / 2;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Code-drawn textures are supersampled: draw callbacks keep their logical w×h coordinates, the
// canvas holds k× the pixels. At 1× the ink outlines (mountains, pines) showed stair-steps on
// Retina screens, where the game canvas already renders at 2×. k is capped so no side passes
// 4096px and no texture passes ~4.2M px (16MB) — phone GPU memory — and stays 2 on 1× screens.
// Soft layers (gradients, washes) pass superMax 2: extra pixels buy nothing there.
const TEX_SUPER = (window.devicePixelRatio || 1) < 1.5 ? 2 : matchMedia('(pointer: coarse)').matches ? 3 : 4; // phones: GPU memory
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeatY = 1, superMax = TEX_SUPER) {
  const c = document.createElement('canvas');
  const k = Math.max(1, Math.min(superMax, Math.floor(4096 / Math.max(w, h)), Math.floor(Math.sqrt(4.2e6 / (w * h)))));
  c.width = w * k;
  c.height = h * k;
  const g = c.getContext('2d')!;
  g.scale(k, k);
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, repeatY);
  t.anisotropy = 4;
  return t;
}

// Far layer: the painted aurora night seen through the holes in the board — mid-blue brush
// strokes with green aurora streaks, lighter than before to match the mockup's value.
const farTex = canvasTex(512, 512, (g) => {
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#22579f');
  grad.addColorStop(0.5, '#1b4b91');
  grad.addColorStop(1, '#22579f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // brushy vertical strokes
  for (let k = 0; k < 260; k++) {
    const x = rnd() * 512, y = rnd() * 512, len = 30 + rnd() * 90;
    g.strokeStyle = `rgba(${90 + rnd() * 80},${150 + rnd() * 80},255,${0.06 + rnd() * 0.08})`;
    g.lineWidth = 4 + rnd() * 10;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 20, (y + len) % 512);
    g.stroke();
  }
  // aurora streaks
  for (let k = 0; k < 40; k++) {
    const x = 60 + rnd() * 390, y = rnd() * 512;
    g.strokeStyle = `rgba(${60 + rnd() * 60},${220 + rnd() * 35},${170 + rnd() * 60},${0.08 + rnd() * 0.1})`;
    g.lineWidth = 6 + rnd() * 16;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 30, y + 60 + rnd() * 120);
    g.stroke();
  }
  for (let k = 0; k < 40; k++) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
}, shaftH / 14, 2); // soft wash: 2× is plenty
// square texels: the 512px tile spans 14 units both ways (it was stretched 1.8x horizontally)
farTex.wrapS = THREE.RepeatWrapping;
farTex.repeat.x = 26 / 14;
// Seen through the holes, the code-drawn strokes read as a waterfall; use the painted cliff
// instead, softened and dimmed so it sits behind the board (tools/crop_textures.py tile).
const holeTex = new THREE.TextureLoader().load('textures/cliff-left-tile.png', (t) => {
  const { width, height } = t.image as HTMLImageElement;
  const tileW = 4.5; // world units per repeat: big soft rocks
  t.repeat.set(26 / tileW, shaftH / (tileW * (height / width)));
  t.needsUpdate = true;
});
holeTex.colorSpace = THREE.SRGBColorSpace;
holeTex.wrapS = holeTex.wrapT = THREE.MirroredRepeatWrapping;
holeTex.minFilter = THREE.LinearMipmapLinearFilter;
const farMat = new THREE.MeshBasicMaterial({ map: holeTex, color: '#6a7cab' }); // darker than the rock: a hole, not a window
const far = new THREE.Mesh(new THREE.PlaneGeometry(26, shaftH), farMat);
placeDeep(far, 4, shaftMidY, -14);
scene.add(far);

// Mid layer: the painted ice cliffs, cropped straight from the style-A mockup
// (tools/crop_textures.py) and tiled down the shaft.
const CLIFF_W = 2.15; // minimum cells of cliff per side, as framed in the mockup
const cliffMats: THREE.MeshBasicMaterial[] = [];
const cliffs: { mesh: THREE.Mesh; tex: THREE.Texture; side: number }[] = [];
for (const side of [-1, 1]) {
  // Seamless rock-and-snow tiles (aurora-free, ends cross-faded); mirroring the full strip made
  // the aurora read as a kaleidoscope. The right side is phase-shifted so the sides don't match.
  const tex = new THREE.TextureLoader().load(side < 0 ? 'textures/cliff-left-tile.png' : 'textures/cliff-right-tile.png', () => fitCliffs());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.offset.y = side < 0 ? 0 : 0.43;
  const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false });
  cliffMats.push(mat);
  const cliff = new THREE.Mesh(new THREE.PlaneGeometry(1, shaftH), mat);
  scene.add(cliff);
  cliffs.push({ mesh: cliff, tex, side });
}
// Widen the cliffs to reach the screen edge (bare backdrop strips at the edges looked unfinished),
// keeping the painted texel aspect so wider cliffs just show bigger rocks.
function fitCliffs() {
  const halfW = camDistance() * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect;
  const w = Math.max(CLIFF_W, halfW - 4.5 + 0.8);
  for (const { mesh, tex, side } of cliffs) {
    mesh.scale.x = w;
    placeDeep(mesh, side < 0 ? -0.5 - w / 2 : 8.5 + w / 2, shaftMidY, -0.6);
    const img = tex.image as HTMLImageElement | undefined;
    if (img?.width) tex.repeat.set(1, shaftH / (w * (img.height / img.width)));
  }
}

// ---- surface scene (painted like the cliffs: gouache fills, inked edges) ----
const surfaceTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, superMax?: number) => {
  const t = canvasTex(w, h, draw, 1, superMax);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};
// Night sky: deep navy to teal at the horizon, stars, and brushy aurora curtains.
const skyTex = surfaceTex(1024, 512, (g) => {
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0a1a3e');
  grad.addColorStop(0.55, '#173f7c');
  grad.addColorStop(1, '#3b86bf');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  for (let k = 0; k < 220; k++) {
    g.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`;
    const r = rnd() < 0.1 ? 2 : 1;
    g.fillRect(rnd() * 1024, rnd() * 330, r, r);
  }
  // aurora: soft vertical strokes along two wavy bands, drawn blurred so the strokes merge into
  // a curtain (unblurred 4px bars read as vertical banding). Bands sit low in the texture so they
  // show just above the horizon in the surface view.
  g.filter = 'blur(7px)';
  for (const band of [{ y: 330, hue: [80, 240, 190] }, { y: 390, hue: [150, 120, 255] }]) {
    for (let x = 0; x < 1024; x += 3) {
      const cy = band.y + Math.sin(x / 140) * 40 + Math.sin(x / 47) * 10;
      const len = 70 + Math.sin(x / 31) * 25 + rnd() * 20;
      const a = 0.14 + (Math.sin(x / 90) * 0.5 + 0.5) * 0.2; // was too faint to read on navy
      const grd = g.createLinearGradient(0, cy - len, 0, cy + len * 0.4);
      grd.addColorStop(0, `rgba(${band.hue.join(',')},0)`);
      grd.addColorStop(0.7, `rgba(${band.hue.join(',')},${a})`);
      grd.addColorStop(1, `rgba(${band.hue.join(',')},0)`);
      g.fillStyle = grd;
      g.fillRect(x, cy - len, 5, len * 1.4);
    }
  }
  g.filter = 'none';
}, 2); // gradient + stars: 2× is plenty
const sky = new THREE.Mesh(new THREE.PlaneGeometry(70, 26), new THREE.MeshBasicMaterial({ map: skyTex, fog: false }));
placeDeep(sky, 4, shaftTop + 11, -22);
scene.add(sky);

// Mountains on the horizon: inked silhouettes with snow caps, two ranges for parallax.
function mountainTex(fill: string, shade: string, peaks: number, seedHeight: number) {
  return surfaceTex(1024, 256, (g) => {
    // jagged ridgeline: a peak and a saddle per step, with a couple of shoulders in between
    const pts: [number, number][] = [[0, 256]];
    for (let i = 0; i <= peaks; i++) {
      const x = (i / peaks) * 1024, step = 1024 / peaks;
      pts.push([x - step * 0.75, 256 - seedHeight * (0.35 + rnd() * 0.2)]);
      pts.push([x - step * (0.4 + rnd() * 0.2), 256 - seedHeight * (0.35 + rnd() * 0.65)]); // uneven peaks
      pts.push([x - step * 0.3, 256 - seedHeight * (0.4 + rnd() * 0.2)]);
      pts.push([x, 256 - seedHeight * (0.15 + rnd() * 0.25)]);
    }
    pts.push([1024, 256]);
    // brushy ridge instead of a polygon zigzag
    const path = new Path2D();
    path.moveTo(pts[0][0], pts[0][1]);
    // sharp summits (so they keep their snow caps), rounded shoulders and saddles
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i], [nx, ny] = pts[i + 1];
      if (y < 256 - seedHeight * 0.6) path.lineTo(x, y);
      else path.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    path.lineTo(1024, 256);
    path.closePath();
    const grad = g.createLinearGradient(0, 256 - seedHeight, 0, 256);
    grad.addColorStop(0, fill);
    grad.addColorStop(1, shade);
    g.fillStyle = grad;
    g.fill(path);
    // snow caps: lighten the upper part of each peak
    g.save();
    g.clip(path);
    for (const [x, y] of pts) {
      if (y > 256 - seedHeight * 0.6) continue;
      g.fillStyle = 'rgba(240,250,255,0.85)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 22, y + 20);
      g.lineTo(x + 8, y + 15);
      g.lineTo(x - 4, y + 22);
      g.lineTo(x - 20, y + 17);
      g.closePath();
      g.fill();
    }
    // shaded faces on the right of each peak, softened like a gouache wash
    g.filter = 'blur(6px)';
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i];
      if (y > 256 - seedHeight * 0.5) continue;
      g.fillStyle = 'rgba(20,40,90,0.22)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 40, 256);
      g.lineTo(x + 6, 256);
      g.closePath();
      g.fill();
    }
    g.filter = 'none';
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.stroke(path);
  });
}
const farRange = new THREE.Mesh(new THREE.PlaneGeometry(60, 4),
  new THREE.MeshBasicMaterial({ map: mountainTex('#4f7fbd', '#2a548f', 16, 210), transparent: true, alphaTest: 0.5, fog: false }));
placeDeep(farRange, 4, shaftTop + 1.6, -12);
const nearRange = new THREE.Mesh(new THREE.PlaneGeometry(44, 2.4),
  new THREE.MeshBasicMaterial({ map: mountainTex('#8cbfe6', '#5189c2', 12, 190), transparent: true, alphaTest: 0.5, fog: false }));
placeDeep(nearRange, 4, shaftTop + 0.85, -5);
scene.add(farRange, nearRange);

// Snowfield the board is set into: wavy inked top edge just under the hero's feet, covering the
// top of the cliffs at the sides. It sits behind the board and the hero (the old snow box was in
// front of the hero and hid everything but its head).
const GROUND_H = 4; // world units; the painted top edge sits ~14% down the texture
const groundTex = surfaceTex(1024, 192, (g) => {
  const top = (x: number) => 26 + Math.sin(x / 60) * 6 + Math.sin(x / 23) * 3;
  const path = new Path2D();
  path.moveTo(0, 192);
  for (let x = 0; x <= 1024; x += 8) path.lineTo(x, top(x));
  path.lineTo(1024, 192);
  path.closePath();
  const grad = g.createLinearGradient(0, 0, 0, 192);
  grad.addColorStop(0, '#f6fcff');
  grad.addColorStop(0.5, '#d4ecfa');
  grad.addColorStop(1, '#9ccbea');
  g.fillStyle = grad;
  g.fill(path);
  g.save();
  g.clip(path);
  // a few soft blue-grey drift shadows (thin streaks read as scratches)
  g.filter = 'blur(4px)';
  for (let k = 0; k < 9; k++) {
    g.fillStyle = 'rgba(120,160,205,0.22)';
    g.beginPath();
    g.ellipse(rnd() * 1024, 60 + rnd() * 50, 60 + rnd() * 80, 9 + rnd() * 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = 5;
  g.beginPath();
  for (let x = 0; x <= 1024; x += 8) (x ? g.lineTo(x, top(x)) : g.moveTo(x, top(x)));
  g.stroke();
  // Lower edge: a drawn snow lip with icicles over the cliff tops (a soft fade read as a muddy
  // seam). Cut everything below a wavy line, ink it, then hang icicles from it.
  const lip = (x: number) => 118 + Math.sin(x / 41) * 7 + Math.sin(x / 13) * 3;
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(0, 192);
  for (let x = 0; x <= 1024; x += 6) g.lineTo(x, lip(x));
  g.lineTo(1024, 192);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'source-over';
  g.lineJoin = 'round';
  // icicles: narrow, tapered and uneven (wide even triangles read as party bunting); the texture
  // is stretched ~2.6x wide in world space, so draw them extra slim
  for (let x = 6; x < 1024; x += 6 + rnd() * 22) {
    if (rnd() < 0.35) continue;
    const len = 6 + rnd() * rnd() * 46, w = 1.5 + rnd() * 2, y = lip(x) - 2;
    g.fillStyle = '#cfeeff';
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x - w, y);
    g.quadraticCurveTo(x - w * 0.4, y + len * 0.6, x + (rnd() - 0.5) * 2, y + len);
    g.quadraticCurveTo(x + w * 0.5, y + len * 0.5, x + w, y);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.strokeStyle = INK;
  g.lineWidth = 4;
  g.beginPath();
  for (let x = 0; x <= 1024; x += 6) (x ? g.lineTo(x, lip(x)) : g.moveTo(x, lip(x)));
  g.stroke();
});
// Snowy pines on the horizon either side of the board: inked triangles with snow layers, so the
// surface reads as a place (the bare snowfield looked unfinished).
const PINES_W = 40, PINES_H = 1.6;
const pinesTex = surfaceTex(2048, 160, (g) => {
  const boardL = ((-0.5 - (4 - PINES_W / 2)) / PINES_W) * 2048 - 30;
  const boardR = ((8.5 - (4 - PINES_W / 2)) / PINES_W) * 2048 + 30;
  for (let x = 20; x < 2048; x += 34 + rnd() * 50) {
    if (x > boardL && x < boardR) continue;
    const h = 70 + rnd() * 80, w = h * 0.5, base = 158;
    g.lineJoin = 'round';
    for (let tier = 0; tier < 3; tier++) {
      const ty = base - (tier * h) / 3.2, tw = w * (1 - tier * 0.22);
      const path = new Path2D();
      path.moveTo(x - tw / 2, ty);
      path.lineTo(x, ty - h * 0.5);
      path.lineTo(x + tw / 2, ty);
      path.closePath();
      g.fillStyle = tier % 2 ? '#1f5e6e' : '#24707f';
      g.fill(path);
      g.fillStyle = 'rgba(244,251,255,0.95)'; // snow on the tier's upper edge
      g.beginPath();
      g.moveTo(x - tw * 0.32, ty - h * 0.16);
      g.lineTo(x, ty - h * 0.5);
      g.lineTo(x + tw * 0.28, ty - h * 0.2);
      g.quadraticCurveTo(x, ty - h * 0.26, x - tw * 0.32, ty - h * 0.16);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.stroke(path);
    }
  }
});
const pines = new THREE.Mesh(new THREE.PlaneGeometry(PINES_W, PINES_H),
  new THREE.MeshBasicMaterial({ map: pinesTex, transparent: true, alphaTest: 0.5, fog: false }));
placeDeep(pines, 4, shaftTop + PINES_H / 2 - 0.15, -0.45); // base tucked behind the snowline
scene.add(pines);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, GROUND_H),
  new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false, fog: false }));
// centre = top edge (shaftTop, under the hero's feet) - half height + the 14% inset
placeDeep(ground, 4, shaftTop - GROUND_H / 2 + GROUND_H * 0.14 + 0.05, -0.3);
scene.add(ground);

// falling snow around the camera
const SNOW = 220;
const snowPos = new Float32Array(SNOW * 3);
for (let i = 0; i < SNOW; i++) {
  snowPos[i * 3] = -6 + Math.random() * 20;
  snowPos[i * 3 + 1] = Math.random() * 20;
  snowPos[i * 3 + 2] = -0.4 + Math.random() * 3;
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
// round, soft-edged flakes (default points are hard squares)
const flakeTex = canvasTex(32, 32, (g) => {
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
});
flakeTex.wrapT = THREE.ClampToEdgeWrapping;
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
  map: flakeTex, color: '#ffffff', size: 0.13, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
}));
snow.frustumCulled = false;
scene.add(snow);

// ---- glowing ice crystals studding the cliffs below 100m ----
// Each depth band gets its own glow colour, so going deeper is a visible reward, not only darker.
const CRYSTAL_GLOW = ['#9ff7ff', '#8fd0ff', '#c39bff', '#ff9ad5', '#ffd36b'];
const crystalTex = canvasTex(64, 96, (g) => {
  g.lineJoin = 'round';
  const shards: [number, number, number][] = [[32, 10, 14], [16, 34, 9], [48, 30, 10]];
  for (const [x, top, w] of shards) {
    g.fillStyle = '#ffffff';
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x + w, top + 30);
    g.lineTo(x + w * 0.6, 92);
    g.lineTo(x - w * 0.6, 92);
    g.lineTo(x - w, top + 30);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.moveTo(x, top + 4);
    g.lineTo(x, 90);
    g.stroke();
  }
});
crystalTex.wrapT = THREE.ClampToEdgeWrapping;
const CRYSTALS = 120; // ~2 per screen per side
const crystals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.6, 0.9),
  new THREE.MeshBasicMaterial({ map: crystalTex, alphaTest: 0.5, fog: false }), CRYSTALS);
// irregular wash of light (a single radial gradient read as a perfect sticker halo)
const crystalGlowTex = canvasTex(128, 128, (g) => {
  for (let k = 0; k < 7; k++) {
    const x = 64 + (rnd() - 0.5) * 34, y = 64 + (rnd() - 0.5) * 34, r = 26 + rnd() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.32)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
});
crystalGlowTex.wrapT = THREE.ClampToEdgeWrapping;
const crystalGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.8, 1.8),
  new THREE.MeshBasicMaterial({ map: crystalGlowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), CRYSTALS);
crystals.frustumCulled = crystalGlow.frustumCulled = false;
scene.add(crystalGlow, crystals);
{
  const o = new THREE.Object3D();
  for (let i = 0; i < CRYSTALS; i++) {
    const depth = 105 + i * (600 / CRYSTALS) + rnd() * 5; // spread from 100m to the deepest stage (700m)
    const side = i % 2 ? 1 : -1;
    const x = side < 0 ? -0.9 - rnd() * 1.1 : 8.9 + rnd() * 1.1;
    const y = wy(SKY_ROWS - 1 + depth);
    const lv = levelOfDepth(depth) - 1;
    o.position.set(x - OBLIQUE.x * -0.5, y - OBLIQUE.y * -0.5, -0.5);
    o.rotation.set(0, 0, (rnd() - 0.5) * 0.6);
    o.scale.setScalar(0.7 + rnd() * 0.6);
    o.updateMatrix();
    crystals.setMatrixAt(i, o.matrix);
    crystals.setColorAt(i, new THREE.Color(CRYSTAL_GLOW[lv]).lerp(new THREE.Color('#ffffff'), 0.35));
    o.position.z = -0.55;
    o.scale.multiplyScalar(1.2);
    o.updateMatrix();
    crystalGlow.setMatrixAt(i, o.matrix);
    crystalGlow.setColorAt(i, new THREE.Color(CRYSTAL_GLOW[lv]).multiplyScalar(0.5));
  }
}

// Background props: low-poly GLBs (polyfork.dev) inked to match (src/props3d.ts); ?props=0 = off
const props = new URLSearchParams(location.search).get('props') !== '0'
  ? addProps({ scene, ramp, ink: INK, shaftTop, yOfDepth: (depth) => wy(SKY_ROWS - 1 + depth), placeDeep })
  : null;

// Shaft frame: a navy ice rim down both board edges. Hides the slab side faces the oblique view
// shows on the right edge only (a lopsided coloured sliver) and closes the board like a picture.
for (const side of [-1, 1]) {
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(0.16, shaftH), new THREE.MeshBasicMaterial({ color: INK, fog: false }));
  placeDeep(rim, side < 0 ? -0.5 - 0.02 : 8.5 + 0.05, shaftTop - shaftH / 2, 0.55);
  scene.add(rim);
}

// ---- the goal floor under the last row: a golden geode with an inked banner ----
const goalTex = canvasTex(1024, 384, (g) => {
  const grad = g.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, '#ffe08a');
  grad.addColorStop(1, '#c98a1e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 384);
  g.lineJoin = 'round';
  for (let k = 0; k < 70; k++) { // gold crystal facets
    const x = rnd() * 1024, y = 40 + rnd() * 340, w = 20 + rnd() * 40;
    g.fillStyle = `rgba(255,${235 + rnd() * 20},${170 + rnd() * 60},${0.4 + rnd() * 0.4})`;
    g.strokeStyle = 'rgba(27,34,56,0.55)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x, y - w);
    g.lineTo(x + w * 0.45, y);
    g.lineTo(x, y + w * 0.4);
    g.lineTo(x - w * 0.45, y);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.strokeStyle = INK; // inked top edge
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(0, 4);
  g.lineTo(1024, 4);
  g.stroke();
  // banner
  g.fillStyle = '#fdf6e3';
  g.strokeStyle = INK;
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(262, 70, 500, 120, 28);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.font = '78px "Jua", "Apple SD Gothic Neo", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
});
goalTex.wrapT = THREE.ClampToEdgeWrapping;
const goalFloor = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.375),
  new THREE.MeshBasicMaterial({ map: goalTex, fog: false }));
// top edge flush with the bottom of the stage's last row (placed in reset)
const placeGoalFloor = (rows: number) => goalFloor.position.set(4, wy(rows - 1) - 0.5 - 3.375 / 2, 0.47);
placeGoalFloor(ROWS);
scene.add(goalFloor);
// The banner text depends on the stage's depth; redrawn on reset and once the font loads.
let goalDepthShown = 0;
function drawGoalBanner(depthM: number) {
  goalDepthShown = depthM;
  const c = goalTex.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fdf6e3';
  g.beginPath();
  g.roundRect(266, 74, 492, 112, 24);
  g.fill();
  g.fillStyle = INK;
  g.font = '78px "Jua", "Apple SD Gothic Neo", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`★ ${depthM}m GOAL ★`, 512, 134);
  goalTex.needsUpdate = true;
}
// fonts.ready resolves before an unused face is fetched: ask for Jua explicitly
document.fonts?.load('78px Jua').catch(() => {}).then(() => drawGoalBanner(goalDepthShown || GOAL_DEPTH));

// ---- blocks with analytic chunk ink ----
// Each instance carries an 8-neighbour mask; the fragment shader draws a constant-width ink line
// on every edge that borders a different chunk (plus inner-corner notches) and a light bevel band
// under exposed tops. One line rule for the whole board, no inverted-hull pass, no inner seams.
const MAX = 9 * WINDOW_ROWS * 2;
const boxGeo = new THREE.BoxGeometry(1, 1, 0.94);
const INK_W = 0.028; // per side, in cell units; two neighbours make a ~0.056 cell line (mockup is thin)
const TIME = { value: 0 }; // shared shader clock (aurora ice shimmer)
function inkMaterial(params: THREE.MeshToonMaterialParameters, atlas = false, glyphX = false) {
  const mat = toon('#fff', { ...params, fog: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = { value: new THREE.Color(INK) };
    shader.uniforms.uTime = TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMask;\nvarying float vMask;\nvarying vec2 vCellUv;\nvarying vec3 vObjN;\nvarying vec2 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = aMask;\nvCellUv = uv;\nvObjN = normal;\nvWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xy;')
      // atlas: pick one of 4 painted cell interiors per instance (bits 256/512 of the mask)
      .replace('#include <uv_vertex>', atlas
        ? '#include <uv_vertex>\nvMapUv = vMapUv * 0.5 + vec2(mod(floor(aMask / 256.0), 2.0), mod(floor(aMask / 512.0), 2.0)) * 0.5;'
        : '#include <uv_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uInk;
uniform float uTime;
varying float vMask;
varying vec2 vCellUv;
varying vec3 vObjN;
varying vec2 vWorld;
float bitOf(float m, float b) { return mod(floor(m / b), 2.0); }
// hand-drawn wobble: the line width breathes along the edge, keyed to world position so the
// two cells sharing an edge wobble together
float wob(float t) { return (sin(t * 7.3 + sin(t * 2.9) * 1.7) * 0.5 + 0.5) * 0.014 + (sin(t * 19.0) * 0.5 + 0.5) * 0.004; }`)
      .replace('#include <dithering_fragment>', `
if (vObjN.z > 0.5) {
  vec2 uv = vCellUv;
  vec2 aa = fwidth(uv) * 0.75; // antialias every edge: hard steps read as jaggy, cut-out lines
  float w = ${INK_W.toFixed(3)};
  float wv = w + wob(vWorld.y); // vertical edges wobble along y
  float wh = w + wob(vWorld.x + 31.0); // horizontal edges wobble along x
  float eL = bitOf(vMask, 1.0), eR = bitOf(vMask, 2.0), eU = bitOf(vMask, 4.0), eD = bitOf(vMask, 8.0);
  // an edge shared with another chunk's block is drawn half-width from each side, so every line —
  // outer silhouette or between chunks — ends up the same width on screen
  float hL = 1.0 - 0.5 * bitOf(vMask, 32768.0), hR = 1.0 - 0.5 * bitOf(vMask, 65536.0);
  float hU = 1.0 - 0.5 * bitOf(vMask, 131072.0), hD = 1.0 - 0.5 * bitOf(vMask, 262144.0);
  float ink = 0.0;
  ink = max(ink, eL * (1.0 - smoothstep(wv * hL - aa.x, wv * hL + aa.x, uv.x)));
  ink = max(ink, eR * smoothstep(1.0 - wv * hR - aa.x, 1.0 - wv * hR + aa.x, uv.x));
  ink = max(ink, eU * smoothstep(1.0 - wh * hU - aa.y, 1.0 - wh * hU + aa.y, uv.y));
  ink = max(ink, eD * (1.0 - smoothstep(wh * hD - aa.y, wh * hD + aa.y, uv.y)));
  // rounded outer corners where two exposed edges meet (the mockup's slabs are softly rounded)
  float R = 0.14;
  float aaR = max(aa.x, aa.y);
  vec2 cUL = vec2(R, 1.0 - R), cUR = vec2(1.0 - R, 1.0 - R), cDL = vec2(R, R), cDR = vec2(1.0 - R, R);
  ink = max(ink, eL * eU * step(uv.x, R) * step(1.0 - R, uv.y) * smoothstep(R - w - aaR, R - w + aaR, length(uv - cUL)));
  ink = max(ink, eR * eU * step(1.0 - R, uv.x) * step(1.0 - R, uv.y) * smoothstep(R - w - aaR, R - w + aaR, length(uv - cUR)));
  ink = max(ink, eL * eD * step(uv.x, R) * step(uv.y, R) * smoothstep(R - w - aaR, R - w + aaR, length(uv - cDL)));
  ink = max(ink, eR * eD * step(1.0 - R, uv.x) * step(uv.y, R) * smoothstep(R - w - aaR, R - w + aaR, length(uv - cDR)));
  // inner corners: a small round ink dot where the chunk wraps around a different diagonal cell
  ink = max(ink, bitOf(vMask, 16.0) * (1.0 - smoothstep(w * 1.6 - aaR, w * 1.6 + aaR, length(uv - vec2(0.0, 1.0)))));
  ink = max(ink, bitOf(vMask, 32.0) * (1.0 - smoothstep(w * 1.6 - aaR, w * 1.6 + aaR, length(uv - vec2(1.0, 1.0)))));
  ink = max(ink, bitOf(vMask, 64.0) * (1.0 - smoothstep(w * 1.6 - aaR, w * 1.6 + aaR, length(uv - vec2(0.0, 0.0)))));
  ink = max(ink, bitOf(vMask, 128.0) * (1.0 - smoothstep(w * 1.6 - aaR, w * 1.6 + aaR, length(uv - vec2(1.0, 0.0)))));
  // gouache bevel as soft gradients: highlight under an exposed top, shade over exposed bottom/right
  float top = eU * smoothstep(1.0 - wh - 0.16, 1.0 - wh - 0.02, uv.y);
  float bottom = eD * (1.0 - smoothstep(wh + 0.01, wh + 0.14, uv.y));
  float right = eR * smoothstep(1.0 - wv - 0.12, 1.0 - wv - 0.01, uv.x);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), top * 0.22);
  gl_FragColor.rgb *= 1.0 - max(bottom, right) * 0.2;
  // Thin ice (mask bit 524288): a frosty white inset line, plus a crack per melt stage
  // (stage 0-4 in bits 1048576..) so the player can read how soon it will melt.
  if (bitOf(vMask, 524288.0) > 0.5) {
    float inset = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
    float frost = 1.0 - smoothstep(0.012, 0.012 + aaR, abs(inset - 0.32));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), frost * 0.85 + 0.12);
    float stage = mod(floor(vMask / 1048576.0), 8.0);
    vec2 cq = uv - 0.5;
    float crack = 0.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= stage) break;
      float a = float(i) * 1.9 + 0.4;
      vec2 dir = vec2(cos(a), sin(a));
      float along = dot(cq, dir);
      float across = abs(dot(cq, vec2(-dir.y, dir.x)) + sin(along * 34.0 + float(i)) * 0.016);
      crack = max(crack, step(0.0, along) * step(along, 0.42) * (1.0 - smoothstep(0.006, 0.014 + aaR, across)));
    }
    ink = max(ink, crack * 0.85);
  }
  // About to fall (mask bit 2048): a fast bright pulse on top of the positional jitter, so the
  // danger reads even when the shake is small on screen.
  if (bitOf(vMask, 2048.0) > 0.5) {
    // gentle: when a big area collapses, many cells pulse at once and a strong flash read as a glitch
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), 0.14 * (sin(uTime * 22.0) * 0.5 + 0.5));
  }
  // Level-boundary row (mask bit 1024): aurora ice. Hues drift teal→green→sky→violet along the
  // row, a diagonal glint sweeps across, and a few star sparkles twinkle inside the ice.
  if (bitOf(vMask, 1024.0) > 0.5) {
    float k = sin(vWorld.x * 0.9 + uTime * 1.2) * 0.5 + 0.5;
    vec3 aur = mix(mix(vec3(0.33, 0.95, 0.80), vec3(0.50, 0.78, 1.0), k), vec3(0.74, 0.56, 1.0),
                   sin(vWorld.x * 0.4 - uTime * 0.7) * 0.25 + 0.25);
    float sweep = 1.0 - smoothstep(0.0, 0.08, abs(fract((vWorld.x + vWorld.y * 0.6) * 0.11 - uTime * 0.3) - 0.5));
    // star sparkles: a soft 4-point glint in a few random sub-cells (square dots read as dead pixels)
    vec2 sc = floor(vWorld * 4.0);
    vec2 f = fract(vWorld * 4.0) - 0.5;
    float h = fract(sin(dot(sc, vec2(12.9898, 78.233))) * 43758.5453);
    float star = (1.0 - smoothstep(0.0, 0.035, abs(f.x))) * (1.0 - smoothstep(0.0, 0.32, abs(f.y)))
               + (1.0 - smoothstep(0.0, 0.035, abs(f.y))) * (1.0 - smoothstep(0.0, 0.32, abs(f.x)))
               + (1.0 - smoothstep(0.0, 0.09, length(f)));
    float twinkle = step(0.88, h) * min(star, 1.0) * pow(sin(uTime * 2.5 + h * 50.0) * 0.5 + 0.5, 3.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, aur, 0.72) + vec3(sweep * 0.3 + twinkle * 0.7);
  }
${glyphX ? '' : `  // surface snow cap (mask bit 4096 on regular blocks in the first row): a wavy inked snowline
  // so the board reads as set into the snowfield, not slid under it
  if (mod(floor(vMask / 4096.0), 8.0) >= 1.0) {
    float line = 0.74 + sin(vWorld.x * 9.0) * 0.035 + sin(vWorld.x * 23.0) * 0.015;
    float snowA = smoothstep(line - aa.y, line + aa.y, uv.y);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.96, 0.99, 1.0), snowA);
    float rim = 1.0 - smoothstep(0.012, 0.012 + aa.y * 2.0, abs(uv.y - line));
    ink = max(ink, rim);
  }`}
${glyphX ? `  // X glyph inked by the shader (crisp at any size, same line language as the borders)
  vec2 q = uv - 0.5;
  float dX = min(abs(q.x - q.y), abs(q.x + q.y)) * 0.7071;
  float box = 1.0 - smoothstep(0.27 - aaR, 0.27 + aaR, max(abs(q.x), abs(q.y)));
  float stroke = (1.0 - smoothstep(0.055 - aaR, 0.055 + aaR, dX)) * box;
  ink = max(ink, stroke * 0.9);
  // damage cracks: one more inked crack per hit taken (mask bits 4096.., value 0-4)
  float dmg = mod(floor(vMask / 4096.0), 8.0);
  vec2 cq = uv - vec2(0.5);
  float crack = 0.0;
  // cracks start at the block's edges and run inward, near-horizontal/vertical so they never
  // read as part of the X strokes
  for (int i = 0; i < 4; i++) {
    if (float(i) >= dmg) break;
    vec2 o = i == 0 ? vec2(0.5, 0.0) : i == 1 ? vec2(-0.5, -0.08) : i == 2 ? vec2(0.08, 0.5) : vec2(-0.1, -0.5);
    vec2 dir = normalize(-o + vec2(float(i) * 0.07 - 0.1, 0.06 - float(i) * 0.04));
    vec2 rel = cq - o;
    float along = dot(rel, dir);
    float across = abs(dot(rel, vec2(-dir.y, dir.x)) + sin(along * 38.0 + float(i)) * 0.014);
    float width = mix(0.022, 0.006, clamp(along / 0.34, 0.0, 1.0)); // tapers like a real crack
    crack = max(crack, step(0.0, along) * step(along, 0.34) * (1.0 - smoothstep(width, width + aaR, across)));
  }
  ink = max(ink, crack);` : ''}
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, ink);
} else {
  // slab thickness seen through the oblique view: tops lighter, sides and bottoms a deeper
  // shade of the block's own colour (not ink grey), with a thin ink line at the back edge
  float shade = vObjN.y > 0.5 ? 1.12 : 0.68;
  gl_FragColor.rgb *= shade;
  if (vObjN.y < -0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, 0.8); // underside = navy lip, not a 3D extrusion
  ${glyphX ? '' : 'if (vObjN.y > 0.5 && mod(floor(vMask / 4096.0), 8.0) >= 1.0) gl_FragColor.rgb = vec3(0.93, 0.97, 1.0); // snowy top'}
  vec2 suv = vCellUv;
  float back = abs(vObjN.y) > 0.5 ? suv.y : suv.x; // depth axis on that face
  float far = vObjN.y > 0.5 ? 1.0 - smoothstep(0.0, 0.12, back) : smoothstep(0.88, 1.0, back);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, max(far * 0.8, 0.22));
}
#include <dithering_fragment>`);
  };
  return mat;
}
// Painted gouache surface: a 2x2 atlas of brightness detail cropped from the mockup's cells,
// stored around 0.8 grey, so the material colour is boosted to bring the hue back to full value.
const detailTex = new THREE.TextureLoader().load('textures/block-detail.png');
detailTex.colorSpace = THREE.SRGBColorSpace;
const blockMat = inkMaterial({ map: detailTex }, true);
blockMat.color.setScalar(1.3);
const BOARD_LIGHT = [1, 1, 1, 1, 1]; // fixed: colour drift with depth hurt readability (review round c)
const blocks = new THREE.InstancedMesh(boxGeo, blockMat, MAX);
const blockMask = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
blocks.geometry = boxGeo.clone();
blocks.geometry.setAttribute('aMask', blockMask);
scene.add(blocks);

// X blocks: the same painted gouache surface in frozen-rock slate, with the X inked by the shader.
// (The 50px crop of the mockup's X looked blurry when stretched and doubled the border.)
const xMat = inkMaterial({ map: detailTex }, true, true);
xMat.color.set(XBLOCK_COLOR).multiplyScalar(1.25);
const xBlocks = new THREE.InstancedMesh(boxGeo.clone(), xMat, MAX);
const xMask = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
xBlocks.geometry.setAttribute('aMask', xMask);
scene.add(xBlocks);

// Air capsule = an inked air bubble card (same 2D card language as hero, drill and shards),
// with a soft additive halo behind it so it reads as the thing to grab in a dark hole.
const bubbleTex = canvasTex(128, 128, (g) => {
  const body = g.createRadialGradient(54, 50, 6, 64, 64, 54);
  body.addColorStop(0, '#e9fbff');
  body.addColorStop(0.55, '#8fdcff');
  body.addColorStop(1, '#3fa9ea');
  g.fillStyle = body;
  g.strokeStyle = INK;
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; // highlight arc
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(64, 64, 36, Math.PI * 1.1, Math.PI * 1.45);
  g.stroke();
  g.fillStyle = '#1b5d8f';
  g.font = 'bold 34px "Comic Sans MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('O\u2082', 68, 72);
});
bubbleTex.wrapT = THREE.ClampToEdgeWrapping;
const haloTex = canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(160,235,255,0.9)');
  r.addColorStop(1, 'rgba(160,235,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
});
haloTex.wrapT = THREE.ClampToEdgeWrapping;
const capsules = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.8),
  new THREE.MeshBasicMaterial({ map: bubbleTex, alphaTest: 0.5, fog: false }), 64);
const capInk = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.5),
  new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 64);
scene.add(capInk, capsules);

// Frozen friend: an inked penguin chick sealed in a pale ice cube, waiting to be rescued.
const friendTex = canvasTex(128, 128, (g) => {
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  // ice cube
  g.fillStyle = 'rgba(214,240,255,0.95)';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(8, 8, 112, 112, 18);
  g.fill();
  g.stroke();
  // chick body
  g.fillStyle = '#2f3b5c';
  g.lineWidth = 5;
  g.beginPath();
  g.ellipse(64, 72, 30, 36, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#fdf6e3'; // belly and face
  g.beginPath();
  g.ellipse(64, 80, 19, 24, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(64, 56, 16, 13, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK; // eyes
  for (const ex of [57, 71]) { g.beginPath(); g.arc(ex, 54, 3.5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#f5a742'; // beak
  g.beginPath();
  g.moveTo(59, 61); g.lineTo(69, 61); g.lineTo(64, 68); g.closePath();
  g.fill();
  g.lineWidth = 2;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; // ice shine
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(24, 40); g.lineTo(38, 24);
  g.stroke();
});
friendTex.wrapT = THREE.ClampToEdgeWrapping;
const friends = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9),
  new THREE.MeshBasicMaterial({ map: friendTex, alphaTest: 0.5, fog: false }), 64);
friends.frustumCulled = false;
scene.add(friends);

// Time-attack clock: an inked golden alarm clock card.
const clockTex = canvasTex(128, 128, (g) => {
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.fillStyle = '#f5c542';
  g.lineWidth = 6;
  for (const bx of [36, 92]) { g.beginPath(); g.arc(bx, 30, 14, 0, Math.PI * 2); g.fill(); g.stroke(); } // bells
  g.beginPath();
  g.arc(64, 70, 44, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#fdf6e3';
  g.beginPath();
  g.arc(64, 70, 32, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(64, 70); g.lineTo(64, 48);
  g.moveTo(64, 70); g.lineTo(80, 78);
  g.stroke();
});
clockTex.wrapT = THREE.ClampToEdgeWrapping;
const clocks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.8),
  new THREE.MeshBasicMaterial({ map: clockTex, alphaTest: 0.5, fog: false }), 64);
clocks.frustumCulled = false;
scene.add(clocks);

// Instance bounds are computed once near the surface, so frustum culling would hide every
// instanced mesh once the camera digs deeper.
// Board shadow: one dark quad per block cell, a little behind the board. The oblique view
// (see syncCamera) shifts deeper layers, so this lands offset like a cast shadow on the backdrop.
const SHADOW_Z = -1.1;
// soft-edged square so neighbouring quads merge into one blurred silhouette
const shadowTex = canvasTex(64, 64, (g) => {
  const edge = 14;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const d = Math.min(x, y, 63 - x, 63 - y);
      g.fillStyle = `rgba(6,17,42,${Math.min(1, (d + 2) / edge)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
});
shadowTex.wrapT = THREE.ClampToEdgeWrapping;
const boardShadow = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(1.25, 1.25),
  new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.4, depthWrite: false, fog: false }),
  MAX * 2,
);
scene.add(boardShadow);
for (const m of [blocks, xBlocks, capsules, capInk, boardShadow]) m.frustumCulled = false;

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

// ---- placeholder puppy from primitives (until the Tripo model replaces it) ----
const mole = new THREE.Group();
const withInk = (mesh: THREE.Mesh, k = 1.08) => {
  const ink = new THREE.Mesh(mesh.geometry, inkMat);
  ink.position.copy(mesh.position);
  ink.rotation.copy(mesh.rotation);
  ink.scale.copy(mesh.scale).multiplyScalar(k);
  mesh.castShadow = true;
  return [ink, mesh];
};
// hoodie torso (bobs)
const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), toon('#5ec8e6'));
body.scale.set(1.05, 0.85, 0.9);
body.position.y = -0.2;
mole.add(...withInk(body));
// head turns toward the drill direction
const face = new THREE.Group();
const bodyMat = toon('#c8894a'); // fur; tints blue when gasping for air
const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 22, 18), bodyMat);
head.position.y = 0.16;
face.add(...withInk(head));
const earMat = toon('#9a5a26');
for (const side of [-1, 1]) {
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 10), earMat);
  ear.position.set(side * 0.2, 0.43, -0.02);
  ear.rotation.z = -side * 0.45;
  face.add(...withInk(ear, 1.12));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), new THREE.MeshBasicMaterial({ color: '#1a1008' }));
  eye.position.set(side * 0.12, 0.22, 0.25);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff' }));
  shine.position.set(side * 0.12 + 0.025, 0.25, 0.31);
  face.add(eye, shine);
}
const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), toon('#f3d3a3'));
muzzle.scale.set(1.1, 0.8, 0.9);
muzzle.position.set(0, 0.08, 0.24);
face.add(muzzle);
const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: '#111' }));
nose.position.set(0, 0.12, 0.37);
face.add(nose);
mole.add(face);
const drillPivot = new THREE.Group();
// The tool is an inked hammer card (the owner preferred smashing ice with a hammer to drilling;
// it matches the character art). Drawn lying along +x: grip at the left, head at the right end.
// Still a flat card like the hero — never a 3D primitive glued to a 2D sprite.
// head: the steel colour, tinted by an equipped hammer cosmetic (item 15)
function hammerTex(head = '#aebccb') {
  const t = canvasTex(160, 96, (g) => {
    g.lineJoin = 'round';
    g.strokeStyle = INK;
    // wooden handle
    g.fillStyle = '#c0803c';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(8, 40, 112, 18, 8);
    g.fill();
    g.stroke();
    g.strokeStyle = 'rgba(90,50,20,0.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(24, 49);
    g.lineTo(100, 49);
    g.stroke();
    // steel head, perpendicular to the handle
    g.strokeStyle = INK;
    g.fillStyle = head;
    g.lineWidth = 7;
    g.beginPath();
    g.roundRect(108, 8, 44, 80, 10);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.75)'; // shine
    g.beginPath();
    g.roundRect(116, 16, 10, 60, 5);
    g.fill();
  });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
const drillTex = hammerTex();
const drillCard = new THREE.Mesh(
  new THREE.PlaneGeometry(0.5, 0.3).translate(0.25, 0, 0), // grip at the origin so it swings from the hand
  new THREE.MeshBasicMaterial({ map: drillTex, transparent: true, alphaTest: 0.5, fog: false }),
);
drillCard.position.x = 0.12;
drillPivot.add(drillCard);
mole.add(drillPivot);
scene.add(mole);

// The hero is a flat 2D sprite standing in the 3D world, the way Tidebreaker does it:
// 3D for the world, hand-drawn 2D for the character. (The Tripo 3D model, kept in
// assets/character, clashed with the toon blocks.) The primitive puppy is the fallback.
// About one cell tall (only the ears poke above), so the row above, where crushes come from,
// stays visible. Self-lit: the art already has its shading, so scene light would light it twice.
const SPRITE_H = 1.04;
const spriteMat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
const sprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spriteMat);
sprite.visible = false;
const spriteRig = new THREE.Group(); // pivot at the feet for squash, lean and hop
spriteRig.position.set(0, -0.5, 0.25);
spriteRig.add(sprite);
mole.add(spriteRig);
const contact = new THREE.Mesh(
  new THREE.CircleGeometry(0.3, 24),
  new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.38, depthWrite: false }),
);
contact.rotation.x = -Math.PI / 2;
contact.position.set(0, -0.49, 0.25);
contact.scale.set(1, 0.55, 1);
contact.visible = false;
mole.add(contact);
let spriteLean = 0;
const leanQ = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const placeholder = mole.children.filter((c) => c !== drillPivot && c !== spriteRig);

// ---- time attack ghost (studio review 2 item 15) ----
// The fixed course replays the same board, so the best clear's route is worth racing: the hero's
// cell is sampled every GHOST_DT of run time on a timed stage, and the path of the best
// clock-adjusted clear (per stage and course version, this browser only) is drawn as a
// see-through hero at the same run time. Storage can be blocked: then there is just no ghost.
const GHOST_DT = 0.1; // s between samples (our choice: ~3k numbers for a 150 s run)
const GHOST_OPACITY = 0.35;
const ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: GHOST_OPACITY, depthWrite: false, side: THREE.DoubleSide, fog: false });
const ghostHero = new THREE.Mesh(sprite.geometry, ghostMat);
ghostHero.visible = false;
ghostHero.renderOrder = 1; // after the opaque blocks, so it blends over them
scene.add(ghostHero);
let ghostRec: number[] = []; // x, y per sample of this run
let ghostRecAt = 0; // run time of the next sample
let ghostBest: { time: number; pts: number[] } | null = null;
const ghostKey = () => `dig-down:ghost:${currentStage.def.id}:${currentStage.course ?? 1}`;
// a new run: start recording, and load the course's best (timed stages only)
function loadGhost() {
  ghostRec = [];
  ghostRecAt = 0;
  ghostBest = null;
  if (!currentStage.timed || startDepth) return;
  try {
    const g = JSON.parse(localStorage.getItem(ghostKey()) ?? 'null');
    if (g && typeof g.time === 'number' && Array.isArray(g.pts) && g.pts.length >= 2) ghostBest = g;
  } catch { /* storage blocked or a bad save: no ghost */ }
}
function recordGhost() {
  if (!currentStage.timed || !started || game.state !== 'playing') return;
  while (ghostRecAt <= game.time) { ghostRec.push(game.mole.x, game.mole.y); ghostRecAt += GHOST_DT; }
}
// a clear: keep its route if it beat the stored one (clock-adjusted, as the record is)
function saveGhost(clockTime: number) {
  if (!currentStage.timed || startDepth || ghostRec.length < 2) return;
  if (ghostBest && ghostBest.time <= clockTime) return;
  ghostBest = { time: clockTime, pts: ghostRec.slice() };
  try { localStorage.setItem(ghostKey(), JSON.stringify(ghostBest)); } catch { /* ignore */ }
}
function syncGhostHero() {
  const pts = ghostBest?.pts;
  if (!pts || !started || !heroReady || !spriteMat.map) { ghostHero.visible = false; return; }
  const n = pts.length / 2;
  const f = game.time / GHOST_DT;
  const i = Math.min(n - 1, Math.floor(f)), j = Math.min(n - 1, i + 1), u = Math.min(1, Math.max(0, f - i));
  const x = pts[2 * i] + (pts[2 * j] - pts[2 * i]) * u, y = pts[2 * i + 1] + (pts[2 * j + 1] - pts[2 * i + 1]) * u;
  if (ghostMat.map !== spriteMat.map) { ghostMat.map = spriteMat.map; ghostMat.needsUpdate = true; }
  ghostHero.position.set(wx(x), wy(y) - 0.5 + SPRITE_H / 2, 0.2); // feet on the cell floor, a touch behind the hero
  ghostHero.scale.set(Math.abs(sprite.scale.x), sprite.scale.y, 1);
  ghostHero.quaternion.copy(camera.quaternion);
  ghostHero.visible = true;
}
// Style candidates to compare in-game (press C to cycle, or ?style=flat|crayon|pixel|detailed).
const STYLES = [
  { id: 'flat', label: '플랫 만화체', file: 'sprites/puppy-flat.png', pixel: false },
  { id: 'crayon', label: '크레용 손그림', file: 'sprites/puppy-crayon.png', pixel: false },
  { id: 'pixel', label: '픽셀 아트', file: 'sprites/puppy-pixel.png', pixel: true },
  { id: 'detailed', label: '원래 일러스트', file: 'sprites/puppy-idle.png', pixel: false },
];
const textures = new Map<string, THREE.Texture>();
const texLoader = new THREE.TextureLoader();
const styleLabel = document.getElementById('style-label');
let styleIndex = Math.max(0, STYLES.findIndex((st) => st.id === new URLSearchParams(location.search).get('style')));

function applyTexture(tex: THREE.Texture) {
  spriteMat.map = tex;
  spriteMat.needsUpdate = true;
  const { width, height } = tex.image as HTMLImageElement;
  const aspect = width / height;
  sprite.scale.set(SPRITE_H * aspect, SPRITE_H, 1);
  spriteAspect = aspect;
  sprite.position.y = SPRITE_H / 2;
  heroReady = true;
  updateRigVisibility();
  contact.visible = true;
  for (const p of placeholder) p.visible = false;
  drillPivot.position.set(0, -0.1, 0.6); // in front of the block faces it strikes
}

function setStyle(i: number) {
  styleIndex = (i + STYLES.length) % STYLES.length;
  updateRigVisibility();
  const style = STYLES[styleIndex];
  if (styleLabel) styleLabel.textContent = `캐릭터: ${style.label} (C로 바꾸기)`;
  const cached = textures.get(style.id);
  if (cached) { applyTexture(cached); return; }
  texLoader.load(style.file, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    if (style.pixel) {
      tex.magFilter = THREE.NearestFilter; // keep pixels crisp
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
    } else {
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    textures.set(style.id, tex);
    if (STYLES[styleIndex].id === style.id) applyTexture(tex);
  });
}
// ---- cutout rig for the flat-cartoon hero (parts cut by tools/rig_cut.py) ----
// The same drawing split at the neck, shoulders and hips, so it can step, swing its arms and
// reach toward the drill without AI frame-to-frame drift. Other styles stay a single card.
let heroReady = false;
const RIG_W = 301, RIG_H = 512; // public/sprites/puppy-flat.png
const RIG_PARTS = [
  { name: 'legL', pivot: [100, 352] },
  { name: 'legR', pivot: [200, 352] },
  { name: 'body', pivot: [150, 352] },
  { name: 'armL', pivot: [72, 268] },
  { name: 'armR', pivot: [229, 268] },
  { name: 'head', pivot: [150, 222] },
] as const;
const rig = new THREE.Group();
rig.visible = false;
spriteRig.add(rig);
const joints: Record<string, THREE.Group> = {};
let rigLoaded = 0;
const kPx = SPRITE_H / RIG_H; // world units per sprite pixel
RIG_PARTS.forEach((part, order) => {
  const [px, py] = part.pivot;
  const joint = new THREE.Group();
  joint.position.set((px - RIG_W / 2) * kPx, (RIG_H - py) * kPx, order * 0.002); // stacking order
  const mat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(RIG_W * kPx, RIG_H * kPx), mat);
  plane.position.set((RIG_W / 2 - px) * kPx, (py - RIG_H / 2) * kPx, 0); // canvas centre relative to the pivot
  joint.add(plane);
  rig.add(joint);
  joints[part.name] = joint;
  texLoader.load(`sprites/rig/puppy-flat-${part.name}.png`, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    mat.map = tex;
    mat.needsUpdate = true;
    if (++rigLoaded === RIG_PARTS.length) updateRigVisibility();
  });
});
const rigMats = rig.children.map((j) => ((j.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial));
function updateRigVisibility() {
  const on = rigLoaded === RIG_PARTS.length && STYLES[styleIndex].id === 'flat';
  rig.visible = heroReady && on;
  sprite.visible = heroReady && !on;
}

// ---- side-view frames (flat style): used while facing left/right, so sideways moves and hits
// are drawn in profile instead of the front pose sliding sideways. Drawn facing right; the
// paper-flip mirror handles left. Front rig stays for up/down.
// 'slam' / 'up' are front-view frames (hammer driven down between the feet / thrust overhead) for
// downward and upward hits; never mirrored.
type SideFrame = 'stand' | 'walk' | 'windup' | 'hit' | 'slam' | 'up' | 'front' | 'fall' | 'dizzy';
// 'front': the idle stance facing the camera (paw on the handle, hammer on the shoulder). The cutout
// rig used to stand in for it, with its hammer card floating off the hand (owner report).
// 'fall': arms up, hammer held high, ears blown up — any facing, while dropping (replaces the rig)
// 'dizzy': bonked by a block — sitting, swirly eyes, stars (replaces squashing the sprite flat)
const frontFrame = (f: SideFrame | null) => f === 'slam' || f === 'up' || f === 'front' || f === 'fall' || f === 'dizzy';
const SIDE_FILES: Record<SideFrame, string> = {
  stand: 'sprites/side-stand.png', walk: 'sprites/side-walk.png', windup: 'sprites/side-windup.png', hit: 'sprites/side-hit.png', slam: 'sprites/front-slam.png', up: 'sprites/front-up.png', front: 'sprites/front-stand.png', fall: 'sprites/front-fall.png', dizzy: 'sprites/front-dizzy.png',
};
const sideTex: Partial<Record<SideFrame, THREE.Texture>> = {};
const sideMat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
const sideCard = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sideMat);
sideCard.visible = false;
spriteRig.add(sideCard);
for (const f of Object.keys(SIDE_FILES) as SideFrame[]) {
  texLoader.load(SIDE_FILES[f], (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    renderer.initTexture(tex); // upload before first use (no hitch on the first swing)
    sideTex[f] = tex;
  });
}
// Flipbook sheets made by tools/video_to_sheet.py (video → frames, the Spriterrific approach).
// If /sprites/anim/<frame>.json exists, that frame plays as an animation instead of one image.
// boxes (from the tool): per-frame body box [x0, y0, x1, y1, feetX] in sheet pixels. When present,
// frame 0 is a standing reference (not played): it sizes and anchors the sheet against the stand
// sprite, so a sheet cropped wider/taller (hammer overhead) keeps the puppy's size and footing.
interface SheetMeta { frames: number; width: number; height: number; fps: number; boxes?: number[][] }
// the stand sprite's body box (public/sprites/side-stand.png, 267x512, measured): y 3..508, feet x 154.5
const STAND_BODY = { h: 505 / 512, gap: 4 / 512, feet: 154.5 / 267 - 0.5, aspect: 267 / 512 };
// a swing played from a sheet runs on its own clock: 0.16s (the hit cooldown) flashed 6 frames by
// unreadably fast, so the strike animation lasts a bit longer than the gameplay swing (our tuning)
const HIT_ANIM = new URLSearchParams(location.search).has('slowswing') ? 2.4 : 0.26;
let hitAnimT = 0; // counts down from HIT_ANIM at each landed swing
// Share of HIT_ANIM each strike frame holds (raise, back, overhead, down, impact, follow-through).
// The block breaks the instant the key is pressed, so equal spacing showed the impact ~0.15s
// later on an empty cell, and mashing (0.13s cooldown) restarted the raise before any impact
// showed. Rush the anticipation (impact at ~0.07s, with the particles) and hold the strike.
const HIT_TIMING = [0.06, 0.06, 0.07, 0.07, 0.34, 0.40]; // our tuning; sums to 1
function hitFrame(k: number, frames: number) {
  if (frames !== HIT_TIMING.length) return Math.min(frames - 1, Math.floor(k * frames)); // other sheets: even
  for (let i = 0, acc = 0; i < frames; i++) if (k < (acc += HIT_TIMING[i])) return i;
  return frames - 1;
}
const sheets: Partial<Record<SideFrame, { tex: THREE.Texture; meta: SheetMeta }>> = {};
// only the sheets that exist (public/sprites/anim): probing others logged 404s in the console
for (const f of ['walk', 'hit'] as SideFrame[]) {
  fetch(`sprites/anim/${f}.json`).then((r) => (r.ok ? r.json() : null)).then((meta: SheetMeta | null) => {
    if (!meta) return;
    texLoader.load(`sprites/anim/${f}-sheet.png`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.repeat.x = 1 / meta.frames;
      renderer.initTexture(tex); // upload now: the first swing hitched ~100ms uploading the sheet
      sheets[f] = { tex, meta };
      sideFrame = null; // re-apply with the sheet
    });
  }).catch(() => { /* no sheet: single image */ });
}
let sheetClock = 0;
// dev: what the hero card shows this frame (frame name, visible, sheet column) for timing checks
if (import.meta.env.DEV) (window as unknown as { __side: () => unknown }).__side = () =>
  ({ f: sideFrame, vis: sideCard.visible, rig: rig.visible, w: +(sideCard.scale.x / (sideW || 1)).toFixed(2), rw: +rig.scale.x.toFixed(2), col: sideMat.map ? Math.round(sideMat.map.offset.x * 7) : -1, hitAnimT, swingT });
let sideFrame: SideFrame | null = null;
let sideW = 1, sideX = 0; // the current frame's unmirrored width and x offset
function showSide(f: SideFrame) {
  const sheet = sheets[f];
  const tex = sheet?.tex ?? sideTex[f];
  if (!tex) return false;
  if (sheet) {
    const n = sheet.meta.frames, ref = sheet.meta.boxes ? 1 : 0; // skip the reference frame
    // the hit sheet plays once per swing, by swing progress; others loop on the clock
    const i = f === 'hit' ? ref + hitFrame(1 - hitAnimT / HIT_ANIM, n - ref)
      : ref + (Math.floor(sheetClock * sheet.meta.fps) % (n - ref));
    tex.offset.x = i / n;
  }
  if (sideFrame !== f) {
    sideFrame = f;
    sideMat.map = tex;
    // Strike frames reach into the neighbouring cell: depth-tested, the hammer head sat behind
    // that block's front face and vanished, so only the body showed. Draw them over the board.
    const striking = f === 'hit' || f === 'slam' || f === 'up';
    // (transparent too: only the transparent pass is drawn after the see-through cell backing,
    // which otherwise painted over the body; alphaTest still gives crisp edges)
    sideMat.depthTest = !striking;
    sideMat.transparent = striking;
    sideCard.renderOrder = striking ? 20 : 0;
    sideMat.needsUpdate = true;
    const { width, height } = sheet ? sheet.meta : (tex.image as HTMLImageElement);
    // same height as the front sprite; the wide hit pose keeps its body over the cell by anchoring
    // the body (not the image centre) at the mole: shift right by the extra width
    // the wind-up's raised hammer makes its image taller than the body: scale it up so the puppy
    // keeps the standing pose's size (measured on the 1254px sources: body 1070 vs 1140px, crop
    // 1165 vs 1140px), and pull it left since the body sits right of the image centre
    // 'up': the hammer above the head takes the top ~20% of the image; body measured 403 vs the
    // slam frame's 470px, so scale up to keep the puppy the same size
    // 'fall': raised arms + hammer take the top of the image; body ~430 of 512px vs ~505 standing
    let h = SPRITE_H * (f === 'windup' ? 1.09 : f === 'up' ? 1.17 : f === 'fall' ? 1.12 : f === 'dizzy' ? 1.04 : 1), w = h * (width / height), y = h / 2; // dizzy: matched by head width (250 vs 260px)
    sideX = f === 'hit' ? (w - h * 0.52) * 0.35 : f === 'windup' ? -0.08 * w : 0;
    const box = sheet?.meta.boxes?.[0];
    if (box) {
      // match the reference frame's body height and feet to the stand sprite's
      h = SPRITE_H * STAND_BODY.h / ((box[3] - box[1]) / height);
      w = h * (width / height);
      y = h / 2 - h * ((height - 1 - box[3]) / height) + SPRITE_H * STAND_BODY.gap;
      sideX = SPRITE_H * STAND_BODY.aspect * STAND_BODY.feet - w * (box[4] / width - 0.5);
    }
    sideW = w;
    sideCard.scale.set(w, h, 1);
    // z: the hit pose's hammer head must sit in front of the struck block's face
    sideCard.position.set(sideX, y, f === 'hit' || f === 'slam' || f === 'up' ? 0.3 : 0.01);
  }
  return true;
}
let sideWalkT = 0;
// Side drilling: the drill sits in the reaching hand (child of armR, so it follows the arm and
// the mirror); up/down drilling keeps the centred drill card below/above the hero.
const handDrill = drillCard.clone();
// z 0.3 lifts it in front of the neighbouring block's face (z 0.47), so the bit reads as biting in
handDrill.position.set((276 - 229) * kPx, -(330 - 268) * kPx, 0.3); // the right paw in arm space
handDrill.position.x -= 0.02;
handDrill.visible = false;
joints.armR.add(handDrill);
// Hammer swing: 0 = resting slightly raised; a hit plays raise-then-strike over SWING_TIME.
const SWING_TIME = new URLSearchParams(location.search).has("slowswing") ? 1.6 : 0.16; // ?slowswing: dev review
let swingT = 0, lastSwingAt = -Infinity;
function swingAngle() {
  if (swingT <= 0) return 0.35;
  const k = 1 - swingT / SWING_TIME; // 0 → 1
  return k < 0.35 ? 0.35 + (k / 0.35) * 1.0 : 1.35 - ((k - 0.35) / 0.65) * 1.75; // wind up, then strike past level
}
let hammerAngle = 1.45;
let walkPhase = 0;
let wasFalling = false;
// Crushed: the hero sits dizzy (stars, swirly eyes) for CRUSH_TIME, with only a short impact
// squash. Squashing the single-image sprite to 35% height read as a smeared, warped picture
// (owner report). Any step or swing ends it early.
const CRUSH_TIME = 1.0, CRUSH_HIT = 0.15; // s, our tuning
let crushT = 0, crushX = -1, crushY = -1;
let spriteFlip = 1, spriteAspect = 1;
let rigFlip = 1; // target mirror: 1 facing right, -1 facing left (up/down keep the last side)
// Turning: the mirror flips at once and the width only dips to TURN_MIN and springs back. The old
// paper-flip eased through zero width, so for a few frames the hero was a paper-thin sliver
// (owner report). TURN_TIME/TURN_MIN are our tuning.
const TURN_TIME = 0.09, TURN_MIN = 0.7;
let turnT = 0, lastFlip = 1;
const turnWidth = () => 1 - (1 - TURN_MIN) * (turnT / TURN_TIME);
const ease = (o: THREE.Object3D, target: number, k = 0.3) => { o.rotation.z += (target - o.rotation.z) * k; };

// ---- puppy cosmetics: badge rewards worn on the sprite (studio review 2 item 15) ----
// Lightweight on purpose: one inked card per worn slot, drawn once per piece and laid over the
// flat hero at fixed spots measured on puppy-flat.png (feet pivot, world units). A hammer piece
// repaints the hammer card's head instead. Side frames draw their own hammer, so it shows on the
// front rig only (our choice: no extra sprite art).
type WearSlot = Exclude<CosmeticSlot, 'hammer'>;
// [centre y, width, height]: the head top is ~1.02, the eyes ~0.76, the hood collar ~0.58
const WEAR_AT: Record<string, [number, number, number]> = {
  beanie: [0.95, 0.44, 0.28], earmuffs: [0.86, 0.62, 0.36], 'crown-ice': [1.04, 0.32, 0.2],
  goggles: [0.76, 0.44, 0.17], 'scarf-red': [0.55, 0.44, 0.24], 'scarf-stripe': [0.55, 0.44, 0.24],
};
function wearTex(c: Cosmetic) {
  return canvasTex(256, 160, (g) => {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = INK;
    g.lineWidth = 8;
    g.fillStyle = c.color;
    const shape = (draw: () => void) => { g.beginPath(); draw(); g.fill(); g.stroke(); };
    if (c.slot === 'neck') {
      shape(() => g.roundRect(14, 30, 228, 52, 26)); // the wrap
      shape(() => g.roundRect(150, 60, 46, 92, 16)); // the hanging tail
      if (c.id === 'scarf-stripe') {
        g.fillStyle = '#fdf6e3';
        for (const x of [60, 110, 160, 210]) g.fillRect(x, 36, 16, 40);
        g.fillRect(156, 100, 34, 14);
      }
    } else if (c.id === 'beanie') {
      shape(() => { g.moveTo(24, 132); g.quadraticCurveTo(28, 34, 128, 32); g.quadraticCurveTo(228, 34, 232, 132); g.closePath(); });
      g.fillStyle = '#fdf6e3';
      shape(() => g.roundRect(16, 112, 224, 38, 18)); // folded brim
      shape(() => g.arc(128, 30, 22, 0, Math.PI * 2)); // pompom
    } else if (c.id === 'earmuffs') {
      g.lineWidth = 14;
      g.beginPath();
      g.arc(128, 128, 96, Math.PI * 1.08, Math.PI * 1.92); // the band over the head
      g.stroke();
      g.lineWidth = 8;
      for (const x of [34, 222]) shape(() => g.arc(x, 112, 32, 0, Math.PI * 2));
    } else if (c.id === 'crown-ice') {
      shape(() => {
        g.moveTo(30, 150); g.lineTo(22, 40); g.lineTo(78, 96); g.lineTo(128, 12);
        g.lineTo(178, 96); g.lineTo(234, 40); g.lineTo(226, 150); g.closePath();
      });
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(110, 70, 14, 50);
    } else if (c.id === 'goggles') {
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(6, 80); g.lineTo(250, 80); // strap
      g.stroke();
      g.lineWidth = 8;
      for (const x of [78, 178]) {
        g.fillStyle = c.color;
        shape(() => g.arc(x, 80, 44, 0, Math.PI * 2));
        g.fillStyle = 'rgba(190,240,255,0.95)';
        shape(() => g.arc(x, 80, 28, 0, Math.PI * 2));
      }
    }
  });
}
const wear = new THREE.Group(); // mirrored with the hero; holds one card per worn slot
wear.position.z = 0.33; // over the sprite and the hand hammer (z 0.3)
wear.visible = false; // until the hero sprite has loaded (syncMole)
spriteRig.add(wear);
const wearCards: Partial<Record<WearSlot, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>> = {};
const wearMats: THREE.MeshBasicMaterial[] = [];
const hammerTexes = new Map<string, THREE.Texture>([['', drillTex]]);
// re-dress the hero from the saved outfit (start, and after each change in the book)
function applyCosmetics() {
  const worn = equippedCosmetics(progress);
  for (const slot of ['head', 'neck', 'face'] as WearSlot[]) {
    const c = worn[slot];
    let card = wearCards[slot];
    if (!c || !WEAR_AT[c.id]) { if (card) card.visible = false; continue; }
    if (!card) {
      const mat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
      card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      card.position.z = slot === 'head' ? 0.002 : 0; // a hat over goggles, never the other way
      wearCards[slot] = card;
      wearMats.push(mat);
      wear.add(card);
    }
    if (card.userData.id !== c.id) {
      card.material.map?.dispose();
      const tex = wearTex(c);
      tex.wrapT = THREE.ClampToEdgeWrapping;
      card.material.map = tex;
      card.material.needsUpdate = true;
      card.userData.id = c.id;
      const [y, w, h] = WEAR_AT[c.id];
      card.position.y = y;
      card.scale.set(w, h, 1);
    }
    card.visible = true;
  }
  const hammer = worn.hammer?.color ?? '';
  if (!hammerTexes.has(hammer)) hammerTexes.set(hammer, hammerTex(hammer));
  const hm = drillCard.material as THREE.MeshBasicMaterial; // shared with the hand hammer clone
  hm.map = hammerTexes.get(hammer)!;
  hm.needsUpdate = true;
}

setStyle(styleIndex);
window.addEventListener('keydown', (e) => { if (e.key === 'c' || e.key === 'C') setStyle(styleIndex + 1); });

// Pixel render mode (press P, or ?pixel=1): draw the 3D world into a low-resolution buffer and
// upscale it with hard pixels, so a pixel-art hero and the world share one look. HUD stays crisp.
// 240 lines left the hero ~23px tall with no readable face; the user found 360 still too
// coarse, so the default is 480 (hero ~46px tall) with room up to 720.
const PIXEL_STEPS = [240, 300, 360, 480, 540, 640, 720];
let pixelStep = 3;
const renderLabel = document.getElementById('render-label');
let pixelMode = new URLSearchParams(location.search).get('pixel') === '1';
function applyRenderScale() {
  const h = H || window.innerHeight;
  const lines = PIXEL_STEPS[pixelStep];
  renderer.setPixelRatio(pixelMode ? lines / h : Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W || window.innerWidth, h, false);
  canvas.style.imageRendering = pixelMode ? 'pixelated' : 'auto';
  if (renderLabel) renderLabel.textContent = `화면: ${pixelMode ? `픽셀 렌더링 (세로 ${lines}줄, [ ]로 조절)` : '일반 렌더링'} (P로 바꾸기)`;
}
function setPixelMode(on: boolean) {
  pixelMode = on;
  applyRenderScale();
  const pixelStyle = STYLES.findIndex((st) => st.id === 'pixel');
  if (on && styleIndex !== pixelStyle) setStyle(pixelStyle);
}
if (pixelMode) setPixelMode(true);
window.addEventListener('keydown', (e) => {
  // dev only (?dev, as the hint says): for players P opens the pause menu
  if ((e.key === 'p' || e.key === 'P') && document.body.classList.contains('dev')) setPixelMode(!pixelMode);
  if (!pixelMode || (e.key !== '[' && e.key !== ']')) return;
  pixelStep = Math.max(0, Math.min(PIXEL_STEPS.length - 1, pixelStep + (e.key === ']' ? 1 : -1)));
  applyRenderScale();
});

let lastMoleX = 0, lastMoleY = 0, hop = 0;
let stepX = -1; // column the step sound last saw

// Headlamp pool: a warm glow on the backdrop behind the hero, stronger as the cave darkens
// (the "one warm light in a cold world" that made the reference feel cohesive).
const lampGlowTex = canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,214,150,0.85)');
  r.addColorStop(0.4, 'rgba(255,190,120,0.35)');
  r.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
});
lampGlowTex.wrapT = THREE.ClampToEdgeWrapping;
const lampGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2),
  new THREE.MeshBasicMaterial({ map: lampGlowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
lampGlow.position.z = -0.9; // behind the board, in front of the shadows' backdrop
scene.add(lampGlow);

// ---- pop flashes: an inked star burst per popped cell that grows and fades ----
const burstTex = canvasTex(128, 128, (g) => {
  g.translate(64, 64);
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? 26 : 58;
    const a = (i / 16) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.stroke();
});
burstTex.wrapT = THREE.ClampToEdgeWrapping;
interface Flash { x: number; y: number; life: number; color: string; size?: number }
let flashes: Flash[] = [];
const FLASH_MAX = 120;
const FLASH_LIFE = 0.32;
const flashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: burstTex, transparent: true, depthWrite: false, fog: false }), FLASH_MAX);
flashMesh.frustumCulled = false;
scene.add(flashMesh);
const shardTex = canvasTex(64, 64, (g) => {
  g.lineJoin = 'round';
  g.fillStyle = '#ffffff';
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(32, 6);
  g.lineTo(56, 26);
  g.lineTo(44, 58);
  g.lineTo(12, 50);
  g.lineTo(8, 20);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.0)';
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(20, 22);
  g.lineTo(30, 16);
  g.stroke();
});
shardTex.wrapT = THREE.ClampToEdgeWrapping;

// Shatter: a removed cell breaks into small irregular inked chips in its colour that burst out,
// spin and fall (the owner preferred breaking over shrinking; square quarter-tiles read as tiles
// sliding apart, not ice breaking).
interface Shard { x: number; y: number; z: number; vx: number; vy: number; vz: number; rot: number; spin: number; life: number; color: string; size: number }
let ghosts: Shard[] = [];
const GHOST_LIFE = 0.42, GHOST_MAX = 640;
const ghostMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: shardTex, alphaTest: 0.5, side: THREE.DoubleSide, fog: false }), GHOST_MAX);
ghostMesh.frustumCulled = false;
scene.add(ghostMesh);
function addGhosts(cells: { x: number; y: number; color: number }[]) {
  // big chunks would bury the hero in debris: fewer, quicker pieces per cell
  const big = cells.length > 6;
  const per = big ? 3 : 6;
  for (const c of cells) {
    for (let k = 0; k < per; k++) {
      if (ghosts.length >= GHOST_MAX) return;
      const a = (k / per) * Math.PI * 2 + Math.random() * 0.8;
      const sp = 1.6 + Math.random() * 2.2;
      ghosts.push({
        x: wx(c.x) + Math.cos(a) * 0.2, y: wy(c.y) + Math.sin(a) * 0.2, z: 0.5,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 2.2, vz: 0,
        rot: Math.random() * 6, spin: (Math.random() - 0.5) * 16, life: GHOST_LIFE * (big ? 0.7 : 1) * (0.8 + Math.random() * 0.4),
        color: colorOf(c.color, c.y), size: 0.2 + Math.random() * 0.22,
      });
    }
  }
}
function syncGhosts(dt: number) {
  ghosts = ghosts.filter((g) => (g.life -= dt) > 0);
  ghosts.forEach((g, i) => {
    g.vy -= 18 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    g.rot += g.spin * dt;
    const k = Math.min(1, g.life / 0.12); // shrink only in the last moment
    tmp.position.set(g.x, g.y, g.z);
    tmp.rotation.set(0, 0, g.rot);
    tmp.scale.setScalar(k * g.size);
    tmp.updateMatrix();
    ghostMesh.setMatrixAt(i, tmp.matrix);
    ghostMesh.setColorAt(i, tmpColor.set(g.color));
  });
  ghostMesh.count = ghosts.length;
  ghostMesh.instanceMatrix.needsUpdate = true;
  if (ghostMesh.instanceColor) ghostMesh.instanceColor.needsUpdate = true;
}

function syncFlashes(dt: number) {
  flashes = flashes.filter((f) => (f.life -= dt) > 0);
  flashes.forEach((f, i) => {
    const k = 1 - f.life / FLASH_LIFE; // 0 → 1
    tmp.position.set(wx(f.x), wy(f.y), 0.6);
    tmp.rotation.set(0, 0, k * 0.6);
    tmp.scale.setScalar((k < 0.35 ? 0.3 + (k / 0.35) * 0.9 : 1.2 - (k - 0.35) * 0.9) * (f.size ?? 1)); // pop in, then shrink away
    tmp.updateMatrix();
    flashMesh.setMatrixAt(i, tmp.matrix);
    flashMesh.setColorAt(i, tmpColor.set('#fdf6e3')); // cream; the texture carries the navy ink
  });
  flashMesh.count = flashes.length;
  flashMesh.instanceMatrix.needsUpdate = true;
  if (flashMesh.instanceColor) flashMesh.instanceColor.needsUpdate = true;
  (flashMesh.material as THREE.MeshBasicMaterial).opacity = 1;
}

// ---- snow puffs kicked up at the feet when stepping or landing ----
interface Puff { x: number; y: number; vx: number; life: number; max: number }
let puffs: Puff[] = [];
const PUFF_MAX = 40;
const puffMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.3, 0.3),
  new THREE.MeshBasicMaterial({ map: flakeTex, color: '#f4f8ff', transparent: true, opacity: 0.7, depthWrite: false, fog: false }),
  PUFF_MAX);
puffMesh.frustumCulled = false;
scene.add(puffMesh);
// short white breaths from the muzzle while gasping for air
let breathT = 0;
function breathe(dt: number) {
  if (game.air >= AIR_WARNING || game.state !== 'playing') return;
  breathT -= dt;
  if (breathT > 0) return;
  breathT = 0.5 + game.air / 100;
  // the heartbeat and the red vignette pulse ride the same beat as the breath puffs
  sfxHeartbeat();
  beat = 1;
  if (puffs.length >= PUFF_MAX) return;
  const side = rigFlip;
  puffs.push({ x: mole.position.x + side * 0.12, y: mole.position.y + 0.55, vx: side * 0.6, life: 0.5, max: 0.5 });
}
function kickPuffs(n: number) {
  for (let i = 0; i < n && puffs.length < PUFF_MAX; i++) {
    const max = 0.35 + Math.random() * 0.2;
    puffs.push({ x: mole.position.x + (Math.random() - 0.5) * 0.4, y: mole.position.y - 0.45, vx: (Math.random() - 0.5) * 1.6, life: max, max });
  }
}
function syncPuffs(dt: number) {
  puffs = puffs.filter((p) => (p.life -= dt) > 0);
  puffs.forEach((p, i) => {
    const k = 1 - p.life / p.max;
    p.x += p.vx * dt;
    tmp.position.set(p.x, p.y + k * 0.18, 0.6); // in front of block faces (z 0.47), or breaths hide behind the cell above
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(0.6 + k * 0.9);
    tmp.updateMatrix();
    puffMesh.setMatrixAt(i, tmp.matrix);
    puffMesh.setColorAt(i, tmpColor.set('#f4f8ff').lerp(new THREE.Color('#9fb7d8'), k)); // cream, cooling as it fades
  });
  puffMesh.count = puffs.length;
  puffMesh.instanceMatrix.needsUpdate = true;
  if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true;
}

// ---- particles ----
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; color: string; spin: number }
let particles: Particle[] = [];
const PMAX = 500;
// Shards are flat inked ice chips (white chip, ink rim) tinted per instance — the same 2D card
// language as the hero and drill, instead of lit 3D octahedrons.
const parts = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.28),
  new THREE.MeshBasicMaterial({ map: shardTex, alphaTest: 0.5, side: THREE.DoubleSide, fog: false }), PMAX);
parts.castShadow = true;
parts.frustumCulled = false;
scene.add(parts);

interface Floater { x: number; y: number; text: string; life: number; color: string; age?: number }
let floaters: Floater[] = [];
// shield ring: an expanding white circle where the respawn shield shattered a block
interface Ring { x: number; y: number; life: number }
let rings: Ring[] = [];
// Impact stars (playtest: breaking lacked punch): at the struck face, a white flash card and a
// comic burst of rays, ~0.12s. Drawn on the fx canvas, pooled.
interface Impact { x: number; y: number; life: number; size: number; rot: number }
const IMPACT_LIFE = 0.13;
let impacts: Impact[] = [];
const RING_LIFE = 0.35;
const COMBO_COLOR = '#ff9ad5'; // pink: apart from chain gold and air blue

// ---- game state & HUD (copied from main.ts) ----
const $ = (id: string) => document.getElementById(id)!;
// a tag with an optional class and text, for the result card's small parts
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}
const livesEl = $('lives'), scoreEl = $('score'), depthM = $('depth-m'), depthLv = $('depth-lv');
const airEl = $('air'), airRow = $('air-row'), airIcon = $('air-icon'), airFill = $('air-fill'), airText = $('air-text');
const overlay = $('overlay'), overlayTitle = $('overlay-title'), overlayStats = $('overlay-stats');

let game: Game;
let view = { x: 0, y: 0 };
let camY = 0;
let shake = 0;
let shakeT = 0; // phase clock for the damped shake oscillation
// Hammer feel (review item 4): a tiny push of camera and hero toward the struck face, and the
// hero alone holding the impact pose for a beat while the world keeps moving.
let kickX = 0, kickY = 0;
let heroFreeze = 0;
const KICK = 0.05; // world units, our tuning
const HERO_FREEZE = 0.05; // s, our tuning
// Input buffer: a press that came a moment too early (hammer still swinging, target or the way
// still falling) is retried every frame for a short window instead of being dropped. Only those:
// a swing at air or a step into a resting block is a decision, and retrying it later turned a
// whiff into a real swing or a "turn to face, then drill" into a step under a released stack
// (bug review 1-2). A buffered swing is also dropped once the hero moves or turns.
const DRILL_BUFFER = 0.12, MOVE_BUFFER = 0.1; // s, our tuning
let drillBuf = 0, drillBufAt = '';
let moveBuf = 0, moveBufDir: Dir = 'left';
const moleAt = () => `${game.mole.x},${game.mole.y},${game.mole.facing}`;
let paused = false;
let beat = 0; // 1 on each low-air heartbeat, decaying: drives the red vignette pulse
let wobbleNear = -1; // progress 0..1 of the most advanced wobbling block near the hero (-1: none)
let wobbleTickT = 0;
// sub: the tutorial stage's prompt for this level (StageInfo.levelPromptsKo), under the title
let banner: { text: string; life: number; sub?: string } | null = null;
const PROMPT_LIFE = 4.5; // s: long enough to read one sentence (our tuning)
// banner for entering level n: the tutorial prompt rides along when the stage has one
// (a dry aurora level says so instead: item 13)
function levelBanner(text: string, level: number, life: number) {
  const prompt = currentStage.levelPromptsKo?.[level - 1] || undefined;
  if (prompt) for (const k of tipsIn(prompt)) markSeen(k); // the prompt taught it: no tip later
  const sub = prompt ?? (isDryLevel(currentStage.def, level) ? DRY_KO : undefined);
  banner = { text, life: sub ? PROMPT_LIFE : life, sub };
}
const DRY_KO = '캡슐 적은 층 · 공기를 아껴요';
let levelWipe = 0; // seconds left of the level-transition aurora sweep
let paceCueLevel = 0; // level whose speed-up cue has played
let hitStop = 0; // seconds the simulation holds still after a big chain pop
let W = 0, H = 0;
let lastW = -1, lastH = -1, lastDpr = -1; // last applied viewport (resize skips repeats)

const held = new Map<Dir, number>();
let drillHeld = false;

// Dev aid for visual review: ?depth=150 starts the hero at that depth (cells around it cleared).
const startDepth = Number(new URLSearchParams(location.search).get('depth')) || 0;
// Stage: ?stage=<id> (dev) or the title list; defaults to the furthest unlocked stage.
let progress = loadProgress();
// default selection: the first unlocked stage not yet cleared (review: "last unlocked" jumped to
// the endless side mode as soon as it opened)
const firstOpen = () => STAGES.find((st) => isUnlocked(progress, st.def.id) && !st.def.endless && (progress[st.def.id]?.medal ?? 'none') === 'none')
  ?? [...STAGES].reverse().find((st) => isUnlocked(progress, st.def.id)) ?? STAGES[0];
let currentStage: StageInfo = stageById(new URLSearchParams(location.search).get('stage') ?? '') ?? firstOpen();
applyCosmetics();

function reset() {
  game = createGame(currentStage.def.seed ?? Date.now(), currentStage.def); // fixed courses replay the same board
  loadGhost();
  drawGoalBanner(stageDepth(currentStage.def));
  placeGoalFloor(game.rows);
  goalFloor.visible = !currentStage.def.endless; // survival has no bottom
  if (startDepth > 0) {
    ensureRows(game, SKY_ROWS - 1 + startDepth); // endless boards grow to the requested depth first
    const y = Math.min(game.rows - 2, SKY_ROWS - 1 + startDepth);
    game.mole.y = y;
    game.cells[y * game.cols + game.mole.x] = null;
    game.level = levelIn(startDepth, game.levels.length);
    game.mole.invuln = 4; // the cell above has just lost its support; don't start by getting crushed
  }
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game; // dev: inspect state in review
  view = { x: game.mole.x, y: game.mole.y };
  camY = targetCam();
  props?.reset(); // the flock goes back to the base penguin (once the last run's is out of view)
  particles = [];
  floaters = [];
  rings = [];
  impacts = [];
  flashes = [];
  ghosts = [];
  puffs = [];
  banner = null;
  if (started) levelBanner('LEVEL 1', 1, 1.6); // with the tutorial prompt, as on the first start
  held.clear();
  drillHeld = false;
  drillBuf = moveBuf = 0;
  stepX = game.mole.x; // no step sound for the jump back to the start column (bug review 8)
  clearToasts();
  if (started) stageBlurb(); // a restart shows the stage's rule again (bug review 6)
  hitStop = heroFreeze = kickX = kickY = shake = beat = paceCueLevel = 0;
  metricT = dryWarned = 0;
  overlay.hidden = true;
  setPaused(false);
}

function resize() {
  // the visible viewport (iOS: excludes the browser toolbars); both canvases get exactly this CSS
  // size so the WebGL frame, the fx overlay and the HTML HUD line up
  const vv = window.visualViewport;
  W = Math.round(vv?.width ?? window.innerWidth);
  H = Math.round(vv?.height ?? window.innerHeight);
  if (W === lastW && H === lastH && (window.devicePixelRatio || 1) === lastDpr) return; // iOS fires resize in bursts
  lastW = W; lastH = H; lastDpr = window.devicePixelRatio || 1;
  for (const c of [canvas, fx]) { c.style.width = `${W}px`; c.style.height = `${H}px`; }
  applyRenderScale();
  const dpr = window.devicePixelRatio || 1;
  fx.width = Math.floor(W * dpr);
  fx.height = Math.floor(H * dpr);
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resetFxText(); // resizing the canvas reset the context state
  buildVignettes();
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  baseProjection.copy(camera.projectionMatrix);
  fitCliffs();
}

const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
let wideShot = 1; // 1 = wide establishing framing (title / results), 0 = play framing
function camDistance() {
  // fit VIEW_ROWS vertically, and at least 11 columns horizontally on narrow screens
  // Wide screens: 9 columns plus ~2.1 cells of painted cliff per side, as framed in the mockup.
  // Portrait phones: fitting that much width showed 25+ tiny rows, so the board nearly fills the
  // width and only a sliver of cliff remains (how Mr. Driller frames it on phones).
  // Off-play (title, result card) portrait phones pull back to the wide framing so the camp, the
  // penguin flock and the cliff props are on screen at least there (wideShot eases 0 → 1).
  const width = camera.aspect < 0.8 ? 9.7 + (16.8 - 9.7) * wideShot : 13.2; // 16.8: the whole flock, x -3.7..12.1
  return Math.max(VIEW_ROWS / (2 * halfTan), width / camera.aspect / (2 * halfTan));
}
function targetCam() {
  // portrait title: look a little lower so the snowline (camp, flock) sits just under the logo and
  // the docked stage list keeps the lower half (3d.html @media max-aspect-ratio 4/5)
  const titleDrop = !started && camera.aspect < 0.8 ? 2.2 : 0; // world units, our tuning
  return Math.min(-SKY_ROWS + 3, -view.y - 1.2) - titleDrop; // keep the mole a bit above centre
}

const MOVE_DELAY = 0.2, MOVE_RATE = 0.11;
const KEYS: Record<string, Dir> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
};
const DRILL_KEYS = new Set([' ', 'z', 'Z', 'j', 'J']);
// move() reports nothing, so a step counts as taken when the mole's cell changed
function tryMove(dir: Dir) {
  const { x, y } = game.mole;
  move(game, dir);
  return game.mole.x !== x || game.mole.y !== y;
}
// A sideways step that failed only because a cell on the way is still falling past: it clears by
// itself, so the press is worth retrying. A resting block in the way is a turn, not a step.
function stepWaitsOnFall(dir: Dir) {
  const { x, y } = game.mole;
  const nx = x + (dir === 'left' ? -1 : 1);
  if (nx < 0 || nx >= game.cols) return false;
  return [cellAt(game, nx, y), cellAt(game, x, y - 1), cellAt(game, nx, y - 1)].some((c) => !!c?.falling);
}
function pressDir(dir: Dir) {
  if (held.has(dir)) return;
  held.set(dir, MOVE_DELAY);
  moveBuf = 0;
  // every press calls move(): for up/down that is what turns the hero to face it (skipping it
  // left the hammer aimed sideways after a side hit). Only sideways steps are buffered.
  const stepped = tryMove(dir);
  if ((dir === 'left' || dir === 'right') && !stepped && stepWaitsOnFall(dir)) { moveBuf = MOVE_BUFFER; moveBufDir = dir; }
}
// every swing that connects: hammer knock + a short buzz (the break/chip sounds come from events).
// quiet: a held key or buffered retry, which must never whiff (only a fresh press swings at air).
function tryDrill(quiet = false): DrillResult {
  const r = drill(game, { quiet });
  if (r !== 'hit') return r;
  drillBuf = moveBuf = 0; // a landed swing settles both buffers: no step into the hole it made
  sfxHammer();
  vibrate(8);
  return r;
}
function pressDrill() {
  drillHeld = true;
  moveBuf = 0; // the player chose to swing: a pending step must not follow it
  const r = tryDrill();
  if (r === 'cooldown' || r === 'falling') { drillBuf = DRILL_BUFFER; drillBufAt = moleAt(); }
}
// Haptics (item 14): guarded, since desktop and iOS Safari have no navigator.vibrate.
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const CRUSH_BUZZ = [40, 30, 80]; // ms on/off/on, our tuning
function vibrate(pattern: number | number[]) {
  if (!canVibrate) return;
  try { navigator.vibrate(pattern); } catch { /* blocked without a user gesture */ }
}
function releaseDir(dir: Dir) {
  held.delete(dir);
  const last = [...held.keys()].at(-1);
  if (last) game.mole.facing = last;
}
// Title card: the run waits on the surface scene until the first key or tap. Dev ?depth starts
// skip it so visual review lands straight in the shaft.
const title = document.getElementById('title');
let started = !!startDepth || !title;
if (started && title) title.hidden = true;
document.body.classList.toggle('on-title', !started);
// Stage list on the title card: arrows choose, Space/Enter starts, or tap a stage. Row 0 is
// today's daily course (item 13), then the stages.
const stageList = document.getElementById('stage-list');
const collectionEl = document.getElementById('collection');
const starsTotalEl = document.getElementById('stars-total');
// Stars are the only medal language on screen (owner: medals + stars said the same thing twice):
// bronze/silver/gold = ★1/★2/★3. Medal ids stay in the data for save compatibility.
const MEDAL_ICON: Record<Medal, string> = { none: '', bronze: '★', silver: '★★', gold: '★★★' };
const MEDAL_KO: Record<Medal, string> = { none: '—', bronze: '★☆☆', silver: '★★☆', gold: '★★★' };
const stars = (m: Medal | undefined) => '★'.repeat(medalStars(m)) + '☆'.repeat(3 - medalStars(m));
// The daily opens once the tutorial is cleared: a first-day Saturday would otherwise hand a new
// player aurora's rules (our choice).
const dailyOpen = (p: Progress) => STAGES.some((st) => (p[st.def.id]?.medal ?? 'none') !== 'none');
const isOpen = (st: StageInfo) => (isDailyId(st.def.id) ? dailyOpen(progress) : isUnlocked(progress, st.def.id));
// the date a daily run belongs to, fixed when it starts (a run across midnight stays on its day)
let dailyDate = new Date();
const recordOf = (p: Progress, st: StageInfo): StageRecord | undefined =>
  isDailyId(st.def.id) ? dailyOf(p).days[dailyKey(dailyDate)] : p[st.def.id];
let entries: StageInfo[] = [];
const entryIndex = (st: StageInfo) => Math.max(0, entries.findIndex((e) => e.def.id === st.def.id));
function refreshEntries() {
  // a daily picked before midnight keeps its date until the player returns to the title
  if (!isDailyId(currentStage.def.id)) dailyDate = new Date();
  entries = [isDailyId(currentStage.def.id) ? currentStage : dailyStage(dailyDate, progress), ...STAGES];
}
// streak still alive: last played today or yesterday
function liveStreak(p: Progress): number {
  const book = dailyOf(p);
  const today = new Date(), yday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return book.last === dailyKey(today) || book.last === dailyKey(yday) ? book.streak : 0;
}
// ★1/★2/★3 conditions of the selected stage as chips, earned ones filled (review item 3, UI review 9)
const medalTiers = (st: StageInfo): [string, string | undefined][] => {
  const dm = st.depthMedals;
  return [
    ['★1', dm ? `${dm[0]}m 도달` : '클리어'],
    ['★2', dm ? `${dm[1]}m 도달` : st.silver?.textKo],
    ['★3', dm ? `${dm[2]}m 도달` : st.gold?.textKo],
  ];
};
function criteriaHtml(st: StageInfo, medal: Medal | undefined): string {
  const have = medalStars(medal);
  const rows = medalTiers(st).map(([icon, t], i) => t
    ? `<span class="tier${have > i ? ' got' : ''}"><span class="chip">${icon}</span><span class="t">${t}${have > i ? ' ✓' : ''}</span></span>` : ''); // ✓: earned in words too, not only by fill
  return `<span class="tiers">${rows.join('')}</span>`;
}
// Collapsed rows still name the medal to chase (from silver up: a clear is self-explanatory), so
// the goal is on show for every open stage, not only the selected one (design review 2, item 3).
function nextGoalHtml(st: StageInfo, medal: Medal | undefined): string {
  const tier = medalTiers(st)[Math.max(1, medalStars(medal))];
  return tier?.[1] ? `<small class="crit next">${tier[0]} ${tier[1]}</small>` : '';
}
function recordHtml(rec: StageRecord | undefined, prefix: string): string {
  if (rec?.bestTime !== undefined) return `<small class="best">${prefix}최단 ${rec.bestTime.toFixed(2)}초</small>`;
  if (rec?.bestScore) return `<small class="best">${prefix}최고 ${rec.bestScore.toLocaleString()} · ${rec.bestDepth}m</small>`;
  return '';
}
function renderStageList() {
  refreshEntries();
  if (collectionEl) {
    const s = statsOf(progress);
    collectionEl.hidden = false;
    // an icon button beside 🔊 (UI review 8): the badge count stays, the run totals live in the book
    collectionEl.innerHTML = `📖<span class="n">${s.badges.length}/${BADGES.length}</span>`;
    collectionEl.setAttribute('aria-label', `도감 · 배지 ${s.badges.length}/${BADGES.length}`);
  }
  if (starsTotalEl) starsTotalEl.textContent = `★ ${totalStars(progress)}/${maxStars()}`;
  if (!stageList) return;
  stageList.replaceChildren(...entries.map((st, i) => {
    const daily = isDailyId(st.def.id);
    const open = isOpen(st);
    const rec = recordOf(progress, st);
    const li = document.createElement('button');
    li.type = 'button';
    li.className = `stage${i === selected ? ' sel' : ''}${open ? '' : ' locked'}${daily ? ' daily' : ''}`;
    const streak = liveStreak(progress);
    const head = daily
      ? `<b>${open ? '☀️' : '🔒'} ${st.nameKo}</b> <span class="stars">${stars(rec?.medal)}</span>`
        + (streak ? `<span class="streak">🔥 ${streak}일</span>` : '')
      : `<b>${open ? '' : '🔒 '}${i}. ${st.nameKo}</b>`
        + `<span class="stars">${stars(rec?.medal)}</span>`;
    // compact rows; only the selected stage expands with its rule, medals and record
    const lockKo = daily ? '🔒 첫 스테이지를 클리어하면 열려요' : '🔒 앞 스테이지를 클리어하면 열려요';
    const detail = i !== selected ? (open ? nextGoalHtml(st, rec?.medal) : '')
      : open ? `<small>${st.blurbKo}</small>${criteriaHtml(st, rec?.medal)}${recordHtml(rec, daily ? '오늘 ' : '')}<span class="go">▶ 시작</span>`
        : `<small>${lockKo}</small>`;
    li.innerHTML = head + detail;
    // Tap picks (the row expands with its rule and stars, locked ones say why), a tap on the picked
    // row starts it. 'click' rather than pointerdown, so a finger scrolling the list on a small
    // phone never launches a stage.
    li.addEventListener('pointerdown', (e) => e.stopPropagation());
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      if (i !== selected) { selected = i; renderStageList(); }
      else if (open) chooseStage();
    });
    return li;
  }));
  stageList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
// Badge book (item 13): every badge with what it asks, earned ones lit, and the running totals.
// Three tabs (UI review 10) instead of one long scroll; the last tab sticks for the session.
const bookEl = document.getElementById('book');
const BOOK_TABS = ['badges', 'wear', 'days'] as const;
let bookTab = 0;
function showBookTab(i: number, focus = false) {
  bookTab = (i + BOOK_TABS.length) % BOOK_TABS.length;
  BOOK_TABS.forEach((id, k) => {
    const tab = document.getElementById(`book-tab-${id}`);
    const pane = document.getElementById(`book-pane-${id}`);
    tab?.setAttribute('aria-selected', String(k === bookTab));
    tab?.setAttribute('tabindex', k === bookTab ? '0' : '-1');
    if (pane) pane.hidden = k !== bookTab;
    if (k === bookTab && focus) tab?.focus({ preventScroll: true });
  });
}
BOOK_TABS.forEach((id, k) => {
  document.getElementById(`book-tab-${id}`)?.addEventListener('click', () => showBookTab(k));
});
function openBook() {
  if (!bookEl) return;
  const s = statsOf(progress);
  const book = dailyOf(progress);
  const totals = document.getElementById('book-totals');
  if (totals) {
    totals.textContent = `${s.runs}판 · 총 깊이 ${s.totalDepth.toLocaleString()}m · 구출한 친구 ${s.friendsRescued}마리 · `
      + `최고 연쇄 ${s.bestChain} · 최고 콤보 ×${s.bestCombo} · 최장 연속 ${book.bestStreak}일 · ★ ${totalStars(progress)}/${maxStars()}`;
  }
  // the last 14 days of the daily course, today last (item 14)
  document.getElementById('book-days')?.replaceChildren(...dailyHistory(progress, new Date()).map((d) => {
    const cell = document.createElement('span');
    cell.className = `day${d.today ? ' today' : ''}${d.record ? ' played' : ''}`;
    cell.title = d.record ? `${d.date.getMonth() + 1}/${d.date.getDate()} · ${d.record.bestDepth}m` : `${d.date.getMonth() + 1}/${d.date.getDate()}`;
    cell.innerHTML = `<b>${d.date.getDate()}</b>${d.record ? MEDAL_ICON[d.medal] || '❌' : '·'}`;
    return cell;
  }));
  renderWear();
  const list = document.getElementById('book-list');
  list?.replaceChildren(...BADGES.map((b) => {
    const got = s.badges.includes(b.id);
    const gift = cosmeticForBadge(b.id);
    const li = document.createElement('li');
    li.className = got ? 'got' : 'locked';
    li.innerHTML = `<b>${got ? '🏅' : '🔒'} ${b.nameKo}</b><small>${b.descKo}${gift ? ` · 🎁 ${gift.nameKo}` : ''}</small>`;
    return li;
  }));
  bookEl.hidden = false;
  showBookTab(bookTab, true); // focus into the dialog, so Enter never presses a stage row behind it
}
// Puppy outfits (item 15): every piece, owned ones tap to wear or take off (one per slot).
const SLOT_KO: Record<CosmeticSlot, string> = { head: '머리', neck: '목', face: '얼굴', hammer: '망치' };
function renderWear() {
  const owned = new Set(unlockedCosmetics(progress).map((c) => c.id));
  const worn = equippedCosmetics(progress);
  document.getElementById('book-wear')?.replaceChildren(...COSMETICS.map((c) => {
    const li = document.createElement('li');
    const on = worn[c.slot]?.id === c.id;
    li.className = `${owned.has(c.id) ? 'got' : 'locked'}${on ? ' on' : ''}`;
    const badge = BADGES.find((b) => b.id === c.badge);
    // locked: a silhouette swatch (CSS) and the badge plus what it asks, so the goal is right there
    li.innerHTML = `<b><i style="background:${c.color}"></i>${owned.has(c.id) ? '' : '🔒 '}${c.nameKo}</b>`
      + `<small>${SLOT_KO[c.slot]} · ${owned.has(c.id) ? (on ? '✓ 입는 중 · 탭하면 벗기' : '탭해서 입히기')
        : `배지 '${badge?.nameKo ?? c.badge}'${badge ? `: ${badge.descKo}` : ''}`}</small>`;
    if (owned.has(c.id)) {
      // a focusable button, so the keyboard can wear it too (Tab to it, Enter/Space)
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', String(on));
      li.dataset.id = c.id;
      li.addEventListener('click', () => {
        const next = toggleCosmetic(progress, c.id);
        if (next === progress) return;
        progress = next;
        saveProgress(progress);
        applyCosmetics();
        const refocus = document.activeElement === li;
        renderWear();
        // the list was rebuilt; keep keyboard focus on the same piece
        if (refocus) document.querySelector<HTMLElement>(`#book-wear li[data-id="${c.id}"]`)?.focus({ preventScroll: true });
      });
    }
    return li;
  }));
}
const bookOpen = () => !!bookEl && !bookEl.hidden;
function closeBook() {
  if (!bookEl || bookEl.hidden) return;
  bookEl.hidden = true;
  collectionEl?.focus({ preventScroll: true }); // back where the book was opened from
}
collectionEl?.addEventListener('pointerdown', (e) => { e.stopPropagation(); openBook(); });
// taps inside the card stay (scrolling a pane must not close it); the ✕ or the dim backdrop close
bookEl?.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === bookEl) closeBook(); });
document.getElementById('book-close')?.addEventListener('click', closeBook);
let selected = 0;
function chooseStage() {
  const st = entries[selected];
  if (!st || !isOpen(st)) return;
  if (st.def.id !== currentStage.def.id) { currentStage = st; reset(); }
  start();
}
function start() {
  if (started) return;
  started = true;
  document.body.classList.remove('on-title');
  title?.classList.add('leaving');
  setTimeout(() => { if (title) title.hidden = true; }, 450);
  levelBanner(currentStage.nameKo, 1, 2);
  lastFall = null;
  stageBlurb(); // the stage's one rule, every time it starts
}
function showTitle() {
  progress = loadProgress();
  // pick up a new day, and a rule the player has since unlocked (unless the day is already pinned)
  if (isDailyId(currentStage.def.id)) currentStage = dailyStage(dailyDate = new Date(), progress);
  refreshEntries();
  selected = entryIndex(currentStage);
  renderStageList();
  started = false;
  overlay.hidden = true;
  reset();
  document.body.classList.add('on-title');
  if (title) { title.hidden = false; title.classList.remove('leaving'); }
}
refreshEntries();
selected = entryIndex(currentStage);
renderStageList();
window.addEventListener('keydown', (e) => {
  if (!started) {
    e.preventDefault();
    if (bookOpen()) { // the book owns the keys while open: Esc/B close, ←→ switch tabs
      if (e.key === 'Escape' || e.key === 'b' || e.key === 'B') closeBook();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') showBookTab(bookTab + (e.key === 'ArrowLeft' ? -1 : 1), true);
      else if (e.key === 'Tab') { // keydown is prevented above, so cycle focus inside the book by hand (a focus trap)
        const els = [...(bookEl?.querySelectorAll<HTMLElement>('#book-close, [role="tab"][tabindex="0"], .pane:not([hidden]) [tabindex="0"]') ?? [])];
        const at = els.indexOf(document.activeElement as HTMLElement);
        els[(at + (e.shiftKey ? -1 : 1) + els.length) % els.length]?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') { // keydown is prevented above, so press the focused book button by hand
        const el = document.activeElement;
        if (el instanceof HTMLElement && bookEl?.contains(el)) el.click();
      }
      return;
    }
    if (e.key === 'b' || e.key === 'B') { openBook(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { selected = (selected + entries.length - 1) % entries.length; renderStageList(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { selected = (selected + 1) % entries.length; renderStageList(); }
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'z' || e.key === 'Z') chooseStage();
    return;
  }
  if (e.key === 'r' || e.key === 'R') { reset(); return; }
  if ((e.key === 's' || e.key === 'S') && game.state !== 'playing') { showTitle(); return; }
  if ((e.key === 'n' || e.key === 'N') && game.state !== 'playing' && !overlay.hidden) { goNext(); return; }
  // OS key-repeat is not a fresh press (it would whiff every cooldown): drillHeld covers the hold
  if (DRILL_KEYS.has(e.key)) { e.preventDefault(); if (!e.repeat) pressDrill(); return; }
  const dir = KEYS[e.key];
  if (!dir) return;
  e.preventDefault();
  pressDir(dir);
});
window.addEventListener('keyup', (e) => {
  if (DRILL_KEYS.has(e.key)) drillHeld = false;
  const dir = KEYS[e.key];
  if (dir) releaseDir(dir);
});
window.addEventListener('blur', () => { held.clear(); drillHeld = false; setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
// Capture phase runs before every other key/pointer handler: unlock audio inside the gesture, and
// while the pause menu is up no input reaches the game (it must not also swing or step).
const swallow = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
const isPauseKey = (k: string) => k === 'Escape' || ((k === 'p' || k === 'P') && !document.body.classList.contains('dev')); // dev P = pixel mode
window.addEventListener('keydown', (e) => {
  unlockSfx();
  const k = e.key;
  if ((k === 'm' || k === 'M') && !e.repeat) { toggleMuted(); syncMuteBtn(); if (paused) swallow(e); return; }
  if (!paused) {
    if (isPauseKey(k) && !e.repeat && started && game.state === 'playing') { swallow(e); setPaused(true); }
    return;
  }
  // the pause menu's keys (UI review 15); any other key does nothing, so a stray arrow can't resume into a step
  swallow(e);
  if (e.repeat) return;
  if (isPauseKey(k) || k === ' ' || k === 'Enter') setPaused(false);
  else if (k === 'r' || k === 'R') reset();
  else if (k === 's' || k === 'S') showTitle();
}, { capture: true });
// A tap outside the menu card resumes and is swallowed, but its click still fires on whatever lies
// under it once the menu is gone: buttons check this (bug review 8). Taps on the card go through.
let resumedByTap = false;
window.addEventListener('pointerdown', (e) => {
  unlockSfx();
  resumedByTap = false;
  if (!paused || (e.target as Element | null)?.closest?.('#pause .card')) return;
  swallow(e);
  setPaused(false);
  resumedByTap = true;
}, { capture: true });
// Touch pad: each finger is tracked by pointer id and hit-tested as it slides, so rolling a thumb
// from ◀ to ▼ switches direction without lifting (review item 14). pointerleave no longer
// releases: only lifting the finger (or sliding off every button) does.
const padTouch = new Map<number, Dir | null>();
function dirAt(x: number, y: number): Dir | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('#pad [data-dir]');
  return (el?.dataset.dir as Dir | undefined) ?? null;
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('#pad [data-dir]')) {
  const dir = btn.dataset.dir as Dir;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    padTouch.set(e.pointerId, dir);
    pressDir(dir);
  });
}
window.addEventListener('pointermove', (e) => {
  const cur = padTouch.get(e.pointerId);
  if (cur === undefined) return;
  const next = dirAt(e.clientX, e.clientY);
  if (next === cur) return;
  if (cur) releaseDir(cur);
  padTouch.set(e.pointerId, next);
  if (next) pressDir(next);
});
// Floating joystick (default; ?pad=buttons keeps the d-pad). The board is a grid, so the stick
// snaps to 4 directions: a dead zone ignores grazes, and the current direction only changes when
// the other axis clearly wins (hysteresis), so a thumb near a diagonal doesn't flicker. A held
// direction goes through the same pressDir/releaseDir as keys, so step repeat and turning match.
const padButtons = new URLSearchParams(location.search).get('pad') === 'buttons';
document.body.classList.toggle('pad-buttons', padButtons);
const stickZone = document.getElementById('stick-zone');
const stickBase = document.getElementById('stick-base');
const stickKnob = document.getElementById('stick-knob');
const STICK_R = 48, STICK_DEAD = 0.25, STICK_SWITCH = 1.3; // px radius, dead-zone share, axis lead to switch (our tuning)
let stickPointer = -1, stickDir: Dir | null = null, stickX = 0, stickY = 0;
function stickHome() {
  if (!stickZone || !stickBase) return;
  // CSS-relative so it is right even while #pad is hidden (desktop) and on resize
  stickBase.style.left = '86px';
  stickBase.style.top = 'calc(100% - 100px)';
}
function stickRelease() {
  stickPointer = -1;
  if (stickDir) releaseDir(stickDir);
  stickDir = null;
  stickBase?.classList.remove('on');
  if (stickKnob) stickKnob.style.transform = '';
  stickHome();
}
if (stickZone && stickBase && stickKnob && !padButtons) {
  stickHome();
  window.addEventListener('resize', () => { if (stickPointer < 0) stickHome(); });
  stickZone.addEventListener('pointerdown', (e) => {
    if (stickPointer >= 0) return;
    e.preventDefault();
    stickPointer = e.pointerId;
    const r = stickZone.getBoundingClientRect();
    stickX = e.clientX; stickY = e.clientY;
    stickBase.style.left = `${e.clientX - r.left}px`;
    stickBase.style.top = `${e.clientY - r.top}px`;
    stickBase.classList.add('on');
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    let dx = e.clientX - stickX, dy = e.clientY - stickY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) { dx *= STICK_R / len; dy *= STICK_R / len; }
    stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    let next: Dir | null = null;
    if (len >= STICK_R * STICK_DEAD) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const horiz = stickDir === 'left' || stickDir === 'right', vert = stickDir === 'up' || stickDir === 'down';
      // keep the current axis unless the other one leads by STICK_SWITCH
      const useX = horiz ? !(ay > ax * STICK_SWITCH) : vert ? ax > ay * STICK_SWITCH : ax >= ay;
      next = useX ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
    }
    if (next === stickDir) return;
    if (stickDir) releaseDir(stickDir);
    stickDir = next;
    if (next) { pressDir(next); vibrate(6); }
  });
  const end = (e: PointerEvent) => { if (e.pointerId === stickPointer) stickRelease(); };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
const drillBtn = $('drill-btn');
let drillPointer = -1;
drillBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); drillPointer = e.pointerId; drillBtn.classList.add('down'); pressDrill(); });
const endPointer = (e: PointerEvent) => {
  if (e.pointerId === drillPointer) { drillPointer = -1; drillHeld = false; drillBtn.classList.remove('down'); }
  const cur = padTouch.get(e.pointerId);
  if (cur === undefined) return;
  padTouch.delete(e.pointerId);
  if (cur) releaseDir(cur);
};
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
// Mute: M key anywhere, the 🔊 button on the title, and the pause menu's sound row in a run (UI
// review 4: the floating in-run button sat on the result card's corner on phones). tabIndex -1 +
// blur so Space (hammer) can never re-activate a focused button.
const muteBtn = document.getElementById('mute');
const soundBtn = document.getElementById('pm-sound');
function syncMuteBtn() {
  const m = isMuted();
  if (muteBtn) {
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', m ? '소리 켜기' : '소리 끄기');
  }
  if (soundBtn) soundBtn.innerHTML = `${m ? '🔇 소리 켜기' : '🔊 소리 끄기'} <span class="key">(M)</span>`;
}
// a menu/HUD button: never focusable, and its pointerdown stays away from the board's handlers
function uiButton(id: string, onClick: () => void) {
  const b = document.getElementById(id);
  if (!b) return;
  b.tabIndex = -1;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', () => {
    b.blur();
    if (resumedByTap) { resumedByTap = false; return; } // that tap only resumed the run
    onClick();
  });
}
const flipSound = () => { toggleMuted(); syncMuteBtn(); };
uiButton('mute', flipSound);
uiButton('pm-sound', flipSound);
initSfx();
syncMuteBtn();
// Pause (item 14): a hidden tab, lost focus, ⏸, Esc or P freezes the run behind the pause menu
// (UI review 15: 계속 / 다시 하기 / 스테이지 선택 / 소리).
const pauseEl = document.getElementById('pause');
function setPaused(on: boolean) {
  if (on && (!started || game.state !== 'playing')) return;
  paused = on;
  if (pauseEl) pauseEl.hidden = !on;
  if (!on) return;
  held.clear();
  padTouch.clear();
  if (stickPointer >= 0) stickRelease();
  drillPointer = -1;
  drillBtn.classList.remove('down');
  drillHeld = false;
  drillBuf = moveBuf = 0;
}
// ⏸ in the top bar (item 11: phones have no blur or key to pause on) and the menu's rows
uiButton('pause-btn', () => setPaused(true));
uiButton('pm-resume', () => setPaused(false));
uiButton('pm-restart', reset);
uiButton('pm-stages', () => showTitle());
$('restart').addEventListener('click', reset);
$('to-stages').addEventListener('click', () => showTitle());

function burst(x: number, y: number, color: string, n: number, power = 1) {
  for (let i = 0; i < n && particles.length < PMAX; i++) {
    particles.push({
      x, y: wy(y), z: 0,
      vx: (Math.random() - 0.5) * 6 * power, vy: (Math.random() * 5 + 1) * power, vz: Math.random() * 5 * power,
      life: 0.7 + Math.random() * 0.5, color, spin: Math.random() * 10,
    });
  }
}

// ---- onboarding: one-line tips the first time each rule shows up (remembered per browser) ----
// Keyed by event type, plus 'wobble' (fired from syncBlocks before the block falls). pop/wobble
// are the two rules nobody was told (review item 2), so they fire as early as possible.
const TIPS: Record<string, string> = {
  // one line each (UI review 6: a two-line toast covered the board); the full rule lives in prompts/blurbs
  pop: '같은 색 4개가 붙으면 펑! 떨어져 붙어도 연쇄',
  wobble: '흔들리는 블록은 곧 떨어져요 · 아래서 비켜요!',
  // combo pays score only (AIR_CHAIN feeds air from cascade steps, never from the combo count), and
  // only the player's own pops refill the gauge over the head; the line keeps just the score part
  combo: `터진 뒤 ${COMBO_WINDOW}초 안에 또 터뜨리면 콤보 · 점수 UP`,
  chip: 'X 블록은 5번 쳐야 깨지고 공기 -20%',
  melt: '얇은 얼음은 옆이 비면 녹아요 · 연쇄를 노려요',
  'friend-spawn': 'X 블록 4개가 터진 자리에 얼음 친구 · 구출!',
  clock: '시계를 먹으면 기록 시간이 줄어요',
  capsule: '공기 캡슐 +23% · 3연쇄 이상도 공기 충전',
  levelclear: '청록 줄을 깨면 위가 사라지고 보너스!',
  // round 3 review: the key-column technique had no tip, prompt or cue. Every key piece has a hole
  // under a block bridge that leans on an X, and the key is the column beside the hole on the side
  // away from that X (chunks.ts); fired when one is just below the hero (keyTipCheck).
  key: '구멍 옆 열을 X 반대쪽에서 쭉 파면 큰 연쇄!',
};
// the pop rule matters from the first swing, so it shows on the first break, not the first pop
const TIP_ALIAS: Record<string, string> = { drill: 'pop' };
const TIP_KEY = 'dig-down:tips:v1';
let seenTips = new Set<string>();
try { seenTips = new Set(JSON.parse(localStorage.getItem(TIP_KEY) ?? '[]')); } catch { /* storage blocked */ }
function markSeen(key: string) {
  if (seenTips.has(key)) return;
  seenTips.add(key);
  try { localStorage.setItem(TIP_KEY, JSON.stringify([...seenTips])); } catch { /* ignore */ }
}
// Which tips a tutorial prompt already teaches (studio review 2 item 12: the first run stacked 10
// lines in 37s). Matched on the prompt text, so a rewritten prompt in stages.ts keeps working.
const TIP_COVER: Record<string, RegExp> = { pop: /터져/, wobble: /흔들리는/, chip: /X 블록/ };
const tipsIn = (text: string) => Object.keys(TIP_COVER).filter((k) => TIP_COVER[k].test(text));
// tips this run's stage prompts cover: held back for the run (and marked seen once the prompt shows)
let coveredTips = new Set<string>();
const isTutorial = () => !!currentStage.levelPromptsKo?.some(Boolean);
const tipEl = document.getElementById('tip');
// Toasts queue instead of overwriting (the stage blurb used to vanish under the first tip): each
// stays at least TOAST_MIN, then yields to the next; a lone toast runs its full time. Clocked by
// the effects dt, so a paused run doesn't eat them. TOAST_MIN is our tuning (review item 2).
// A tip counts as seen only once it is on screen (item 12): queued tips are dropped on a new run
// (their event queues them again) and wait for a run in play. On the tutorial at most one toast shows per 100m level.
const TOAST_MIN = 2.5;
// UI review 6: one line with an icon that says what kind of note it is (💡 rule tip, 🚩 stage rule, ⚠️ warning)
const toastQueue: { text: string; seconds: number; tip?: string; icon: string }[] = [];
let toastShown = 0, toastLeft = 0; // seconds the current toast has been up / has left
let toastLevel = 0; // tutorial: the level the last toast showed in (0: none this run)
let toastText = ''; // the text on screen (textContent now includes the icon)
function toast(text: string, seconds = 3.5, tip?: string, icon = '💡') {
  if (!tipEl) return;
  if (toastQueue.some((q) => q.text === text) || (!tipEl.hidden && toastText === text)) return;
  toastQueue.push({ text, seconds: Math.max(TOAST_MIN, seconds), tip, icon });
  if (tipEl.hidden) nextToast();
}
// the queue may hold back: only during a run, and on the tutorial once per level and never
// under the level's prompt banner (a tip showing with the prompt is the stacking item 12 removed)
const toastHeld = () => !started || (isTutorial() && (toastLevel === game.level || !!banner?.sub));
function nextToast() {
  if (!tipEl) return;
  if (!tipEl.hidden) tipEl.hidden = true;
  if (!toastQueue.length || toastHeld()) return;
  const q = toastQueue.shift()!;
  if (q.tip) markSeen(q.tip);
  if (isTutorial()) toastLevel = game.level;
  toastText = q.text;
  const icon = document.createElement('span'), line = document.createElement('span');
  icon.className = 'ico';
  icon.textContent = q.icon;
  icon.setAttribute('aria-hidden', 'true'); // a screen reader reads the line, not "light bulb"
  line.className = 'txt';
  line.textContent = q.text;
  tipEl.replaceChildren(icon, line);
  tipEl.hidden = false;
  tipEl.classList.remove('show');
  void tipEl.offsetWidth;
  tipEl.classList.add('show');
  toastShown = 0;
  toastLeft = q.seconds;
}
// desktop key hint (UI review 5): it sat on the board every run. It shows for the first HINT_SECONDS
// of play (summed over runs, so a quick first loss doesn't eat it; clocked by the effects dt like
// toasts), then fades for good. ?dev keeps it (it lists the dev keys). HINT_SECONDS is our choice.
const HINT_KEY = 'dig-down:hint:v1';
const HINT_SECONDS = 20;
let hintLeft = HINT_SECONDS;
try { if (localStorage.getItem(HINT_KEY)) hintLeft = 0; } catch { /* storage blocked: show it again */ }
document.body.classList.toggle('hint-done', hintLeft <= 0);
function syncHint(dt: number) {
  if (hintLeft <= 0 || !started || game.state !== 'playing') return;
  hintLeft -= dt;
  if (hintLeft > 0) return;
  document.body.classList.add('hint-done');
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
}
function syncToast(dt: number) {
  if (!tipEl) return;
  if (tipEl.hidden) { if (toastQueue.length) nextToast(); return; } // a held tip shows when allowed
  toastShown += dt;
  toastLeft -= dt;
  if (toastLeft <= 0 || (toastQueue.length && !toastHeld() && toastShown >= TOAST_MIN)) nextToast(); // a held next must not cut this one short
}
// a new run: drop everything queued. A tip not yet shown was never marked seen, so its event
// queues it again where it is relevant (a lake friend tip must not open the snowy hill).
function clearToasts() {
  toastQueue.length = 0;
  toastLevel = 0;
  coveredTips = new Set((currentStage.levelPromptsKo ?? []).flatMap(tipsIn));
  if (tipEl) tipEl.hidden = true;
}
// the key tip: once a key piece is a few rows below the hero (its hole is in view by then)
const KEY_TIP_ROWS = 8;
function keyTipCheck() {
  if (started && !seenTips.has('key') && keyPieceBelow(game, KEY_TIP_ROWS)) maybeTip('key');
}
function maybeTip(type: string) {
  const key = TIP_ALIAS[type] ?? type;
  const text = TIPS[key];
  if (!text || seenTips.has(key) || coveredTips.has(key) || startDepth) return;
  if (toastQueue.some((q) => q.tip === key)) return;
  toast(text, 3.5, key);
}
// the stage blurb on start/restart; the tutorial's prompts carry its rule instead (item 12)
function stageBlurb() {
  // the daily's '모두가 같은 코스 · ' prefix made it two lines; its banner already says it is the daily
  if (!isTutorial()) toast((ruleOf(currentStage) ?? currentStage).blurbKo, 4, undefined, '🚩');
}
// why the run ended, with the fix, for the results card
let lastFall: 'crush' | 'air' | null = null;

function handleEvent(e: GameEvent) {
  maybeTip(e.type);
  switch (e.type) {
    case 'drill': {
      addGhosts(e.cells);
      // The 1-block break is the most frequent action and read weakest (review item 4): 4 chips a
      // cell for small breaks; big chunks keep 1 so the shatter doesn't bury the hero.
      const chips = e.cells.length <= 4 ? 6 : 2;
      for (const c of e.cells) burst(c.x, c.y, colorOf(c.color, c.y), chips, 1.4);
      // directional kick toward the struck face, and the hero alone holds the impact pose
      const f = game.mole.facing;
      kickX = f === 'left' ? -KICK : f === 'right' ? KICK : 0;
      kickY = f === 'up' ? KICK : f === 'down' ? -KICK : 0;
      heroFreeze = HERO_FREEZE;
      // Punch (playtest): every break now gets a world hitstop, a short shake that grows with the
      // chunk, and an impact star where the hammer met the block. Our tuning.
      const n = e.cells.length;
      hitStop = Math.max(hitStop, n <= 2 ? 0.03 : Math.min(0.08, 0.04 + 0.006 * n)); // short: digging pace is the game
      shake = Math.max(shake, Math.min(0.16, 0.07 + 0.012 * n));
      const hx = game.mole.x + (f === 'left' ? -0.5 : f === 'right' ? 0.5 : 0);
      const hy = game.mole.y + (f === 'up' ? -0.5 : f === 'down' ? 0.5 : 0);
      impacts.push({ x: hx, y: hy, life: IMPACT_LIFE, size: Math.min(1.6, 1 + 0.08 * n), rot: Math.random() * Math.PI });
      sfxBreak(n);
      vibrate(12);
      break;
    }
    case 'whiff': // a swing at nothing still swings, with a dull swish (no kick, no freeze)
      swingT = SWING_TIME;
      hitAnimT = HIT_ANIM; // the side strike sheet runs on its own timer (a whiff never moves lastDrill)
      sfxWhiff();
      break;
    case 'shield': // the respawn shield shattered a block: a small white ring, no flatten or burst
      rings.push({ x: e.x, y: e.y, life: RING_LIFE });
      shake = Math.max(shake, 0.1);
      sfxShield();
      break;
    case 'combo':
      // starts above the head meter (+1.1), not on it
      floaters.push({ x: game.mole.x, y: game.mole.y - 1.6, text: `COMBO ×${e.n}`, life: 1.2, color: COMBO_COLOR });
      sfxCombo(e.n + 1); // the arpeggio starts at 2 notes for the first combo pop
      break;
    case 'pop': {
      addGhosts(e.cells);
      // freeze to sell the hit; capped so a long cascade never stalls the run (review item 4)
      if (e.chain >= 2) hitStop = Math.max(hitStop, Math.min(0.16, 0.03 + e.chain * 0.025));
      sfxPop(e.step); // pitch climbs with chain + combo (sfx item 9)
      if (e.chain >= 2) vibrate(Math.min(120, 15 * e.chain));
      for (const c of e.cells) burst(c.x, c.y, colorOf(c.color, c.y), 2, 1.3);
      // a few small cream stars over the chunk (one big star per cell buried the hero)
      const stars = Math.min(4, Math.ceil(e.cells.length / 3));
      for (let k = 0; k < stars && flashes.length < FLASH_MAX; k++) {
        const c = e.cells[Math.floor((k + 0.5) * e.cells.length / stars)];
        flashes.push({ x: c.x, y: c.y, life: FLASH_LIFE, color: colorOf(c.color, c.y), size: 0.6 + e.chain * 0.1 });
      }
      const mid = e.cells[Math.floor(e.cells.length / 2)];
      // e.points is what was actually scored (chain and combo multipliers included)
      if (e.chain > 1) {
        floaters.push({ x: mid.x, y: mid.y - 0.6, text: `${e.chain} CHAIN +${e.points.toLocaleString()}`, life: 1.2, color: '#ffe14a' });
        floaters.push({ x: mid.x, y: mid.y + 0.2, text: `AIR +${e.air}%`, life: 1.2, color: '#5fd3ff' });
      } else {
        floaters.push({ x: mid.x, y: mid.y, text: `+${e.points.toLocaleString()}`, life: 1, color: '#fff' });
      }
      shake = Math.max(shake, 0.15 + e.chain * 0.06);
      break;
    }
    case 'chip': {
      // spark at the face the drill is biting
      const f = game.mole.facing;
      const sx = e.x + (f === 'left' ? 0.4 : f === 'right' ? -0.4 : 0);
      const sy = e.y + (f === 'up' ? 0.4 : f === 'down' ? -0.4 : 0);
      if (flashes.length < FLASH_MAX) flashes.push({ x: sx, y: sy, life: FLASH_LIFE * 0.7, color: '#ffd86b', size: 0.45 });
      burst(e.x, e.y, XBLOCK_COLOR, 4, 1.2);
      shake = Math.max(shake, 0.07);
      hitStop = Math.max(hitStop, 0.03);
      // a small impact star too, growing as the block nears breaking (5 hits)
      impacts.push({ x: sx, y: sy, life: IMPACT_LIFE, size: 0.7 + 0.12 * (XBLOCK_HP - e.hp), rot: Math.random() * Math.PI });
      vibrate(8);
      sfxXChip(e.hp);
      break;
    }
    case 'xbreak':
      burst(e.x, e.y, '#b388ff', 14, 1.2);
      floaters.push({ x: e.x, y: e.y, text: 'AIR -20%', life: 1, color: '#ff6b7a' });
      shake = Math.max(shake, 0.15);
      sfxXBreak();
      break;
    case 'friend-spawn':
      floaters.push({ x: e.x, y: e.y - 0.5, text: '친구 발견!', life: 1.2, color: '#9fe8ff' });
      break;
    case 'friend':
      for (let i = 0; i < 2; i++) flashes.push({ x: e.x, y: e.y, life: FLASH_LIFE, color: '#fdf6e3', size: 0.7 });
      floaters.push({ x: e.x, y: e.y, text: `구출! +${e.points}`, life: 1.2, color: '#ffe14a' });
      sfxFriend();
      props?.onFriend(e.count); // the friend joins the penguin flock on the surface
      break;
    case 'clock':
      floaters.push({ x: e.x, y: e.y, text: `⏱ -${e.secs}초`, life: 1, color: '#ffe14a' });
      for (let i = 0; i < 2; i++) flashes.push({ x: e.x, y: e.y, life: FLASH_LIFE, color: '#fdf6e3', size: 0.6 });
      sfxClock();
      break;
    case 'capsule':
      for (let i = 0; i < 2; i++) flashes.push({ x: e.x, y: e.y, life: FLASH_LIFE, color: '#bff2ff' });
      burst(e.x, e.y, '#5fd3ff', 12);
      floaters.push({ x: e.x, y: e.y, text: `AIR +${AIR_CAPSULE}%  ${e.points}`, life: 1, color: '#5fd3ff' });
      hitStop = Math.max(hitStop, 0.04); // a breath of stillness on the pickup (our tuning)
      sfxCapsule();
      break;
    case 'levelclear':
      for (let x = 0; x < game.cols; x++) burst(x, e.y, CLEAR_COLOR, 6, 1.4);
      floaters.push({ x: 4, y: e.y - 0.5, text: `LEVEL CLEAR +${e.bonus.toLocaleString()}`, life: 1.6, color: CLEAR_COLOR });
      shake = Math.max(shake, 0.3);
      hitStop = Math.max(hitStop, 0.12); // the level-ending row lands like a big hit (our tuning)
      sfxClearRow();
      break;
    case 'melt': // thin ice gives way: it breaks into pale chips and a puff of cold mist
      addGhosts([{ x: e.x, y: e.y, color: THAW }]);
      for (let i = 0; i < 3 && puffs.length < PUFF_MAX; i++) {
        puffs.push({ x: wx(e.x) + (Math.random() - 0.5) * 0.6, y: wy(e.y), vx: (Math.random() - 0.5) * 1.2, life: 0.5, max: 0.5 });
      }
      break;
    case 'land':
      shake = Math.max(shake, 0.06);
      sfxLand(); // self rate-limited: a settling stack makes one thump
      for (let i = 0; i < 3 && puffs.length < PUFF_MAX; i++) { // ice dust where the chunk touches down
        puffs.push({ x: wx(e.x) + (Math.random() - 0.5) * 0.8, y: wy(e.y) - 0.45, vx: (Math.random() - 0.5) * 2, life: 0.4, max: 0.4 });
      }
      break;
    case 'crush':
      lastFall = 'crush';
      crushT = CRUSH_TIME;
      crushX = game.mole.x;
      crushY = game.mole.y;
      burst(e.x, e.y, '#fff', 18, 1.5);
      shake = 0.45;
      sfxCrush();
      vibrate(CRUSH_BUZZ);
      break;
    case 'suffocate':
      lastFall = 'air';
      floaters.push({ x: game.mole.x, y: game.mole.y - 0.5, text: '숨 막혀!', life: 1.2, color: '#ff6b7a' });
      shake = 0.3;
      sfxSuffocate();
      break;
    case 'extend':
      banner = { text: '1UP!', life: 1.8 };
      sfxLevelUp();
      break;
    case 'level':
      levelBanner(`LEVEL ${e.level}`, e.level, 1.8);
      levelWipe = 1.3;
      sfxLevelUp();
      break;
    case 'won':
      sfxWin();
      props?.celebrate(true); // the surface flock cheers
      showResults('도착! 🎉');
      break;
    case 'lost':
      sfxLose();
      props?.celebrate(false);
      showResults('아쉬워요!');
      break;
  }
}

function showResults(title: string) {
  const mins = Math.floor(game.time / 60);
  const secs = Math.floor(game.time % 60).toString().padStart(2, '0');
  // best record, shared with the 2D build's key (try/catch: storage can be unavailable)
  const depth = depthOf(game);
  const won = game.state === 'won';
  const old = recordOf(progress, currentStage);
  const run: RunResult = { stageId: currentStage.def.id, won, score: game.score, depth, time: game.time, ...game.stats };
  // the daily keeps its own book (and streak); never record a run both ways (progress.ts)
  const daily = isDailyId(currentStage.def.id);
  const res: { progress: Progress; medal: Medal; newBest: boolean; badges: Badge[]; unlocked?: string[]; streak?: number } =
    daily ? dailyRecord(progress, dailyDate, run, currentStage) : recordRun(progress, run); // judged on the board played
  // dev ?depth starts skip ahead, so they must not count as records
  if (!startDepth) { progress = res.progress; saveProgress(progress); }
  if (won) saveGhost(game.time - game.stats.clockSaved);
  const rec = recordOf(res.progress, currentStage)!;
  // Hierarchy (UI review 1): stars and depth/score big, then one line of why, the next goal,
  // the news (unlocks, badges), and the small print last.
  resStage.textContent = currentStage.nameKo;
  const stars = medalStars(res.medal);
  resStars.replaceChildren('★'.repeat(stars), el('span', 'dim', '★'.repeat(3 - stars)));
  const starsNew = stars > medalStars(old?.medal);
  if (starsNew) resStars.append(el('span', 'new', 'NEW!'));
  resStars.setAttribute('aria-label', `별 ${stars}개${starsNew ? ' NEW!' : ''}`); // role=img: read as one label
  const hero = (label: string, value: string, of: string, isNew: boolean) => {
    const b = el('b', '', value);
    if (of) b.append(el('span', 'of', of));
    if (isNew) b.append(el('span', 'new', 'NEW!'));
    const box = document.createElement('div');
    box.append(el('small', '', label), b);
    return box;
  };
  resHero.replaceChildren(
    hero('깊이', `${depth}m`, currentStage.def.endless ? '' : ` / ${stageDepth(currentStage.def)}m`, depth > (old?.bestDepth ?? 0)),
    hero('점수', game.score.toLocaleString(), '', res.newBest),
  );
  resCause.hidden = won || !lastFall;
  resCause.textContent = lastFall === 'air'
    ? '🫧 숨이 막혔어요 · 캡슐·3연쇄·구출로 공기 채우기'
    : '🧊 블록에 깔렸어요 · "!" 아래에서 비키기';
  // the next medal and what this run was missing (review item 3), '' once gold
  const gap = silverGap(currentStage, run);
  resGoal.hidden = !gap;
  resGoal.textContent = `🎯 다음 목표 · ${gap}`;
  const news: string[] = [];
  if (res.streak) news.push(`🔥 ${res.streak}일 연속 도전`);
  for (const id of res.unlocked ?? []) news.push(`🔓 새 스테이지 · ${stageById(id)?.nameKo}`);
  if (!startDepth) {
    for (const b of res.badges) {
      const gift = cosmeticForBadge(b.id); // the puppy outfit this badge unlocks (item 15)
      news.push(`🏅 ${b.nameKo} — ${b.descKo}${gift ? ` · 🎁 ${gift.nameKo} (도감에서 입히기)` : ''}`);
    }
  }
  resNews.replaceChildren(...news.map((t) => el('li', '', t)));
  const rows: [string, string, boolean?][] = [['시간', `${mins}:${secs}`]];
  if (game.stage.air.kind === 'swing') rows.push(['망치질', `${game.stats.swings}번`]);
  if (currentStage.timed) {
    const tt = game.time - game.stats.clockSaved;
    rows.push(['기록', `${tt.toFixed(2)}초 (시계 -${game.stats.clockSaved}초)`, won && rec.bestTime === tt]);
    if (rec.bestTime !== undefined) rows.push(['최단 기록', `${rec.bestTime.toFixed(2)}초`]);
  }
  // this run's number against the medal it was chasing (item 13); a clear has left every level behind
  const metric = medalMetric(currentStage, liveStats(won ? game.levels.length + 1 : game.level), old?.medal);
  // ✓ only when it counts: "≤ N swings" is trivially true for a run that died early, and every
  // finite-stage medal needs the clear too (endless medals are depth-only)
  const counts = won || !!currentStage.depthMedals;
  if (metric) rows.push([`${metric.labelKo} (${MEDAL_KO[metric.medal]})`, `${Math.floor(metric.value)}/${metric.target}${metric.unitKo}${metric.met && counts ? ' ✓' : ''}`]);
  rows.push(['최고 기록', `${rec.bestDepth}m · ${rec.bestScore.toLocaleString()}`]);
  overlayStats.replaceChildren(...rows.flatMap(([k, v, isNew]) => {
    const dd = el('dd', isNew ? 'best' : '', isNew ? `${v} NEW!` : v);
    return [el('dt', '', k), dd];
  }));
  overlayTitle.textContent = title;
  // "다음 스테이지 ▶" (item 15): hidden once every other stage is gold; after a loss it only
  // points forward, and the retry is the gold button (UI review 2)
  nextPick = nextStageAfter(res.progress, currentStage.def.id, won);
  nextBtn.hidden = !nextPick;
  if (nextPick) nextBtn.replaceChildren(`다음 스테이지 ▶ ${nextPick.nameKo} `, el('span', 'key', '(N)'));
  const nextIsMain = won && !!nextPick;
  nextBtn.classList.toggle('primary', nextIsMain);
  restartBtn.classList.toggle('primary', !nextIsMain);
  // the primary goes first in the DOM, not just visually, so Tab and screen readers meet it first
  resActions.prepend(nextIsMain ? nextBtn : restartBtn);
  // daily: a Wordle-style line to paste in a chat (item 14)
  shareText = daily ? dailyShareText(dailyDate, rec, liveStreak(res.progress)) : '';
  shareBtn.hidden = !shareText;
  shareField.hidden = true;
  overlay.hidden = false;
}
const nextBtn = $('next-stage'), shareBtn = $('share'), restartBtn = $('restart');
const SHARE_LABEL = shareBtn.textContent ?? '';
let shareTimer = 0;
const resStage = $('res-stage'), resStars = $('res-stars'), resHero = $('res-hero');
const resCause = $('res-cause'), resGoal = $('res-goal'), resNews = $('res-news'), resActions = $('res-actions');
const shareField = $('share-text') as HTMLInputElement;
let nextPick: StageInfo | undefined;
let shareText = '';
// back to the list with the suggested stage selected (the player still presses start)
function goNext() {
  if (!nextPick) return;
  currentStage = nextPick;
  showTitle();
}
nextBtn.addEventListener('click', () => { if (resumedByTap) { resumedByTap = false; return; } goNext(); });
shareBtn.addEventListener('click', () => {
  const text = shareText;
  if (!text) return;
  // #tip is hidden under the result card, so the confirmation goes on the button itself
  const done = () => {
    shareBtn.textContent = '✓ 복사했어요';
    clearTimeout(shareTimer);
    shareTimer = window.setTimeout(() => { shareBtn.textContent = SHARE_LABEL; }, 1500);
  };
  // navigator.clipboard needs a secure context (a phone on http://<LAN-IP> has none): the legacy
  // copy command still works there inside the click; failing both, the line is shown selected in
  // the result card so it can be copied by hand (a toast can't be selected and fades).
  const byHand = () => {
    shareField.value = text;
    shareField.hidden = false;
    shareField.focus();
    shareField.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
    if (ok) { shareField.hidden = true; done(); }
  };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, byHand);
  else byHand();
});

// ---- per-frame scene sync ----
// Falling blocks: the logic moves them a whole row per fall step; on screen each cell glides from
// where it was drawn toward its row at the fall speed, so drops read as motion, not row jumps.
// Keyed by the cell object, which travels with the block as it moves between grid slots.
const visualY = new WeakMap<Cell, number>();
const landT = new WeakMap<Cell, number>(); // seconds left of the touchdown squash
const LAND_SQUASH = 0.14;
const wasFallingCells = new WeakSet<Cell>();
function smoothRow(cell: Cell, y: number, dt: number) {
  let v = visualY.get(cell);
  if (v === undefined || v > y || y - v > 3) v = y; // new, popped back up, or teleported: snap
  else if (v < y) v = Math.min(y, v + game.levels[game.level - 1].fallSpeed * levelTempo(game) * 1.15 * dt);
  // touchdown = the logic's falling flag going true → false (the glide may finish either side of it)
  if (cell.falling) wasFallingCells.add(cell);
  else if (wasFallingCells.delete(cell)) landT.set(cell, LAND_SQUASH);
  visualY.set(cell, v);
  return v;
}
// squash amount 0..1 for a landing cell, ticking its timer down
function landSquash(cell: Cell, dt: number) {
  const t = landT.get(cell);
  if (!t) return 0;
  const left = Math.max(0, t - dt);
  if (left > 0) landT.set(cell, left);
  else landT.delete(cell);
  return Math.sin((left / LAND_SQUASH) * Math.PI); // ease in and out
}

// Crush warning (studio review 2 item 10): the hero's column, up to DANGER_REACH cells up. Gaps
// right above are skipped (a falling block comes through them), then the stack resting there is
// followed until the next gap or a block that is held up (everything above lands on that). The old
// fixed 3-cell look missed tall stacks that shake as one, so "!" lit too late to step out.
const DANGER_REACH = 8; // cells, roadmap item 10
const warnedCells = new WeakSet<Cell>(); // blocks that already buzzed: one vibrate per block
// read per frame (.matches is a cached boolean), so a system toggle applies without a reload
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let danger = false, dangerTop = -1; // dangerTop: highest warned row (-1: none)
function scanDanger(live: boolean) {
  danger = false;
  dangerTop = -1;
  if (!live || game.state !== 'playing') return;
  const { x, y } = game.mole;
  let fresh = false, stack = false, wobbling = false;
  for (let dy = 1; dy <= DANGER_REACH; dy++) {
    const c = cellAt(game, x, y - dy);
    if (!c) { if (stack) break; continue; }
    stack = true;
    const wob = c.wobble > 0 && !c.falling;
    // melting thaw ice with a block on it will drop that block (round 3 review: on the thaw cave the
    // warning came 0.18 s before a crush at p10, after the ice was gone and the stack shook)
    const thawing = c.color === THAW && c.melt > 0 && !!cellAt(game, x, y - dy - 1);
    if (!wob && !c.falling && !thawing) break; // held up: nothing above can reach the hero through it
    danger = true;
    wobbling ||= wob;
    dangerTop = y - dy;
    if (!warnedCells.has(c)) { warnedCells.add(c); fresh = true; }
  }
  if (fresh) vibrate(20); // the first time "!" lights for a block (item 10)
  if (wobbling) sfxDangerTick(); // self rate-limited (sfx.ts), safe to call every frame
}

const DANGER_TINT = new THREE.Color('#ff3b4e');
function syncBlocks(t: number, dt: number) {
  const centerRow = Math.round(-camY);
  let nb = 0, nx = 0, nc = 0, ns = 0, nf = 0, nk = 0;
  const wobbleTime = game.levels[game.level - 1].wobble / levelTempo(game); // as the rules: level + tempo
  const mx = game.mole.x, my = game.mole.y;
  wobbleNear = -1;
  for (let y = Math.max(0, centerRow - WINDOW_ROWS); y < Math.min(game.rows, centerRow + WINDOW_ROWS); y++) {
    for (let x = 0; x < game.cols; x++) {
      const cell = cellAt(game, x, y);
      if (!cell) continue;
      // the shake grows as the fall nears (0.03 → 0.09, our tuning), so timing reads at a glance
      const wob = cell.wobble > 0 && !cell.falling ? Math.min(1, cell.wobble / wobbleTime) : -1;
      // reduced motion: no shake; the white wobble pulse (shader) still says "about to fall"
      const jitter = wob >= 0 && !reduceMotion.matches ? Math.sin(t * 70 + x) * (0.03 + 0.06 * wob) : 0;
      if (wob > wobbleNear && Math.abs(x - mx) <= 2 && y >= my - 4 && y <= my + 1) wobbleNear = wob;
      // first wobble within 3 rows over the hero: teach "it will fall" before it lands on them
      if (wob >= 0 && started && Math.abs(x - mx) <= 1 && y < my && y >= my - 3) maybeTip('wobble');
      tmp.position.set(wx(x) + jitter, wy(smoothRow(cell, y, dt)), 0);
      tmp.rotation.set(0, 0, 0);
      if (cell.color === FRIEND) {
        tmp.position.z = 0.2;
        tmp.position.y += Math.abs(Math.sin(t * 4 + x)) * 0.04; // little hops: "help me out!"
        tmp.rotation.set(0, 0, Math.sin(t * 3 + y) * 0.06);
        tmp.scale.setScalar(1);
        tmp.updateMatrix();
        friends.setMatrixAt(nf++, tmp.matrix);
        tmp.position.z = 0;
        continue;
      }
      if (cell.color === CLOCK) {
        tmp.position.z = 0.2;
        tmp.rotation.set(0, 0, Math.sin(t * 6 + x) * 0.12); // ticking wobble
        tmp.scale.setScalar(1);
        tmp.updateMatrix();
        clocks.setMatrixAt(nk++, tmp.matrix);
        tmp.position.z = 0;
        continue;
      }
      if (cell.color === CAPSULE) {
        // bob and wobble like a bubble; the halo breathes behind it (capInk = halo layer)
        tmp.position.y += Math.sin(t * 3 + x) * 0.05;
        tmp.position.z = 0.2;
        tmp.rotation.set(0, 0, Math.sin(t * 2 + y) * 0.12);
        const squish = 1 + Math.sin(t * 5 + x) * 0.04;
        tmp.scale.set(squish, 2 - squish, 1);
        tmp.updateMatrix();
        capsules.setMatrixAt(nc, tmp.matrix);
        tmp.position.z = 0.1;
        tmp.scale.setScalar(0.85 + Math.sin(t * 2.4 + x) * 0.12);
        tmp.updateMatrix();
        capInk.setMatrixAt(nc, tmp.matrix);
        tmp.position.z = 0;
        nc++;
        continue;
      }
      const isX = cell.color === XBLOCK;
      tmp.position.z = SHADOW_Z;
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      boardShadow.setMatrixAt(ns++, tmp.matrix);
      tmp.position.z = 0;
      // thin ice never merges, so neighbouring thaw cells keep their own outlines
      const same = (nx: number, ny: number) => cell.color !== THAW && cellAt(game, nx, ny)?.color === cell.color;
      const L = same(x - 1, y), R = same(x + 1, y), U = same(x, y - 1), D = same(x, y + 1);
      // A shared edge between two different chunks is inked once (by the right/lower cell's left/top
      // edge), so it matches the outer silhouette width instead of doubling up.
      const block = (nx: number, ny: number) => { const n = cellAt(game, nx, ny); return !!n && n.color !== CAPSULE; };
      let mask = (L ? 0 : 1) | (R ? 0 : 2) | (U ? 0 : 4) | (D ? 0 : 8);
      if (!L && block(x - 1, y)) mask += 32768;
      if (!R && block(x + 1, y)) mask += 65536;
      if (!U && block(x, y - 1)) mask += 131072;
      if (!D && block(x, y + 1)) mask += 262144;
      mask |= ((x * 7 + y * 13) % 4) * 256; // painted-interior variant (stable per cell)
      if (cell.color === CLEAR) mask |= 1024; // aurora-ice shimmer
      if (cell.wobble > 0 && !cell.falling) mask |= 2048; // about to fall
      if (cell.color === THAW) {
        const thawTime = game.levels[game.level - 1].thawTime ?? 1;
        mask += 524288 + Math.min(4, Math.floor((cell.melt / thawTime) * 5)) * 1048576;
      }
      if (isX) mask += (XBLOCK_HP - cell.hp) * 4096; // crack stage
      else if (y === SKY_ROWS && cell.color >= 0) mask += 4096; // surface row wears a snow cap
      // inner corners: both sides continue the chunk but the diagonal does not
      if (L && U && !same(x - 1, y - 1)) mask |= 16;
      if (R && U && !same(x + 1, y - 1)) mask |= 32;
      if (L && D && !same(x - 1, y + 1)) mask |= 64;
      if (R && D && !same(x + 1, y + 1)) mask |= 128;
      // touchdown squash: flatten a touch toward the floor, then spring back
      const sq = landSquash(cell, dt) * 0.08;
      tmp.scale.set(1 + sq * 0.5, 1 - sq, 1);
      tmp.position.y -= sq / 2;
      tmp.updateMatrix();
      if (isX) {
        xBlocks.setMatrixAt(nx, tmp.matrix);
        xMask.setX(nx++, mask);
      } else {
        blocks.setMatrixAt(nb, tmp.matrix);
        tmpColor.set(colorOf(cell.color, y));
        // red warning tint on a shaking block that would land on the hero (the scanDanger stack)
        if (wob >= 0 && x === mx && y < my && y >= dangerTop && dangerTop >= 0) tmpColor.lerp(DANGER_TINT, 0.3 + Math.sin(t * 16) * 0.12);
        blocks.setColorAt(nb, tmpColor);
        blockMask.setX(nb++, mask);
      }
    }
  }
  boardShadow.count = ns;
  boardShadow.instanceMatrix.needsUpdate = true;
  blockMask.needsUpdate = true;
  xMask.needsUpdate = true;
  for (const [mesh, n] of [[blocks, nb], [xBlocks, nx], [capsules, nc], [capInk, nc], [friends, nf], [clocks, nk]] as const) {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

function syncMole(t: number, dt: number) {
  const m = game.mole;
  const k = 1 - Math.pow(0.5, dt / 0.05); // half-life 50ms (was ~75ms): steps land snappier
  view.x += (m.x - view.x) * k;
  view.y += (m.y - view.y) * k;
  if (m.x !== stepX) { if (started && game.state === 'playing' && dt > 0) sfxStep(); stepX = m.x; }
  mole.position.set(wx(view.x) + kickX, wy(view.y) + kickY, 0);
  mole.visible = !(m.invuln > 0 && Math.floor(t * 12) % 2 === 0);
  const yaw = m.facing === 'left' ? -0.7 : m.facing === 'right' ? 0.7 : 0;
  face.rotation.y += (yaw - face.rotation.y) * k;
  if (heroReady) {
    // hop on each step, squash when landing from a fall, lean toward the drill direction
    if (m.x !== lastMoleX) { hop = 1; kickPuffs(2); }
    const landed = m.y === lastMoleY ? 0 : 1;
    const fallingNow = view.y < m.y - 0.15;
    if (wasFalling && !fallingNow) kickPuffs(4); // touchdown
    wasFalling = fallingNow;
    lastMoleX = m.x;
    lastMoleY = m.y;
    hop = Math.max(0, hop - dt * 6);
    const hopY = Math.sin(hop * Math.PI) * 0.12;
    const breathe = Math.sin(t * 4) * 0.015;
    crushT = Math.max(0, crushT - dt);
    if (crushT > 0 && (m.x !== crushX || m.y !== crushY || swingT > 0)) crushT = 0; // back in action
    const bonk = crushT > 0 ? Math.min(1, (CRUSH_TIME - crushT) / CRUSH_HIT) : 1;
    const squash = crushT > 0 ? 0.78 + 0.22 * bonk : landed ? 0.88 : 1 + breathe;
    spriteRig.scale.y += (squash - spriteRig.scale.y) * 0.3;
    spriteRig.scale.x = 1 + (1 - spriteRig.scale.y) * 0.6;
    spriteRig.position.y = -0.5 + hopY;
    const lean = m.facing === 'left' ? 0.12 : m.facing === 'right' ? -0.12 : 0;
    const rattle = swingT > 0 && swingT < SWING_TIME * 0.5 ? -0.07 : 0; // body follows through on impact
    spriteLean += (lean + rattle - spriteLean) * 0.25;
    // Always face the camera: a tilted paper cut-out reads as a sticker between the blocks.
    spriteRig.quaternion.copy(camera.quaternion).multiply(leanQ.setFromAxisAngle(Z_AXIS, spriteLean));
    contact.scale.set(1 - hopY * 2, 0.55 * (1 - hopY * 2), 1);
    if (m.facing === 'left') rigFlip = -1;
    else if (m.facing === 'right') rigFlip = 1;
    if (rigFlip !== lastFlip) { lastFlip = rigFlip; turnT = TURN_TIME; }
    turnT = Math.max(0, turnT - dt);
    spriteFlip = rigFlip * turnWidth(); // instant mirror, short width dip (never near zero)
    sprite.scale.x = Math.abs(sprite.scale.y * spriteAspect) * spriteFlip;
    // sit the self-lit hero into the darker depths a little, and go blue when gasping
    const tint = game.air < AIR_WARNING ? '#9fb4ff' : ['#ffffff', '#f4f6ff', '#e6eafc', '#d6dcf6', '#c6cdee'][moodBand()];
    spriteMat.color.set(tint);
    // profile frames while facing sideways (falls back to the rig until the textures load)
    const sideways = (m.facing === 'left' || m.facing === 'right') && STYLES[styleIndex].id === 'flat' && heroReady;
    let useSide = false;
    const slamming = m.facing === 'down' && swingT > 0 && STYLES[styleIndex].id === 'flat' && heroReady && !(view.y < m.y - 0.15);
    const upping = m.facing === 'up' && swingT > 0 && STYLES[styleIndex].id === 'flat' && heroReady && !(view.y < m.y - 0.15);
    const dropping = view.y < m.y - 0.15 && STYLES[styleIndex].id === 'flat' && heroReady;
    if (crushT > 0 && STYLES[styleIndex].id === 'flat' && heroReady) useSide = showSide('dizzy');
    else if (dropping) useSide = showSide('fall');
    else if (slamming) useSide = showSide('slam');
    else if (upping) useSide = showSide('up');
    else if (!sideways && STYLES[styleIndex].id === 'flat' && heroReady && !(view.y < m.y - 0.15)) useSide = showSide('front');
    else if (sideways) {
      const falling2 = view.y < m.y - 0.15;
      sheetClock += dt;
      // with a walk sheet the stride loops for as long as steps keep coming; otherwise hold briefly
      if (hop > 0.05) sideWalkT = sheets.walk ? 0.35 : 0.18;
      sideWalkT = Math.max(0, sideWalkT - dt);
      // raise-then-strike: the first 40% of the swing shows the hammer overhead (wind-up)
      // with a hit sheet (video frames) the whole raise-and-strike plays from it for HIT_ANIM;
      // otherwise the two stills: the first 40% of the swing shows the hammer overhead (wind-up)
      const swinging = sheets.hit ? hitAnimT > 0 : swingT > 0;
      const frame: SideFrame = swinging && !falling2 ? (sheets.hit || swingT <= SWING_TIME * 0.6 ? 'hit' : 'windup') : sideWalkT > 0 ? 'walk' : 'stand';
      useSide = showSide(frame);
    }
    sideCard.visible = useSide;
    // cosmetics follow the head: profile frames carry it ~0.07 forward of the card centre
    wear.visible = STYLES[styleIndex].id === 'flat'; // WEAR_AT was measured on puppy-flat.png only
    wear.scale.x = frontFrame(sideFrame) && useSide ? 1 : Math.sign(spriteFlip) || 1;
    wear.position.x = useSide && !frontFrame(sideFrame) ? (sideX + 0.07) * (Math.sign(spriteFlip) || 1) : 0;
    for (const mat of wearMats) mat.color.copy(spriteMat.color);
    rig.visible = heroReady && STYLES[styleIndex].id === 'flat' && rigLoaded === RIG_PARTS.length && !useSide;
    if (useSide) {
      sideMat.color.set(tint);
      // Width comes from the frame's stored width every frame. (It used to multiply the previous
      // frame's width by the turn progress, so turning in place shrank the card to ~0 and it stayed
      // invisible until the frame changed.)
      if (frontFrame(sideFrame)) { sideCard.scale.x = sideW; sideCard.position.x = sideX; } // front view: never mirrored
      else {
        sideCard.scale.x = sideW * spriteFlip; // mirrored at once, briefly narrowed while turning
        sideCard.position.x = sideX * Math.sign(spriteFlip || 1);
      }
      // falling: a quick side-to-side flail and a slight stretch along the drop (our tuning)
      const ft = performance.now() / 1000;
      sideCard.rotation.z = sideFrame === 'fall' ? Math.sin(ft * 13) * 0.08 : 0;
      if (sideFrame === 'fall') sideCard.scale.x *= 0.96 + Math.sin(ft * 26) * 0.02;
    }
    if (rig.visible) {
      for (const mat of rigMats) mat.color.set(tint);
      // The whole rig is mirrored for left (instant, see TURN_TIME), so the "drill arm" is always armR.
      if (m.facing === 'left') rigFlip = -1;
      else if (m.facing === 'right') rigFlip = 1;
      rig.scale.x = spriteFlip; // same instant turn as the sprite and side frames
      const walking = hop > 0.05;
      const falling = view.y < m.y - 0.15;
      walkPhase = walking ? walkPhase + dt * 16 : 0;
      const sw = Math.sin(walkPhase);
      ease(joints.legL, falling ? 0.38 : sw * 0.32);
      ease(joints.legR, falling ? -0.38 : -sw * 0.32);
      // arms: swing while walking, reach out on the drill side, fling up while falling
      const sideDrill = m.facing === 'left' || m.facing === 'right';
      // Hammer pose (owner: "rest it on the shoulder, then bring it down"). The hammer lives in the
      // right paw: at rest it lies over the shoulder behind the head; a hit cocks it back a little,
      // then slams it toward the facing direction and it eases back onto the shoulder.
      // Pose = [armR joint angle, hammer on-screen angle (0 = pointing forward)].
      type Pose = [number, number];
      // shouldered upright beside the right ear (behind the head it was invisible)
      const SHOULDER: Pose = [1.2, 1.45], COCK: Pose = [1.65, 2.05];
      const HIT: Record<string, Pose> = { side: [0.8, -0.35], down: [-0.1, -1.5], up: [2.45, 1.6] };
      const hit = HIT[sideDrill ? 'side' : m.facing === 'up' ? 'up' : 'down'];
      const mix = (a: Pose, b: Pose, f: number): Pose => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      let pose: Pose = SHOULDER;
      let striking = false;
      if (swingT > 0) {
        const k = 1 - swingT / SWING_TIME;
        if (k < 0.2) pose = mix(SHOULDER, COCK, k / 0.2); // anticipation
        else if (k < 0.55) { pose = mix(COCK, hit, Math.pow((k - 0.2) / 0.35, 0.6)); striking = true; } // slam
        else { pose = hit; striking = true; } // hold the impact; the ease below returns it to the shoulder
      }
      let armL = sw * 0.25;
      let armR = pose[0] + (walking && swingT <= 0 ? sw * 0.08 : 0);
      if (falling) { armL = -0.45; armR = 1.2; } // free arm out for balance, hammer stays shouldered
      else if (swingT > 0) armL = 0.12; // the free arm braces
      ease(joints.armL, armL);
      if (swingT > 0) joints.armR.rotation.z = armR; // swings are too fast to smooth
      else ease(joints.armR, armR);
      const headTilt = Math.sin(t * 2.1) * 0.04 + (walking ? sw * 0.06 : 0) + (swingT > 0 ? -0.06 : 0)
        + (sideDrill ? -0.08 : 0);
      ease(joints.head, headTilt, 0.25);
      joints.body.rotation.z = walking ? -sw * 0.04 : 0;
      handDrill.visible = true;
      // on-screen hammer angle; it eases back with the arm after the impact
      const hammerTarget = falling ? 1.45 : pose[1];
      hammerAngle = swingT > 0 ? hammerTarget : hammerAngle + (hammerTarget - hammerAngle) * 0.25;
      handDrill.rotation.z = hammerAngle - joints.armR.rotation.z;
      // over the shoulder it sits behind the head; while striking it comes in front of the blocks
      handDrill.position.z = 0.3;
    }
  }
  const angle = m.facing === 'right' ? 0 : m.facing === 'left' ? Math.PI : m.facing === 'up' ? Math.PI / 2 : -Math.PI / 2;
  drillPivot.rotation.z = angle;
  drillPivot.visible = !rig.visible && !sideCard.visible; // the rig / side frames hold the hammer
  // hammer swing on each successful hit (game.lastDrill moves when a swing lands)
  if (game.lastDrill !== lastSwingAt) { lastSwingAt = game.lastDrill; swingT = SWING_TIME; hitAnimT = HIT_ANIM; }
  hitAnimT = Math.max(0, hitAnimT - dt);
  // hero-only hitstop: once the swing reaches its impact pose (k >= 0.55) it holds there for
  // heroFreeze while the world keeps moving
  if (heroFreeze > 0 && swingT > 0 && swingT <= SWING_TIME * 0.45) heroFreeze = Math.max(0, heroFreeze - dt);
  else swingT = Math.max(0, swingT - dt);
  if (swingT <= 0) heroFreeze = 0;
  drillCard.rotation.z = swingAngle();
  body.position.y = -0.2 + Math.sin(t * 6) * 0.02;
  bodyMat.color.set(game.air < AIR_WARNING ? '#8fa6d8' : '#c8894a');
  headlamp.position.set(mole.position.x, mole.position.y + 0.3, 1.2);
  lampGlow.position.x = mole.position.x;
  lampGlow.position.y = mole.position.y + 0.2;
  (lampGlow.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, 0.12 + (game.level - 1) * 0.1 + Math.max(0, -camY - 6) * 0.004);
}

function syncSky(t: number, dt: number) {
  skyTex.offset.x = Math.sin(t * 0.05) * 0.01; // the aurora drifts a touch
  // Above ground: snow drifting down. Underground (it can't snow in a cave): the same points become
  // slow ice dust that hangs and twinkles in the band's crystal colour. Blend by camera depth.
  const under = THREE.MathUtils.clamp((-camY - (SKY_ROWS + 4)) / 6, 0, 1);
  const p = snowGeo.attributes.position as THREE.BufferAttribute;
  const fall = THREE.MathUtils.lerp(1, 0.08, under);
  for (let i = 0; i < SNOW; i++) {
    let y = p.getY(i) - dt * (0.6 + (i % 5) * 0.15) * fall + (under * Math.sin(t * 0.7 + i) * dt * 0.08);
    if (y < camY - 9) y += 20;
    if (y > camY + 11) y -= 20;
    p.setY(i, y);
    p.setX(i, p.getX(i) + Math.sin(t * (0.5 + under) + i) * dt * (0.2 - under * 0.12));
  }
  p.needsUpdate = true;
  const snowMat = snow.material as THREE.PointsMaterial;
  snowMat.color.set('#ffffff').lerp(tmpColor.set(CRYSTAL_GLOW[moodBand()]), under * 0.7);
  snowMat.size = THREE.MathUtils.lerp(0.13, 0.07, under);
  snowMat.opacity = THREE.MathUtils.lerp(0.9, 0.55 + Math.sin(t * 3) * 0.15, under);
}

function syncParticles(dt: number) {
  particles = particles.filter((p) => (p.life -= dt) > 0);
  particles.forEach((p, i) => {
    p.vy -= 16 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.spin += dt * 8;
    tmp.position.set(p.x, p.y, p.z);
    tmp.rotation.set(0, 0, p.spin); // flat chip spinning in the picture plane
    tmp.scale.setScalar(Math.min(1, p.life * 2));
    tmp.updateMatrix();
    parts.setMatrixAt(i, tmp.matrix);
    parts.setColorAt(i, tmpColor.set(p.color));
  });
  parts.count = particles.length;
  parts.instanceMatrix.needsUpdate = true;
  if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
}

// Oblique view like the mockup's raised slabs: shear the projection by depth so block fronts
// stay perfectly frontal (and the sprite stays flat-on) while every block shows the same sliver
// of top and side. A real camera tilt would show tops below centre and bottoms above it.
const baseProjection = new THREE.Matrix4();
const shear = new THREE.Matrix4();
function applyOblique() {
  const d = camDistance(); // shear about the board plane (view-space z = -d)
  shear.set(
    1, 0, OBLIQUE.x, OBLIQUE.x * d,
    0, 1, OBLIQUE.y, OBLIQUE.y * d,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  camera.projectionMatrix.copy(baseProjection).multiply(shear);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function syncCamera(dt: number) {
  camY += (targetCam() - camY) * (1 - Math.pow(0.01, dt));
  shake *= Math.pow(0.002, dt);
  shakeT += dt;
  // Damped oscillation instead of per-frame white noise: reads as a rattle, not as jitter that
  // strobes with the refresh rate. Two detuned rates keep it from tracing a line (our tuning).
  const sx = Math.sin(shakeT * 47) * shake * 0.5;
  const sy = Math.cos(shakeT * 39) * shake * 0.5;
  // the hammer kick nudges the world toward the struck face (camera moves the other way)
  const kd = Math.pow(0.5, dt / 0.035);
  const cx = -kickX * 0.6, cy = -kickY * 0.6;
  kickX *= kd;
  kickY *= kd;
  // slight top-down tilt and a sideways lean toward the mole for depth
  const lean = (view.x - 4) * 0.02;
  camera.position.set(4 + lean + sx + cx, camY + 0.4 + sy + cy, camDistance());
  camera.lookAt(4 + lean * 0.4 + cx, camY + cy, 0);
  applyOblique();

  // deeper levels get darker; sun follows the camera
  const lv = moodBand();
  hemi.intensity = 1.8; // block colours stay fixed at every depth; the backdrop carries the mood
  sun.intensity = 2.6;
  farMat.color.set(CAVE_TINT[lv]);
  for (const mat of cliffMats) mat.color.set(CAVE_TINT[lv]);
  blockMat.color.setScalar(1.3 * BOARD_LIGHT[lv]);
  xMat.color.set(XBLOCK_COLOR).multiplyScalar(1.25 * BOARD_LIGHT[lv]);
  sun.position.set(-4, camY + 12, 14);
  sun.target.position.set(4, camY, 0);
  const bg = camY > -SKY_ROWS - 4 ? '#163d7a' : '#12336a';
  (scene.background as THREE.Color).set(bg);
  scene.fog!.color.set(bg);
}

const project = new THREE.Vector3();
let comboLabel = '', comboLabelN = -1;
let vignette: CanvasGradient, redVignette: CanvasGradient;
function buildVignettes() {
  vignette = fxCtx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
  vignette.addColorStop(0, 'rgba(6,14,36,0)');
  vignette.addColorStop(1, 'rgba(6,14,36,1)');
  redVignette = fxCtx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  redVignette.addColorStop(0, 'rgba(255,0,0,0)');
  redVignette.addColorStop(1, 'rgba(255,30,50,1)');
}
function drawFx(t: number, dt: number) {
  fxCtx.clearRect(0, 0, W, H);
  floaters = floaters.filter((f) => (f.life -= dt) > 0);
  fxCtx.textAlign = 'center';
  fxCtx.textBaseline = 'middle';
  fxCtx.lineJoin = 'round';
  fxCtx.strokeStyle = INK;
  for (const f of floaters) {
    f.age = (f.age ?? 0) + dt;
    f.y -= dt * 1.2;
    project.set(wx(f.x), wy(f.y), 0.6).project(camera);
    const px = (project.x * 0.5 + 0.5) * W;
    const py = (-project.y * 0.5 + 0.5) * H;
    // pop in with a little overshoot, then float and fade
    const pop = f.age < 0.15 ? 0.6 + (f.age / 0.15) * 0.6 : f.age < 0.25 ? 1.2 - ((f.age - 0.15) / 0.1) * 0.2 : 1;
    const big = /CHAIN|CLEAR|COMBO/.test(f.text) ? 1.35 : 1;
    fxCtx.font = `${Math.round(24 * pop * big)}px "Jua", "Apple SD Gothic Neo", sans-serif`;
    fxCtx.lineWidth = 6 * pop;
    fxCtx.globalAlpha = Math.min(1, f.life * 2);
    fxCtx.strokeText(f.text, px, py);
    fxCtx.fillStyle = f.color;
    fxCtx.fillText(f.text, px, py);
  }
  fxCtx.globalAlpha = 1;
  // impact stars: white flash + comic rays, popping out fast
  for (let i = impacts.length - 1; i >= 0; i--) {
    const im = impacts[i];
    im.life -= dt;
    if (im.life <= 0) { impacts.splice(i, 1); continue; }
    const k = 1 - im.life / IMPACT_LIFE; // 0 → 1
    project.set(wx(im.x), wy(im.y), 0.7).project(camera);
    const px = (project.x * 0.5 + 0.5) * W, py = (-project.y * 0.5 + 0.5) * H;
    const cell = (H / VIEW_ROWS) * im.size; // ~one cell on screen
    fxCtx.save();
    fxCtx.translate(px, py);
    fxCtx.rotate(im.rot);
    fxCtx.globalAlpha = 1 - k * k;
    // the star: 8 spikes, alternating long/short, ink rim under a white fill
    const outer = cell * (0.35 + 0.45 * Math.min(1, k * 3)), inner = outer * 0.42;
    fxCtx.beginPath();
    for (let j = 0; j < 16; j++) {
      const r = j % 2 ? inner : outer * (j % 4 ? 0.75 : 1);
      const a = (j / 16) * Math.PI * 2;
      fxCtx[j ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    fxCtx.closePath();
    fxCtx.lineWidth = 4;
    fxCtx.strokeStyle = INK;
    fxCtx.stroke();
    fxCtx.fillStyle = k < 0.35 ? '#ffffff' : '#fff3b0';
    fxCtx.fill();
    fxCtx.restore();
  }
  fxCtx.globalAlpha = 1;
  // shield rings: a thin white circle that grows and fades
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.life -= dt;
    if (r.life <= 0) { rings.splice(i, 1); continue; }
    const k = 1 - r.life / RING_LIFE; // 0 → 1
    project.set(wx(r.x), wy(r.y), 0.6).project(camera);
    fxCtx.globalAlpha = 1 - k;
    fxCtx.lineWidth = 4 * (1 - k) + 1;
    fxCtx.strokeStyle = '#ffffff';
    fxCtx.beginPath();
    fxCtx.arc((project.x * 0.5 + 0.5) * W, (-project.y * 0.5 + 0.5) * H, 10 + k * 34, 0, Math.PI * 2);
    fxCtx.stroke();
  }
  fxCtx.globalAlpha = 1;
  fxCtx.strokeStyle = INK;

  // depth ruler on the left cliff edge every 10m (bigger tag every 100m), like the 2D build
  const firstRow = Math.floor(-camY - 9), lastRow = Math.ceil(-camY + 9);
  for (let row = Math.max(SKY_ROWS, firstRow); row <= lastRow; row++) {
    const d = depthOfRow(row);
    if (d <= 0 || d % 10 !== 0 || (!game.stage.endless && d > stageDepth(game.stage))) continue;
    project.set(-0.62, wy(row), 0).project(camera);
    const px = (project.x * 0.5 + 0.5) * W, py = (-project.y * 0.5 + 0.5) * H;
    const major = d % 100 === 0;
    fxCtx.font = `${major ? 24 : 17}px "Jua", "Apple SD Gothic Neo", sans-serif`;
    fxCtx.textAlign = 'right';
    fxCtx.lineWidth = 4;
    fxCtx.strokeStyle = INK;
    fxCtx.globalAlpha = major ? 1 : 0.8;
    fxCtx.strokeText(`${d}m`, px, py);
    fxCtx.fillStyle = major ? '#f5c542' : '#e6f3ff';
    fxCtx.fillText(`${d}m`, px, py);
  }
  fxCtx.globalAlpha = 1;
  fxCtx.textAlign = 'center';

  // level transition: an aurora band sweeps down the screen as you enter the next depth band
  if (levelWipe > 0) {
    levelWipe = Math.max(0, levelWipe - dt);
    const k = 1 - levelWipe / 1.3; // 0 → 1
    const cy = -H * 0.3 + k * H * 1.6;
    const band = fxCtx.createLinearGradient(0, cy - H * 0.25, 0, cy + H * 0.25);
    band.addColorStop(0, 'rgba(80,240,190,0)');
    band.addColorStop(0.45, 'rgba(80,240,190,0.28)');
    band.addColorStop(0.55, 'rgba(170,140,255,0.28)');
    band.addColorStop(1, 'rgba(170,140,255,0)');
    fxCtx.globalCompositeOperation = 'lighter';
    fxCtx.fillStyle = band;
    fxCtx.fillRect(0, cy - H * 0.25, W, H * 0.5);
    fxCtx.globalCompositeOperation = 'source-over';
  }
  // combo meter over the head (item 11): drawn first so "!" can sit above it
  const meter = game.comboTimer > 0 && game.state === 'playing';
  if (meter) drawComboMeter(t);
  // Danger "!" over the hero when something straight above it is shaking loose (crushes were the
  // most common death; scanDanger decides). Drawn as an inked speech bubble that pulses.
  // UI review 14: red is not the only cue. The bubble's tail points at the hero, it rattles side to
  // side like the shaking blocks, and the "!" is inked so it reads on any hue (white on red was ~3:1).
  if (danger && game.state === 'playing') {
    project.set(mole.position.x, mole.position.y + 0.95, 0.6).project(camera);
    const px = (project.x * 0.5 + 0.5) * W, py = (-project.y * 0.5 + 0.5) * H - (meter ? 26 : 0);
    const still = reduceMotion.matches; // a still bubble: the tail and inked "!" still carry it
    const r = still ? 15 : 15 + Math.sin(t * 16) * 2.5;
    fxCtx.save();
    fxCtx.translate(px, py);
    if (!still) fxCtx.rotate(Math.sin(t * 30) * 0.16); // the rattle, pivoting on the bubble's centre
    fxCtx.lineWidth = 3;
    fxCtx.lineJoin = 'round';
    fxCtx.strokeStyle = INK;
    fxCtx.fillStyle = '#ff5a6e';
    fxCtx.beginPath();
    fxCtx.arc(0, 0, r, Math.PI * 0.62, Math.PI * 0.38); // open at the bottom for the tail
    fxCtx.lineTo(0, r + 9);
    fxCtx.closePath();
    fxCtx.fill();
    fxCtx.stroke();
    fxCtx.font = `${Math.round(r * 1.5)}px "Jua", "Apple SD Gothic Neo", sans-serif`;
    fxCtx.textAlign = 'center';
    fxCtx.textBaseline = 'middle';
    fxCtx.lineWidth = 4;
    fxCtx.strokeText('!', 0, 1);
    fxCtx.fillStyle = '#fff';
    fxCtx.fillText('!', 0, 1);
    fxCtx.restore();
  }
  // soft storybook vignette: pulls the eye to the board and frames the painted edges
  // (gradients are built once per resize; the strength goes through globalAlpha)
  fxCtx.globalAlpha = Math.min(1, 0.28 + (game.level - 1) * 0.06);
  fxCtx.fillStyle = vignette;
  fxCtx.fillRect(0, 0, W, H);
  // low air: a red edge that pulses with each heartbeat (see breathe), stronger as air runs out
  beat = Math.max(0, beat - dt * 2.5);
  if (game.air < AIR_WARNING && game.state === 'playing') {
    fxCtx.globalAlpha = Math.min(1, 0.12 + 0.13 * (1 - Math.max(0, game.air) / AIR_WARNING) + (reduceMotion.matches ? 0 : beat * 0.3)); // steady, not throbbing, under reduced motion
    fxCtx.fillStyle = redVignette;
    fxCtx.fillRect(0, 0, W, H);
  }
  fxCtx.globalAlpha = 1;
  if (banner) {
    banner.life -= dt;
    if (banner.life <= 0) { banner = null; return; }
    fxCtx.globalAlpha = Math.min(1, banner.life * 2);
    fxCtx.font = '64px "Jua", "Apple SD Gothic Neo", sans-serif';
    fxCtx.lineWidth = 8;
    fxCtx.strokeText(banner.text, W / 2, H * 0.2);
    fxCtx.fillStyle = '#ffe14a';
    fxCtx.fillText(banner.text, W / 2, H * 0.2);
    if (banner.sub) drawPrompt(banner.sub, H * 0.2 + 48);
    fxCtx.globalAlpha = 1;
  }
}

// Combo meter over the head (studio review 2 item 11): the feet put it under the next block's ink,
// where nobody looked. 64×10 CSS px (the fx canvas is DPR-scaled, so it stays crisp); drains over
// the combo window, pink with the count once a combo runs, faint gold while the window is merely
// open, and blinks in its last COMBO_BLINK seconds (our tuning) so "hit now" reads at a glance.
const COMBO_BLINK = 0.4;
function drawComboMeter(t: number) {
  project.set(mole.position.x, mole.position.y + 1.1, 0.6).project(camera);
  const px = (project.x * 0.5 + 0.5) * W, py = (-project.y * 0.5 + 0.5) * H;
  const w = 64, h = 10, fill = Math.min(1, game.comboTimer / COMBO_WINDOW);
  const blink = game.comboTimer < COMBO_BLINK && Math.floor(t * 10) % 2 === 0;
  fxCtx.globalAlpha = (game.combo > 0 ? 1 : 0.6) * (blink ? 0.35 : 1);
  fxCtx.fillStyle = INK;
  fxCtx.fillRect(px - w / 2 - 2, py - h / 2 - 2, w + 4, h + 4);
  fxCtx.fillStyle = '#fdf6e3';
  fxCtx.fillRect(px - w / 2, py - h / 2, w, h);
  fxCtx.fillStyle = game.combo > 0 ? COMBO_COLOR : '#f5c542';
  fxCtx.fillRect(px - w / 2, py - h / 2, w * fill, h);
  if (game.combo > 0) {
    if (comboLabelN !== game.combo) { comboLabelN = game.combo; comboLabel = `×${game.combo}`; }
    fxCtx.font = '18px "Jua", "Apple SD Gothic Neo", sans-serif';
    fxCtx.textAlign = 'left';
    fxCtx.lineWidth = 4;
    fxCtx.strokeStyle = INK;
    fxCtx.strokeText(comboLabel, px + w / 2 + 6, py);
    fxCtx.fillStyle = COMBO_COLOR;
    fxCtx.fillText(comboLabel, px + w / 2 + 6, py);
    fxCtx.textAlign = 'center';
  }
  fxCtx.globalAlpha = 1;
}

// Tutorial prompt under the level banner: word-wrapped to the board width, same ink outline.
function drawPrompt(text: string, top: number) {
  fxCtx.font = '22px "Jua", "Apple SD Gothic Neo", sans-serif';
  const maxW = Math.min(460, W - 32);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && fxCtx.measureText(next).width > maxW) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  fxCtx.lineWidth = 5;
  lines.forEach((l, i) => {
    fxCtx.strokeText(l, W / 2, top + i * 28);
    fxCtx.fillStyle = '#fdf6e3';
    fxCtx.fillText(l, W / 2, top + i * 28);
  });
}

// HUD juice: the score rolls up toward its target and the badge bumps; hearts pop when lost.
let shownScore = -1, shownLives = -1, shownAir = -1; // -1: draw once on the first frame (a 0 score was left blank)
function bump(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(cls);
}
// Medal line (studio review 2 item 13): the one number this stage's next medal turns on, e.g.
// '★★☆ 망치 142/190'. medalMetric reads its target back from stages.ts. Refreshed a few times a
// second, and the DOM only when the text changes (no per-frame strings).
const medalEl = document.getElementById('medal-line');
const METRIC_EVERY = 0.25; // s, our choice
let metricT = 0, metricShown = '', dryWarned = 0;
const liveStats = (level = game.level): LiveStats => ({ ...game.stats, time: game.time, level, depth: depthOf(game) });
function syncMedalLine(dt: number) {
  metricT -= dt;
  if (metricT > 0 || !medalEl) return;
  metricT = METRIC_EVERY;
  const m = started && !startDepth ? medalMetric(currentStage, liveStats(), recordOf(progress, currentStage)?.medal) : null;
  const html = m ? `${m.textKo}${m.noteKo ? `<small>${m.noteKo}</small>` : ''}` : '';
  if (html !== metricShown) {
    metricShown = html;
    medalEl.innerHTML = html;
    medalEl.hidden = !m;
  }
  medalEl.classList.toggle('met', !!m?.met);
  // dry level ahead (aurora): a warning in the last 20m, while there is still time to top up
  const next = game.level + 1;
  if (started && game.state === 'playing' && dryWarned !== next && isDryLevel(game.stage, next) && depthOf(game) >= game.level * 100 - 20) {
    dryWarned = next;
    toast('곧 캡슐 적은 층 · 지금 공기를 채워요', 4, undefined, '⚠️');
  }
}
// HUD text is rewritten every frame: touch the DOM only when it changes
function setText(e: HTMLElement, t: string) { if (e.textContent !== t) e.textContent = t; }
function drawHud(dt = 0) {
  syncMedalLine(dt);
  if (game.lives !== shownLives) {
    if (shownLives >= 0) bump(livesEl, game.lives < shownLives ? 'hurt' : 'bump');
    shownLives = game.lives;
    livesEl.textContent = '♥'.repeat(Math.max(0, game.lives)) || '—';
    livesEl.setAttribute('aria-label', `목숨 ${Math.max(0, game.lives)}`); // hearts alone read as symbols
  }
  if (shownScore !== game.score) {
    if (shownScore < 0 || shownScore > game.score) shownScore = Math.max(0, game.score - 1); // first frame / reset
    const step = Math.max(1, Math.ceil((game.score - shownScore) * Math.min(1, dt * 10)));
    const before = shownScore;
    shownScore = Math.min(game.score, shownScore + step);
    if (Math.floor(before / 100) !== Math.floor(shownScore / 100)) bump(scoreEl, 'bump');
    scoreEl.textContent = shownScore.toLocaleString();
  }
  setText(depthM, String(depthOf(game)));
  setText(depthLv, `Lv${game.level}`);
  // Korean label outside the bar (UI review 3); the clock stage shows its timer there instead
  const air = Math.max(0, Math.ceil(game.air));
  const clock = game.stage.air.kind === 'none';
  setText(airIcon, clock ? '⏱' : '🫧');
  setText(airText, game.stage.air.kind === 'swing' ? `공기 ${air}% · 망치 ${game.stats.swings}`
    : clock ? `${Math.max(0, game.time - game.stats.clockSaved).toFixed(1)}초 (시계 -${game.stats.clockSaved}초)`
    : `공기 ${air}%`);
  airFill.style.width = `${(Math.max(0, game.air) / AIR_MAX) * 100}%`;
  if (air !== shownAir) { shownAir = air; airEl.setAttribute('aria-valuenow', String(air)); } // no per-frame attribute write
  airRow.classList.toggle('low', game.air < AIR_WARNING);
}

// shaking blocks near the hero tick faster as their fall nears (0.25s → 0.10s, our tuning)
function wobbleTicks(dt: number) {
  if (wobbleNear < 0 || game.state !== 'playing' || dt === 0) { wobbleTickT = 0; return; }
  wobbleTickT -= dt;
  if (wobbleTickT > 0) return;
  sfxWobbleTick();
  wobbleTickT = 0.25 - wobbleNear * 0.15;
}

let prev = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  // ease the framing between play (tight on phones) and title/results (wide); cliffs refit to it
  const wantWide = !started || game.state !== 'playing' ? 1 : 0;
  if (Math.abs(wantWide - wideShot) > 1e-3) {
    wideShot += (wantWide - wideShot) * Math.min(1, dt * 3);
    if (Math.abs(wantWide - wideShot) <= 1e-3) wideShot = wantWide;
    if (camera.aspect < 0.8) fitCliffs();
  }
  props?.update(dt, wy(view.y)); // penguin life (wall time, also on the title) + distance culling
  // Music follows the pace (playtest: tension): relaxed after a clear row, pressing near the next.
  if (started && game.state === 'playing' && !paused) {
    const pace = (levelAirTempo(game) - AIR_START) / (AIR_END - AIR_START); // music follows the squeeze
    const urgency = game.stage.air.kind === 'time' && game.air < 40 ? (40 - Math.max(0, game.air)) / 40 : 0;
    musicTick(pace, urgency);
    // one cue per level when the squeeze starts, so the speed-up reads as a beat, not drift
    if (levelProgress(game) > 0.6 && paceCueLevel !== game.level) {
      paceCueLevel = game.level;
      floaters.push({ x: game.mole.x, y: game.mole.y - 1.4, text: '⚡ 빨라진다!', life: 1.1, color: '#ffd86b' });
      shake = Math.max(shake, 0.08);
    }
  } else musicStop();
  prev = now;
  const t = now / 1000;

  if (!paused) {
    for (const [dir, wait] of held) {
      if (dir === 'up' || dir === 'down') continue;
      const next = wait - dt;
      if (next <= 0) { move(game, dir); held.set(dir, MOVE_RATE); }
      else held.set(dir, next);
    }
    // buffers count game time: a hitstop must not eat a press made during it
    const simDt = hitStop > 0 || !started ? 0 : dt;
    if (drillHeld) tryDrill(true);
    else if (drillBuf > 0) {
      if (moleAt() !== drillBufAt) drillBuf = 0; // moved or turned: the press was for the old target
      else { drillBuf = Math.max(0, drillBuf - simDt); tryDrill(true); }
    }
    if (moveBuf > 0) {
      moveBuf = Math.max(0, moveBuf - simDt);
      if (game.mole.facing !== moveBufDir || tryMove(moveBufDir)) moveBuf = 0; // turned away, or stepped
    }
    if (hitStop > 0) hitStop = Math.max(0, hitStop - dt); // the world holds; effects keep animating
    else if (started) update(game, dt);
    recordGhost();
  }
  for (const e of game.events) handleEvent(e);
  game.events.length = 0;

  const vdt = paused ? 0 : dt; // paused: everything holds still, the frame still draws
  TIME.value = t;
  if (!paused) { scanDanger(started); keyTipCheck(); } // paused: "!" holds as it was
  syncMole(t, vdt);
  syncGhostHero();
  syncBlocks(t, vdt);
  syncParticles(vdt);
  syncFlashes(vdt);
  syncGhosts(vdt);
  breathe(vdt);
  wobbleTicks(vdt);
  syncPuffs(vdt);
  syncToast(vdt);
  syncHint(vdt);
  syncCamera(vdt);
  syncSky(t, vdt);
  renderer.render(scene, camera);
  drawFx(t, vdt);
  drawHud(vdt);
  requestAnimationFrame(frame);
}

reset();
resize();
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
requestAnimationFrame(frame);
startVersionCheck();
