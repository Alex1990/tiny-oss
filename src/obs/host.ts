import type { TinyOSS } from '../types';

/**
 * Resolve the OBS host. An explicit endpoint wins over the
 * bucket/region combination.
 */
export function resolveObsHost(options: TinyOSS.TinyOSSOptions): string {
  const { bucket, region, endpoint } = options;
  if (endpoint) return endpoint;
  return `${bucket}.obs.${region}.myhuaweicloud.com`;
}
