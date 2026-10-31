import {
  AIR_CAPSULE, AIR_MAX, AIR_WARNING, CAPSULE, cellAt, CLEAR, createGame, depthOf, depthOfRow, Dir, drill, Game,
  GameEvent, GOAL_DEPTH, SCORE_POP, LEVEL_DEPTH, levelOfDepth, move, SKY_ROWS, update, XBLOCK, XBLOCK_HP,
} from './game';

// Crayon palettes, one per 100m level; the first is the sketch's red/yellow/green/blue.
const PALETTES = [
  ['#ef3b4f', '#ffe14a', '#2f9e44', '#3da9f5'],
  ['#f28a5a', '#c58af0', '#38c9b0', '#ffd23f'],
  ['#ff6fa8', '#7bd389', '#4f7cff', '#ffb347'],
  ['#e84855', '#f9dc5c', '#3185fc', '#a1e44d'],
  ['#ff5d8f', '#ffe066', '#00c2d1', '#b28dff'],
];
const DIRT = ['#8a6418', '#7a5226', '#62563a', '#4d3f5e', '#3d2b2b'];
const TUNNEL = ['#3d2a12', '#36230f', '#2c2a1c', '#241d30', '#1e1414'];
const XBLOCK_COLOR = '#8b5a2b';
const CLEAR_COLOR = '#4fe3c1';
const SKY = '#1f6fc8';
const INK = '#111';

const SIDE_TILES = 2;
const VIEW_ROWS = 12; // the original shows 12 rows of a 9-wide field
const MOVE_DELAY = 0.2;
const MOVE_RATE = 0.11;
const BEST_KEY = 'dig-down:best';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const $ = (id: string) => document.getElementById(id)!;
const livesEl = $('lives');
const scoreEl = $('score');
const depthEl = $('depth');
const airEl = $('air');
const airFill = $('air-fill');
const airText = $('air-text');
const overlay = $('overlay');
const overlayTitle = $('overlay-title');
const overlayStats = $('overlay-stats');

let game: Game;
let view = { x: 0, y: 0 }; // smoothed mole position in tiles
let camY = 0;
let shake = 0;
let tile = 32;
let W = 0;
let H = 0;
let banner: { text: string; life: number } | null = null;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }
let particles: Particle[] = [];
interface Floater { x: number; y: number; text: string; life: number; color: string }
let floaters: Floater[] = [];

const levelOfRow = (y: number) => levelOfDepth(depthOfRow(y)) - 1;
const colorOf = (color: number, y: number) =>
  color === XBLOCK ? XBLOCK_COLOR : color === CAPSULE ? '#e8fbff' : color === CLEAR ? CLEAR_COLOR
    : PALETTES[levelOfRow(y)][color];

function reset() {
  game = createGame();
  view = { x: game.mole.x, y: game.mole.y };
  camY = targetCam();
  particles = [];
  floaters = [];
  banner = { text: 'LEVEL 1', life: 1.6 };
  held.clear();
  drillHeld = false;
  overlay.hidden = true;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tile = Math.floor(Math.min(W / (game.cols + SIDE_TILES * 2), H / VIEW_ROWS));
}

function targetCam() {
  const min = -3 * tile;
  const max = (game.rows + 2) * tile - H;
  return Math.max(min, Math.min(max, view.y * tile - H * 0.4));
}

// ---- input ----
// Left/right repeat while held; up/down just point the drill. The drill repeats on its cooldown.
const held = new Map<Dir, number>();
let drillHeld = false;
const KEYS: Record<string, Dir> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
};
const DRILL_KEYS = new Set([' ', 'z', 'Z', 'j', 'J']);

