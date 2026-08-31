import { getTransport } from '../transport';
import { assertOptions, getSignature, encodeUtf8 } from '../utils';
import type { TinyOSS } from '../types';

const DEFAULT_OPTIONS = {
  region: 'oss-cn-hangzhou',
  internal: false,
  cname: false,
  secure: false,
  timeout: 60000,
};

/**
 * Validate and fill in defaults for client options. The result is a
 * plain object, so the functional API can be tree-shaken independently
 * of the TinyOSS class.
 */
export function normalizeOptions(
  options: TinyOSS.TinyOSSOptions = {} as TinyOSS.TinyOSSOptions
): TinyOSS.TinyOSSOptions {
  assertOptions(options);
  return Object.assign({}, DEFAULT_OPTIONS, options);
}

/**
 * Resolve the host the requests are sent to. An explicit endpoint wins
 * over the bucket/region combination.
 */
export function resolveHost(options: TinyOSS.TinyOSSOptions): string {
  const { bucket, region, endpoint, internal } = options;
  if (endpoint) return endpoint;
  // assertOptions guarantees bucket or endpoint, and endpoint is handled above.
  let host = bucket as string;
  if (internal) host += '-internal';
  host += `.${region}.aliyuncs.com`;
  return host;
}

/**
 * Resolve the per-request timeout, honoring a per-request override and
 * tolerating string timeouts.
 */
export function resolveTimeout(options: TinyOSS.TinyOSSOptions, fallback?: number): number | undefined {
  const value = fallback || options.timeout;
  return typeof value === 'string' ? parseInt(value, 10) : value;
}

/** Total payload size in bytes, for transports that need it. */
export function dataSize(data: any): number | undefined {
  if (data == null) return undefined;
  if (typeof data === 'string') return encodeUtf8(data).length;
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return undefined;
}

export interface RequestParams {
  verb: string;
  objectName: string;
  contentMd5?: string;
  headers?: Record<string, any>;
  subResource?: Record<string, any>;
  data?: any;
  timeout?: number;
  onprogress?: (e: TinyOSS.Progress) => any;
}

/**
 * Sign and send a single OSS request through the configured transport.
 * Headers are completed with the date, the STS token and the
 * Authorization signature, and the URL is built from the host plus the
 * sub-resource query parameters.
 */
export function request(options: TinyOSS.TinyOSSOptions, params: RequestParams): Promise<any> {
  const opts = normalizeOptions(options);
  const { accessKeyId, accessKeySecret, stsToken, bucket, secure } = opts;
  const headers: Record<string, any> = {
    'x-oss-date': new Date().toUTCString(),
    ...params.headers,
  };
  if (stsToken) headers['x-oss-security-token'] = stsToken;
  const signature = getSignature({
    verb: params.verb,
    contentMd5: params.contentMd5,
    headers,
    bucket,
    objectName: params.objectName,
    accessKeySecret,
    subResource: params.subResource,
  });
  headers.Authorization = `OSS ${accessKeyId}:${signature}`;
  const protocol = secure ? 'https' : 'http';
  let url = `${protocol}://${resolveHost(opts)}/${params.objectName}`;
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
