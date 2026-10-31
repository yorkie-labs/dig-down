import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/: the deploy workflow sets VITE_BASE to that path.
// Asset URLs in the code are page-relative, so they follow the base too.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
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
