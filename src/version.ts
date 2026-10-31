// Stale-page guard. GitHub Pages sends max-age=600 for every file and phones restore tabs from
// memory, so a player can keep running an old build after a deploy. On load and whenever the tab
// comes back, ask for version.json (cache-busted) and, if the deploy is newer, show a small
// "새 버전" button that reloads. The build id is also shown faintly on the title (bug reports).
declare const __BUILD__: string;
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

let offered = false;
async function check() {
  if (BUILD === 'dev' || offered) return;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { build } = await r.json() as { build?: string };
    if (build && build !== BUILD) offer();
  } catch { /* offline: keep playing */ }
}
function offer() {
  offered = true;
  const b = document.createElement('button');
  b.id = 'update';
  b.type = 'button';
  b.textContent = '🔄 새 버전이 있어요 · 탭해서 새로고침';
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', () => location.reload());
  document.body.appendChild(b);
}
export function startVersionCheck() {
  check();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  const tag = document.getElementById('build-tag');
  if (tag) tag.textContent = `v ${BUILD}`;
}
