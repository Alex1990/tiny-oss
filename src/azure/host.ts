import type { Options } from '../types';

/**
 * Resolve the Azure Blob Storage host. An explicit endpoint wins (for
 * proxies or Azurite); otherwise the classic
 * `<account>.blob.core.windows.net` host. The account name doubles as
 * the access key ID.
 */
export function resolveAzureHost(options: Options): string {
  const { accessKeyId, endpoint } = options;
  if (endpoint) return endpoint;
  return `${accessKeyId}.blob.core.windows.net`;
}

/**
 * URI-escape an object name for the request path, keeping '/'
 * (mirrors the OBS and S3 path escaping). The same escaped pathname is
 * used in the request URL and the canonicalized resource, as Azure
 * requires the URI-encoded form.
 */
export function azureEscapePath(objectName: string): string {
  return objectName.split('/').map(encodeURIComponent).join('/');
}
