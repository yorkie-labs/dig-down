import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
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

// GitHub Pages serves the site from /<repo>/: the deploy workflow sets VITE_BASE to that path.
// Asset URLs in the code are page-relative, so they follow the base too.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [versionFile()],
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
