import type { TinyOSS } from '../types';

/**
 * Resolve the S3 host. An explicit endpoint wins over the
 * bucket/region combination; us-east-1 has no region suffix. With
 * path-style addressing the bucket lives in the URL path, so the host
 * never carries it (S3-compatible stores like MinIO and R2).
 */
export function resolveAwsHost(options: TinyOSS.TinyOSSOptions): string {
  const { bucket, region, endpoint, pathStyle } = options;
  if (endpoint) return endpoint;
  const suffix = region === 'us-east-1' ? 's3.amazonaws.com' : `s3.${region}.amazonaws.com`;
  return pathStyle ? suffix : `${bucket}.${suffix}`;
}
