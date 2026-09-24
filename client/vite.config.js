import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build id: baked into the bundle as __APP_VERSION__ and also written to
 * dist/version.json. A running page polls version.json; when the two differ a
 * newer deployment is live and UpdateBanner offers a refresh.
 */
const APP_VERSION = new Date().toISOString();

function versionFile() {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: APP_VERSION }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5175,
    // Proxying /api in development means the browser sees one origin, so the
    // client never needs to know the API host and CORS stays out of the way.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
    // Deploy tooling writes temporary <guid>-app.zip archives into this folder
    // while they are still locked; watching one crashes the dev server (EBUSY).
    // Build output is not source either.
    watch: {
      ignored: ['**/*.zip', '**/dist/**'],
    },
  },
  build: {
    outDir: 'dist',
    /**
     * Hidden source maps.
     *
     * Still emitted - a production stack trace is unreadable without them, and
     * this application will be debugged from a factory floor rather than from
     * a laptop that can reproduce the bug. But no `//# sourceMappingURL`
     * comment is appended to the bundles, so a browser does not fetch them and
     * a visitor with devtools open is not handed the whole annotated source.
     *
     * The maps are ~1.5 MB per build. Keep them with the release for whoever
     * has to read a trace; there is no reason to ship them to the browser.
     */
    sourcemap: 'hidden',
  },
});
