import { defineConfig } from 'vite';

// Azure Blob Storage entry — `tiny-oss.azure.es.js`. Self-contained:
// no OSS, COS, OBS or AWS signing code inside.
export default defineConfig({
  build: {
    target: 'es2015',
    lib: {
      entry: 'src/azure/index.ts',
      fileName: () => 'tiny-oss.azure.es.js',
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
  },
});
