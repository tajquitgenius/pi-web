import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/static/desktop/',
  plugins: [react()],
  build: {
    manifest: true,
    outDir: 'dist-desktop',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        desktop: resolve(__dirname, 'src/desktop/bootstrap.tsx'),
      },
      output: {
        entryFileNames: 'assets/desktop-[hash].js',
        chunkFileNames: 'assets/desktop-chunk-[hash].js',
        assetFileNames: 'assets/desktop-[hash][extname]',
      },
    },
  },
});