function pressDir(dir: Dir) {
  if (held.has(dir)) return;
  held.set(dir, MOVE_DELAY);
  move(game, dir);
}
function releaseDir(dir: Dir) {
  held.delete(dir);
  // fall back to another still-held direction so the drill keeps pointing sensibly
  const last = [...held.keys()].at(-1);
  if (last) game.mole.facing = last;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') { reset(); return; }
  if (DRILL_KEYS.has(e.key)) { e.preventDefault(); drillHeld = true; drill(game); return; }
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
window.addEventListener('blur', () => { held.clear(); drillHeld = false; });

const RELEASE_EVENTS = ['pointerup', 'pointercancel', 'pointerleave'];
for (const btn of document.querySelectorAll<HTMLButtonElement>('#pad [data-dir]')) {
  const dir = btn.dataset.dir as Dir;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); pressDir(dir); });
  for (const ev of RELEASE_EVENTS) btn.addEventListener(ev, () => releaseDir(dir));
}
const drillBtn = $('drill-btn');
drillBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); drillHeld = true; drill(game); });
for (const ev of RELEASE_EVENTS) drillBtn.addEventListener(ev, () => { drillHeld = false; });
$('restart').addEventListener('click', reset);

// ---- effects ----
function handleEvent(e: GameEvent) {
  switch (e.type) {
    case 'drill':
      for (const c of e.cells) burst(c.x, c.y, colorOf(c.color, c.y), 4);
      break;
    case 'pop': {
      for (const c of e.cells) burst(c.x, c.y, colorOf(c.color, c.y), 8);
      const mid = e.cells[Math.floor(e.cells.length / 2)];
      const points = e.cells.length * SCORE_POP * e.chain;
      if (e.chain > 1) {
        floaters.push({ x: mid.x + 0.5, y: mid.y - 0.6, text: `${e.chain} CHAIN ×${e.chain}`, life: 1.2, color: '#ffe14a' });
        floaters.push({ x: mid.x + 0.5, y: mid.y + 0.2, text: `AIR +${e.air}%`, life: 1.2, color: '#5fd3ff' });
        airEl.classList.add('gain');
        setTimeout(() => airEl.classList.remove('gain'), 400);
      } else {
        floaters.push({ x: mid.x + 0.5, y: mid.y, text: `+${points}`, life: 1, color: '#fff' });
      }
      shake = Math.max(shake, 4 + e.chain * 2);
      break;
    }
    case 'chip':
      burst(e.x, e.y, XBLOCK_COLOR, 3);
      shake = Math.max(shake, 2);
      break;
    case 'xbreak':
      burst(e.x, e.y, '#b388ff', 12);
      floaters.push({ x: e.x + 0.5, y: e.y, text: 'AIR -20%', life: 1, color: '#ff6b7a' });
      shake = Math.max(shake, 5);
      break;
    case 'capsule':
      burst(e.x, e.y, '#5fd3ff', 10);
      floaters.push({ x: e.x + 0.5, y: e.y, text: `AIR +${AIR_CAPSULE}%  ${e.points}`, life: 1, color: '#5fd3ff' });
      break;
    case 'levelclear':
      for (let x = 0; x < game.cols; x++) burst(x, e.y, CLEAR_COLOR, 6);
      floaters.push({ x: game.cols / 2, y: e.y - 0.5, text: `LEVEL CLEAR +${e.bonus.toLocaleString()}`, life: 1.6, color: CLEAR_COLOR });
      shake = Math.max(shake, 8);
      break;
    case 'land':
      shake = Math.max(shake, 2);
      break;
    case 'crush':
      burst(e.x, e.y, '#fff', 14);
      shake = 12;
      break;
    case 'suffocate':
      floaters.push({ x: game.mole.x + 0.5, y: game.mole.y - 0.5, text: '숨 막혀!', life: 1.2, color: '#ff6b7a' });
      shake = 8;
      break;
    case 'extend':
      banner = { text: '1UP!', life: 1.8 };
      floaters.push({ x: game.mole.x + 0.5, y: game.mole.y - 0.5, text: '♥ +1', life: 1.4, color: '#ff6b9a' });
      break;
    case 'level':
      banner = { text: `LEVEL ${e.level}`, life: 1.8 };
      break;
    case 'won':
      showResults('도착! 🎉', e.bonus);
      break;
    case 'lost':
      showResults('GAME OVER', 0);
      break;
  }
}

