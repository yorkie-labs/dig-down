// Stale-page guard. GitHub Pages sends max-age=600 for every file and phones restore tabs from
// memory, so a player can keep running an old build after a deploy. On load and whenever the tab
// comes back, ask for version.json (cache-busted) and, if the deploy is newer, show a small
// "새 버전" button that reloads (on the title screen it reloads straight away). The build id is also shown faintly on the title (bug reports).
declare const __BUILD__: string;
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

let offered = false;
async function check() {
  if (BUILD === 'dev' || offered) return;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { build } = await r.json() as { build?: string };
    if (build && build !== BUILD) {
      // on the title (no run to lose) just load the new build; mid-run, offer the button
      // once per target build (sessionStorage): if a reload still served the old page, don't loop
      let tried = '';
      try { tried = sessionStorage.getItem('dig-down:reloaded-for') ?? ''; } catch { /* blocked */ }
      if (document.body.classList.contains('on-title') && tried !== build) {
        offered = true;
        try { sessionStorage.setItem('dig-down:reloaded-for', build); } catch { /* blocked */ }
        location.reload();
      }
      else offer();
    }
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
  // PWA: offline cache + installability. Production only: in dev the worker would cache the
  // Vite dev modules and serve stale code.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* not fatal: the game still runs online */ });
  }
  check();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, 5 * 60_000); // an installed app can stay open for hours
  navigator.serviceWorker?.addEventListener('controllerchange', () => { if (navigator.serviceWorker.controller) check(); });
  const tag = document.getElementById('build-tag');
  if (tag) tag.textContent = `v ${BUILD}`;
}
