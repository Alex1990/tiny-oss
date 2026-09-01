import type { TinyOSS } from '../types';

/**
 * Resolve the S3 host. An explicit endpoint wins over the
 * bucket/region combination; us-east-1 has no region suffix.
 */
export function resolveAwsHost(options: TinyOSS.TinyOSSOptions): string {
  const { bucket, region, endpoint } = options;
  if (endpoint) return endpoint;
  const suffix = region === 'us-east-1' ? 's3.amazonaws.com' : `s3.${region}.amazonaws.com`;
  return `${bucket}.${suffix}`;
}
