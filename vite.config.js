import { defineConfig } from 'vite';

// Unique per build. Baked into the bundle so (a) every build's entry chunk has
// a different content hash — a STALE chunk can never be referenced by a fresh
// index.html again — and (b) the running build is visible in-app for diagnosis.
const BUILD_ID = new Date().toISOString().slice(5, 16).replace('T', ' ');

// Single-page app. The whole UI lives in index.html + /src.
// `api/` is handled by Vercel serverless functions in production and is
// not part of the Vite build.
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 4321,
    host: true,
  },
  preview: {
    port: 4321,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
