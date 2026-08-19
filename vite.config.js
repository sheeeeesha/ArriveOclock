import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// The version shown in-app is read from the SAME place the Play Store gets it
// (android/app/build.gradle), because a hardcoded string in index.html silently
// sat at v1.0.9 for five releases while the APK itself was current — which made
// a perfectly good build look stale during device testing.
function androidVersionName() {
  try {
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    return /versionName\s+"([^"]+)"/.exec(gradle)?.[1] || 'dev';
  } catch {
    return 'dev';
  }
}

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
    __APP_VERSION__: JSON.stringify(androidVersionName()),
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
