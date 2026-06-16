import { defineConfig } from 'vite';

// Single-page app. The whole UI lives in index.html + /src.
// `api/` is handled by Vercel serverless functions in production and is
// not part of the Vite build.
export default defineConfig({
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
