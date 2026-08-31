import { defineConfig } from 'vite';

// Huawei Cloud OBS entry — `tiny-oss.obs.es.js`. Self-contained: no OSS
// or COS signing code inside.
export default defineConfig({
  build: {
    target: 'es2015',
    lib: {
      entry: 'src/obs/index.ts',
      fileName: () => 'tiny-oss.obs.es.js',
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
  },
});
