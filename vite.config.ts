import { defineConfig } from 'vite';

/**
 * Single build config for every entry bundle. Pick the target with
 * `--mode`:
 *
 *   vite build                  → tiny-oss.es.js         (Aliyun OSS)
 *   vite build --mode cos       → tiny-oss.cos.es.js
 *   vite build --mode obs       → tiny-oss.obs.es.js
 *   vite build --mode aws       → tiny-oss.aws.es.js
 *   vite build --mode azure     → tiny-oss.azure.es.js
 *   vite build --mode protocol  → tiny-oss.protocol.es.js
 *
 * Each bundle is self-contained: an entry only references its own
 * provider, so the other providers' signing code is tree-shaken away.
 * `vite dev` (mode `development`) and a plain `vite build` (mode
 * `production`) both target the default OSS entry.
 */

type Target = 'default' | 'cos' | 'obs' | 'aws' | 'azure' | 'protocol';

const TARGETS: Record<Target, { entry: string; name: string }> = {
  default: { entry: 'src/index.ts', name: 'tiny-oss' },
  cos: { entry: 'src/cos/index.ts', name: 'tiny-oss.cos' },
  obs: { entry: 'src/obs/index.ts', name: 'tiny-oss.obs' },
  aws: { entry: 'src/aws/index.ts', name: 'tiny-oss.aws' },
  azure: { entry: 'src/azure/index.ts', name: 'tiny-oss.azure' },
  protocol: { entry: 'src/provider.ts', name: 'tiny-oss.protocol' },
};

export default defineConfig(({ mode }) => {
  const target: Target =
    mode === 'production' || mode === 'development' ? 'default' : (mode as Target);
  const { entry, name } = TARGETS[target] ?? TARGETS.default;

  return {
    build: {
      target: 'es2015',
      lib: {
        entry,
        fileName: () => `${name}.es.js`,
        formats: ['es'],
      },
      outDir: 'dist',
      // The default build owns the dist directory; every other target
      // must not wipe the bundles built before it.
      emptyOutDir: target === 'default',
      sourcemap: true,
      minify: 'esbuild',
    },
  };
});
