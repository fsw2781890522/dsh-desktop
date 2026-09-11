import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    // Sandboxed Electron preloads run as CommonJS even though the application package is ESM.
    // Each entry must stay one file: a shared chunk cannot be `require`d inside the sandbox.
    entry: {
      preload: 'lib/types/preload.js',
      'preload-app': 'lib/types/preload-app.js',
    },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    splitting: false,
    deps: { neverBundle: ['electron'] },
  },
])
