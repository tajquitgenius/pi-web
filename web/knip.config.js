/** @type {import('knip').KnipConfig} */
export default {
  exclude: ['exports', 'types', 'nsExports', 'nsTypes', 'enumMembers', 'namespaceMembers'],
  entry: [
    'src/desktop/bootstrap.tsx',
    'src/mobile/bootstrap.tsx',
    'src/export/export-entry.js',
    'src/**/*.test.{js,ts,tsx}',
  ],
  project: ['src/**/*.{js,ts,tsx,svelte}', 'scripts/*.mjs', '*.config.js'],
};
