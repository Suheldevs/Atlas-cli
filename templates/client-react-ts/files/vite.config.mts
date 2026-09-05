import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dev proxy is what lets the browser treat the API as same-origin during development.
 *
 * That is not a convenience. The refresh token lives in an `httpOnly`, `sameSite: 'strict'` cookie,
 * and a strict cookie is withheld from cross-site requests — so a client on :5173 talking directly
 * to an API on :5000 would authenticate once and never be able to refresh. Proxying `/api` through
 * the dev server makes both halves the same origin and the cookie behaves in development exactly as
 * it will in production behind a single domain.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
