import { defineConfig } from 'vite';

// AWS S3 entry — `tiny-oss.aws.es.js`. Self-contained: no OSS, COS or
// OBS signing code inside.
export default defineConfig({
  build: {
    target: 'es2015',
    lib: {
      entry: 'src/aws/index.ts',
      fileName: () => 'tiny-oss.aws.es.js',
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
  },
});
