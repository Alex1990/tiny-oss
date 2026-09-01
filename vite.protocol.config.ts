import { defineConfig } from 'vite';

// Protocol layer entry — `tiny-oss.protocol.es.js`. Exposes the
// operation factories and shared helpers for building custom providers.
export default defineConfig({
  build: {
    target: 'es2015',
    lib: {
      entry: 'src/provider.ts',
      fileName: () => 'tiny-oss.protocol.es.js',
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
  },
});
