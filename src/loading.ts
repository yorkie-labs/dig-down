// Initial loading screen: #loading (in 3d.html, visible before this bundle even arrives) shows
// progress of every texture/sprite the game needs (three's DefaultLoadingManager: all our
// TextureLoaders use it) and the web font, then fades out. Background props stream from the
// Polyfork CDN on their own manager and never hold the game. A timeout lets the game start even
// if one file stalls (it shows its fallback until the file lands).
import * as THREE from 'three';

const el = document.getElementById('loading');
const bar = document.getElementById('loading-bar');
const label = document.getElementById('loading-pct');
const MAX_WAIT = 15_000; // ms, our tuning
let done = false, texturesDone = false, fontDone = false;
let shown = 0; // eased display value, so the bar never jumps backwards when new files queue up

function setProgress(p: number) {
  shown = Math.max(shown, Math.min(1, p));
  if (bar) bar.style.transform = `scaleX(${shown})`;
  if (label) label.textContent = `${Math.round(shown * 100)}%`;
}
const HOLD = import.meta.env.DEV && new URLSearchParams(location.search).has('holdloading'); // dev: review the screen
function finish() {
  if (done || !el || HOLD) return;
  done = true;
  setProgress(1);
  el.classList.add('done'); // CSS fade
  setTimeout(() => el.remove(), 500);
}
const check = () => { if (texturesDone && fontDone) finish(); };

const mgr = THREE.DefaultLoadingManager;
mgr.onProgress = (_url, loaded, total) => setProgress((loaded / Math.max(1, total)) * 0.95);
mgr.onLoad = () => { texturesDone = true; check(); };
// the canvas text (banners, floaters) needs the face loaded, not just declared
(document.fonts?.load('16px Jua') ?? Promise.resolve()).catch(() => {}).then(() => { fontDone = true; check(); });
setTimeout(finish, MAX_WAIT);

export const isLoading = () => !done;
