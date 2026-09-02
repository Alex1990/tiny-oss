import type { Options } from '../types'

/**
 * Resolve the OBS host. An explicit endpoint wins over the
 * bucket/region combination.
 */
export function resolveObsHost(options: Options): string {
  const { bucket, region, endpoint } = options
  if (endpoint) return endpoint
  if (!region) throw new Error('options.region is required (or set options.endpoint)')
  return `${bucket}.obs.${region}.myhuaweicloud.com`
}