function burst(x: number, y: number, color: string, n: number) {
  for (let i = 0; i < n; i++) {
    particles.push({
      x: x + 0.5, y: y + 0.5,
      vx: (Math.random() - 0.5) * 8, vy: -Math.random() * 6 - 1,
      life: 0.5 + Math.random() * 0.4, color, size: 0.12 + Math.random() * 0.14,
    });
  }
}

function loadBest(): { depth: number; score: number } {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage unavailable: no record */ }
  return { depth: 0, score: 0 };
}

function saveBest(best: { depth: number; score: number }) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* ignore */ }
}

function showResults(title: string, bonus: number) {
  const depth = depthOf(game);
  const prev = loadBest();
  const best = { depth: Math.max(prev.depth, depth), score: Math.max(prev.score, game.score) };
  saveBest(best);
  const mins = Math.floor(game.time / 60);
  const secs = Math.floor(game.time % 60).toString().padStart(2, '0');
  const rows: [string, string, boolean?][] = [
    ['깊이', `${depth}m / ${GOAL_DEPTH}m`, depth > prev.depth],
    ['점수', game.score.toLocaleString(), game.score > prev.score],
    ['시간', `${mins}:${secs}`],
    ['최고 기록', `${best.depth}m · ${best.score.toLocaleString()}`],
  ];
  if (bonus) rows.splice(2, 0, ['목숨 보너스', `+${bonus.toLocaleString()}`]);
  overlayStats.replaceChildren(...rows.flatMap(([k, v, isNew]) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = isNew ? `${v} NEW!` : v;
    if (isNew) dd.className = 'best';
    return [dt, dd];
  }));
  overlayTitle.textContent = title;
  overlay.hidden = false;
}

// ---- drawing ----
const shaftX = () => Math.round((W - game.cols * tile) / 2);
const sx = (x: number) => shaftX() + x * tile;
const sy = (y: number) => y * tile - camY;

