import type { TinyOSS } from '../types';

/**
 * Resolve the COS host. An explicit endpoint wins over the
 * bucket/region combination.
 */
export function resolveCosHost(options: TinyOSS.TinyOSSOptions): string {
  const { bucket, region, endpoint } = options;
  if (endpoint) return endpoint;
  return `${bucket}.cos.${region}.myqcloud.com`;
}
