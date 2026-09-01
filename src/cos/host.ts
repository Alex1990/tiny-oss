import type { Options } from '../types';

/**
 * Resolve the COS host. An explicit endpoint wins over the
 * bucket/region combination.
 */
export function resolveCosHost(options: Options): string {
  const { bucket, region, endpoint } = options;
  if (endpoint) return endpoint;
  return `${bucket}.cos.${region}.myqcloud.com`;
}