function hash(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function visibleRows() {
  const first = Math.max(0, Math.floor(camY / tile) - 1);
  const last = Math.min(game.rows + 1, Math.ceil((camY + H) / tile) + 1);
  return [first, last] as const;
}

function drawBackground(t: number) {
  const groundY = sy(SKY_ROWS);
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, W, Math.max(0, groundY));

  ctx.fillStyle = 'rgba(160,200,255,0.85)';
  for (let i = 0; i < 4; i++) {
    const cx = ((hash(i) * W + t * 8 * (i + 1)) % (W + 200)) - 100;
    const cy = groundY - tile * (2.2 + hash(i + 9) * 1.5);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + k * tile * 0.45, cy + Math.sin(k) * 4, tile * 0.5, tile * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const left = shaftX();
  const right = left + game.cols * tile;
  const [first, last] = visibleRows();

  // dirt walls and tunnel, tinted per level
  for (let row = Math.max(first, SKY_ROWS); row < last; row++) {
    const lv = levelOfRow(Math.min(row, game.rows - 1));
    ctx.fillStyle = DIRT[lv];
    ctx.fillRect(0, sy(row), left, tile + 1);
    ctx.fillRect(right, sy(row), W - right, tile + 1);
    if (row < game.rows) {
      ctx.fillStyle = TUNNEL[lv];
      ctx.fillRect(left, sy(row), right - left, tile + 1);
    }
  }

  // crayon hatching and buried rocks
  ctx.lineWidth = 2;
  for (let row = Math.max(first, SKY_ROWS); row < last; row++) {
    for (let side = 0; side < 2; side++) {
      const baseX = side === 0 ? 0 : right;
      const width = side === 0 ? left : W - right;
      const seed = row * 2 + side;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const hx = baseX + hash(seed * 3 + k) * width;
        const hy = sy(row) + hash(seed * 7 + k) * tile;
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + tile * 0.6, hy - tile * 0.25);
      }
      ctx.stroke();
      if (hash(seed * 13) < 0.22) {
        const rx = baseX + (0.2 + hash(seed * 17) * 0.6) * width;
        const ry = sy(row) + tile * 0.5;
        ctx.fillStyle = hash(seed * 19) < 0.3 ? '#151515' : '#6d6d70';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(rx - tile * 0.35, ry + tile * 0.2);
        ctx.lineTo(rx - tile * 0.15, ry - tile * 0.3);
        ctx.lineTo(rx + tile * 0.3, ry - tile * 0.2);
        ctx.lineTo(rx + tile * 0.35, ry + tile * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 2;
      }
    }
    // depth markers every 10m, level lines every 100m
    const depth = depthOfRow(row);
    if (depth > 0 && depth % 10 === 0) {
      const major = depth % LEVEL_DEPTH === 0;
      ctx.fillStyle = major ? '#ffe14a' : 'rgba(255,255,255,0.6)';
      ctx.font = `bold ${Math.floor(tile * (major ? 0.45 : 0.32))}px "Comic Sans MS", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${depth}m`, left - 6, sy(row) + tile / 2);
    }
  }

  // grass
  ctx.strokeStyle = '#3fa34d';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const gx = hash(i + 50) * W;
    if (gx > left - 4 && gx < right + 4) continue;
    ctx.beginPath();
    for (let k = -1; k <= 1; k++) {
      ctx.moveTo(gx + k * 5, groundY);
      ctx.lineTo(gx + k * 8, groundY - tile * 0.35);
    }
    ctx.stroke();
  }

  // ground line and shaft walls
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(3, tile * 0.1);
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(left, groundY);
  ctx.lineTo(left, sy(game.rows));
  ctx.moveTo(right, groundY);
  ctx.lineTo(right, sy(game.rows));
  ctx.moveTo(right, groundY);
  ctx.lineTo(W, groundY);
  ctx.stroke();

  const goalY = sy(game.rows);
  if (goalY < H) {
    ctx.fillStyle = '#ffd93b';
    ctx.fillRect(left, goalY, right - left, tile * 1.2);
    ctx.fillStyle = INK;
    ctx.font = `bold ${Math.floor(tile * 0.6)}px "Comic Sans MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`★ ${GOAL_DEPTH}m GOAL ★`, (left + right) / 2, goalY + tile * 0.6);
  }
}

function drawBlocks(t: number) {
  const [first, last] = visibleRows();
  const ink = Math.max(3, tile * 0.11);
  for (let y = first; y < Math.min(last, game.rows); y++) {
    for (let x = 0; x < game.cols; x++) {
      const cell = cellAt(game, x, y);
      if (!cell) continue;
      const jitter = cell.wobble > 0 && !cell.falling ? Math.sin(t * 70 + x) * tile * 0.06 : 0;
      const px = sx(x) + jitter;
      const py = sy(y);

      if (cell.color === CAPSULE) {
        ctx.fillStyle = TUNNEL[levelOfRow(y)];
        ctx.fillRect(px, py, tile + 0.5, tile + 0.5);
        drawCapsule(px + tile / 2, py + tile / 2, t);
        continue;
      }

      ctx.fillStyle = colorOf(cell.color, y);
      ctx.fillRect(px, py, tile + 0.5, tile + 0.5);
      if (cell.color === XBLOCK) drawXBlock(px, py, cell.hp);
      if (cell.color === CLEAR) drawClearStripe(px, py, t);

      // Ink only on chunk borders. Adjacent same-colored cells always share a chunk,
      // so comparing colors is enough (only capsules never merge).
      const differs = (nx: number, ny: number) => {
        const n = cellAt(game, nx, ny);
        return !n || n.color !== cell.color;
      };
      ctx.strokeStyle = INK;
      ctx.lineWidth = ink;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (differs(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + tile, py); }
      if (differs(x, y + 1)) { ctx.moveTo(px, py + tile); ctx.lineTo(px + tile, py + tile); }
      if (differs(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + tile); }
      if (differs(x + 1, y)) { ctx.moveTo(px + tile, py); ctx.lineTo(px + tile, py + tile); }
      ctx.stroke();
    }
  }
}

function drawClearStripe(px: number, py: number, t: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const shift = ((t * 0.8) % 1) * tile;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, tile, tile);
  ctx.clip();
  ctx.beginPath();
  for (let k = -1; k < 2; k++) {
    const x0 = px + k * tile + shift;
    ctx.moveTo(x0, py + tile);
    ctx.lineTo(x0 + tile * 0.35, py);
    ctx.lineTo(x0 + tile * 0.6, py);
    ctx.lineTo(x0 + tile * 0.25, py + tile);
  }
  ctx.fill();
  ctx.restore();
}

function drawXBlock(px: number, py: number, hp: number) {
  const m = tile * 0.22;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(3, tile * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px + m, py + m);
  ctx.lineTo(px + tile - m, py + tile - m);
  ctx.moveTo(px + tile - m, py + m);
  ctx.lineTo(px + m, py + tile - m);
  ctx.stroke();
  // cracks show how many hits are left
  const damage = XBLOCK_HP - hp;
  ctx.strokeStyle = '#fff3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k < damage; k++) {
    const a = (k / XBLOCK_HP) * Math.PI * 2;
    ctx.moveTo(px + tile / 2, py + tile / 2);
    ctx.lineTo(px + tile / 2 + Math.cos(a) * tile * 0.45, py + tile / 2 + Math.sin(a) * tile * 0.45);
  }
  ctx.stroke();
}

function drawCapsule(cx: number, cy: number, t: number) {
  const bob = Math.sin(t * 4 + cx) * tile * 0.05;
  const w = tile * 0.62;
  const h = tile * 0.78;
  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.lineWidth = Math.max(2.5, tile * 0.08);
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#e8fbff';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, w / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5fd3ff';
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 3, 0, w - 6, h / 2 - 3, [0, 0, w / 2, w / 2]);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.floor(tile * 0.24)}px "Comic Sans MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AIR', 0, -h * 0.18);
  ctx.restore();
}

function drawMole(t: number) {
  const m = game.mole;
  if (m.invuln > 0 && Math.floor(t * 12) % 2 === 0) return;
  const cx = sx(view.x) + tile / 2;
  const cy = sy(view.y) + tile / 2;
  const r = tile * 0.42;
  const look = m.facing === 'left' ? -1 : m.facing === 'right' ? 1 : 0;
  const lookY = m.facing === 'down' ? 1 : m.facing === 'up' ? -1 : 0;
  const lowAir = game.air < AIR_WARNING;

  // drill cone pointing where the next drill will hit
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(lookY, look || (lookY ? 0 : 1)));
  ctx.fillStyle = '#b8bcc6';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, tile * 0.07);
  ctx.beginPath();
  ctx.moveTo(r * 0.6, -r * 0.32);
  ctx.lineTo(r * 1.35, 0);
  ctx.lineTo(r * 0.6, r * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.lineWidth = Math.max(2.5, tile * 0.08);
  ctx.strokeStyle = '#e8732c';
  ctx.beginPath();
  for (let k = -1; k <= 1; k++) {
    ctx.moveTo(cx + k * 3, cy - r * 0.9);
    ctx.lineTo(cx + k * 7 + 4, cy - r * 1.45);
  }
  ctx.stroke();

  ctx.strokeStyle = INK;
  ctx.fillStyle = lowAir ? '#4a5fa8' : '#7b4a14'; // turns blue when gasping, like the original
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.08, r * 0.82, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  for (const side of [-1, 1]) {
    const ex = cx + side * r * 0.3 + look * r * 0.12;
    const ey = cy - r * 0.2 + lookY * r * 0.08;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.17, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(ex + look * r * 0.06, ey + lookY * r * 0.06, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(cx - r * 0.16 + look * r * 0.1, cy + r * 0.25, r * 0.15, r * 0.25);
  ctx.rect(cx + r * 0.01 + look * r * 0.1, cy + r * 0.25, r * 0.15, r * 0.25);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (lowAir) {
    ctx.font = `${Math.floor(tile * 0.6)}px sans-serif`;
    ctx.fillText('☠️', cx, cy - tile * 1.0 + Math.sin(t * 10) * 3);
  } else if (game.time < 2.5 && game.state === 'playing') {
    const bx = cx + tile * 1.3;
    const by = cy - tile * 1.0;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(bx, by, tile * 0.75, tile * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `bold ${Math.floor(tile * 0.5)}px "Comic Sans MS", sans-serif`;
    ctx.fillText('GO', bx, by);
  }
}

function drawParticles(dt: number) {
  particles = particles.filter((p) => (p.life -= dt) > 0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  for (const p of particles) {
    p.vy += 18 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const s = p.size * tile;
    ctx.fillStyle = p.color;
    ctx.fillRect(sx(p.x) - s / 2, sy(p.y) - s / 2, s, s);
    ctx.strokeRect(sx(p.x) - s / 2, sy(p.y) - s / 2, s, s);
  }
}

function drawFloaters(dt: number) {
  floaters = floaters.filter((f) => (f.life -= dt) > 0);
  ctx.font = `bold ${Math.floor(tile * 0.5)}px "Comic Sans MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  for (const f of floaters) {
    f.y -= dt * 1.2;
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.strokeText(f.text, sx(f.x), sy(f.y));
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, sx(f.x), sy(f.y));
  }
  ctx.globalAlpha = 1;
}

