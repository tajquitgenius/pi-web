import { svelte } from '@sveltejs/vite-plugin-svelte';
import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Builds the static export snapshot bundle as a single self-contained IIFE.
// The output (dist-export/export.js) is inlined verbatim into a <script> tag by
// internal/ui/export.go, alongside the vendor marked/highlight.js globals it
// reads from window. No code splitting, no manifest, no dynamic imports — the
// snapshot must run from a single file with no server.
//
// Svelte is retained only for this static renderer. Components carry no <style>
// blocks (all CSS lives in internal/ui/embedded/styles/session.css), so no CSS
// chunk is emitted and the snapshot stays a single JS file. The copy plugin
// keeps Go's embed target current in normal builds and watch mode.
export default defineConfig({
  plugins: [
    svelte({ emitCss: false }),
    {
      name: 'sync-embedded-export',
      writeBundle() {
        copyFileSync(
          resolve(__dirname, 'dist-export/export.js'),
          resolve(__dirname, '../internal/ui/embedded/export/export.js'),
        );
      },
    },
  ],
  build: {
    outDir: 'dist-export',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/export/export-entry.js'),
      formats: ['iife'],
      name: 'PiExport',
      fileName: () => 'export.js',
    },
    minify: true,
  },
});
