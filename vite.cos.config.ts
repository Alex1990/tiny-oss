import { defineConfig } from 'vite';

// Tencent COS entry — `tiny-oss.cos.es.js`. Self-contained: no OSS
// signing code inside.
export default defineConfig({
  build: {
    target: 'es2015',
    lib: {
      entry: 'src/cos/index.ts',
      fileName: () => 'tiny-oss.cos.es.js',
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
  },
});
