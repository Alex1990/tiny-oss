import { getTransport } from '../transport';
import { normalizeOptions, resolveTimeout, dataSize } from '../ops/request';
import { getSharedKeyAuthorization } from './signature';
import { resolveAzureHost, azureEscapePath } from './host';
import type { Options } from '../types';
import type { RequestParams } from '../protocol';

/**
 * Azure Blob Storage defaults: https, 60s timeout. There is no region
 * concept in the Blob service; the account name is the access key ID
 * and the account key (base64) is the secret.
 */
const AZURE_DEFAULTS = {
  secure: true,
  timeout: 60000,
};

/**
 * The Blob service API version pinned for requests and SAS signatures.
 * 2020-12-06 adds the encryption-scope field to the SAS StringToSign.
 */
export const AZURE_API_VERSION = '2020-12-06';

/**
 * Sign and send a single Azure Blob request through the configured
 * transport. Every request carries x-ms-date and x-ms-version; the
 * SharedKey Authorization covers the canonicalized x-ms-* headers, the
 * canonicalized resource (path + sorted query) and the Content-MD5 /
 * Content-Type / Content-Length fields. PUT requests that are not
 * block operations create a block blob, so x-ms-blob-type is added.
 */
export function request(options: Options, params: RequestParams): Promise<any> {
  const opts = normalizeOptions(options, AZURE_DEFAULTS);
  const { accessKeyId, accessKeySecret, bucket, secure } = opts;
  const headers: Record<string, any> = {
    'x-ms-date': new Date().toUTCString(),
    'x-ms-version': AZURE_API_VERSION,
    ...params.headers,
  };
  // Put Blob needs an explicit blob type; block operations (Put Block /
  // Put Block List) address ?comp= and must not carry it.
  if (params.verb === 'PUT' && !params.subResource) {
    headers['x-ms-blob-type'] = 'BlockBlob';
  }
  const pathname = `/${bucket}/${azureEscapePath(params.objectName)}`;
  const authorization = getSharedKeyAuthorization({
    verb: params.verb,
    headers,
    pathname,
    query: params.subResource,
    account: accessKeyId as string,
    accountKey: accessKeySecret as string,
    contentMd5: params.contentMd5,
    contentType: params.headers ? params.headers['Content-Type'] : undefined,
    contentLength: dataSize(params.data),
  });
  headers.Authorization = authorization;
  const protocol = secure ? 'https' : 'http';
  let url = `${protocol}://${resolveAzureHost(opts)}${pathname}`;
  if (params.subResource) {
    const qs = Object.keys(params.subResource)
      .map((key) => {
        const value = params.subResource![key];
        return value === '' || value == null ? key : `${key}=${encodeURIComponent(value)}`;
      })
      .join('&');
    if (qs) url += `?${qs}`;
  }
  return getTransport()(url, {
    method: params.verb,
    headers,
    data: params.data,
    timeout: params.timeout == null ? resolveTimeout(opts) : params.timeout,
    onprogress: params.onprogress,
    total: dataSize(params.data),
  });
}
