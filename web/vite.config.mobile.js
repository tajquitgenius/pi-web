import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/static/mobile/',
  plugins: [react()],
  build: {
    manifest: true,
    outDir: 'dist-mobile',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        mobile: resolve(__dirname, 'src/mobile/bootstrap.tsx'),
      },
      output: {
        entryFileNames: 'assets/mobile-[hash].js',
        chunkFileNames: 'assets/mobile-chunk-[hash].js',
        assetFileNames: 'assets/mobile-[hash][extname]',
      },
    },
  },
});
