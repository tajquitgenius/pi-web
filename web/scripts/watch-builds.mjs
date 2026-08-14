import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const configFiles = [
  'vite.config.desktop.js',
  'vite.config.mobile.js',
  'vite.config.export.js',
].map((file) => resolve(root, file));

await Promise.all(
  configFiles.map((configFile) =>
    build({
      configFile,
      build: { watch: {} },
    }),
  ),
);
