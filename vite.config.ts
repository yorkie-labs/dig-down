import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Build id: the commit (or 'dev'). Baked into the bundle and written to version.json, so a page
// that the browser kept (GitHub Pages caches HTML 10 min, phones resume tabs from memory) can
// notice a newer deploy and offer a reload.
const BUILD = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
})();
const versionFile = (): Plugin => ({
  name: 'version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
  },
});

// PWA service worker: src/sw-template.js with the build id and the precache list (every file the
// build wrote, except dev pages and local-only model copies), written as dist/sw.js.
// dev-only hero styles (puppy-crayon/pixel/idle, ?style=) are left to the runtime cache
const PRECACHE_SKIP = /^(dev\/|models\/)|\.map$|^version\.json$|^2d\.html$|^fonts\/OFL\.txt$|^sprites\/puppy-(crayon|pixel|idle)\.png$|^assets\/legacy-/;
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const serviceWorker = (): Plugin => ({
  name: 'service-worker',
  apply: 'build',
  // after the files are on disk: the bundle map still lists chunks the build later drops (an
  // empty index-*.js), and one missing file fails the worker's whole install
  writeBundle(opts) {
    const out = opts.dir ?? resolve(__dirname, 'dist');
    const list = ['./', ...walk(out).map((p) => relative(out, p).split('\\').join('/'))
      .filter((f) => f !== 'sw.js' && !PRECACHE_SKIP.test(f) && !f.endsWith('.DS_Store'))].sort();
    const src = readFileSync(resolve(__dirname, 'src/sw-template.js'), 'utf8')
      .replace("'dig-down-__BUILD__'", `'dig-down-${BUILD}'`)
      .replace('= __PRECACHE__;', `= ${JSON.stringify(list)};`);
    writeFileSync(join(out, 'sw.js'), src);
  },
});

// GitHub Pages serves the site from /<repo>/: the deploy workflow sets VITE_BASE to that path.
// Asset URLs in the code are page-relative, so they follow the base too.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [versionFile(), serviceWorker()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, '3d.html'),
        legacy: resolve(__dirname, '2d.html'),
      },
    },
  },
});