function drawOverlayFx(t: number, dt: number) {
  if (game.air < AIR_WARNING && game.state === 'playing') {
    const a = 0.25 + Math.sin(t * 8) * 0.15;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,0,0,0)');
    g.addColorStop(1, `rgba(255,30,50,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (banner) {
    banner.life -= dt;
    if (banner.life <= 0) { banner = null; return; }
    ctx.globalAlpha = Math.min(1, banner.life * 2);
    ctx.font = `bold ${Math.floor(tile * 1.1)}px "Comic Sans MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = INK;
    ctx.strokeText(banner.text, W / 2, H * 0.2);
    ctx.fillStyle = '#ffe14a';
    ctx.fillText(banner.text, W / 2, H * 0.2);
    ctx.globalAlpha = 1;
  }
}

const hudCache: Record<string, string> = {};
function setText(el: HTMLElement, key: string, value: string) {
  if (hudCache[key] === value) return;
  hudCache[key] = value;
  el.textContent = value;
}

function drawHud() {
  setText(livesEl, 'lives', '♥'.repeat(Math.max(0, game.lives)) || '—');
  setText(scoreEl, 'score', game.score.toLocaleString());
  setText(depthEl, 'depth', `${depthOf(game)}m · Lv${game.level}`);
  const air = Math.max(0, Math.ceil(game.air));
  setText(airText, 'air', `AIR ${air}%`);
  airFill.style.width = `${(Math.max(0, game.air) / AIR_MAX) * 100}%`;
  airEl.classList.toggle('low', game.air < AIR_WARNING);
  airEl.setAttribute('aria-valuenow', String(air));
}

// ---- loop ----
let prev = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  const t = now / 1000;

  for (const [dir, wait] of held) {
    if (dir === 'up' || dir === 'down') continue;
    const next = wait - dt;
    if (next <= 0) { move(game, dir); held.set(dir, MOVE_RATE); }
    else held.set(dir, next);
  }
  if (drillHeld) drill(game);

  update(game, dt);
  for (const e of game.events) handleEvent(e);
  game.events.length = 0;

  const k = 1 - Math.pow(0.0001, dt);
  view.x += (game.mole.x - view.x) * k;
  view.y += (game.mole.y - view.y) * k;
  camY += (targetCam() - camY) * (1 - Math.pow(0.01, dt));
  shake *= Math.pow(0.002, dt);

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawBackground(t);
  drawBlocks(t);
  drawMole(t);
  drawParticles(dt);
  drawFloaters(dt);
  ctx.restore();
  drawOverlayFx(t, dt);
  drawHud();

  requestAnimationFrame(frame);
}

reset();
resize();
camY = targetCam();
window.addEventListener('resize', resize);
requestAnimationFrame(frame);
