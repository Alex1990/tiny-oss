import { getTransport } from '../transport';
import { normalizeOptions, resolveTimeout, dataSize } from '../ops/request';
import { getAwsSignature, awsUriEscapePath, iso8601 } from './signature';
import { resolveAwsHost } from './host';
import type { TinyOSS } from '../types';
import type { RequestParams } from '../protocol';

/** AWS defaults: us-east-1 region, http, 60s timeout. */
const AWS_DEFAULTS = {
  region: 'us-east-1',
  secure: false,
  timeout: 60000,
};

/**
 * Sign and send a single S3 request through the configured transport.
 * The SigV4 Authorization header covers the host, x-amz-date,
 * x-amz-content-sha256 (always 'UNSIGNED-PAYLOAD', like the official
 * SDK) and x-amz-security-token headers. The object key is URI-escaped
 * ('/' kept) in both the signature and the request URL.
 */
export function request(options: TinyOSS.TinyOSSOptions, params: RequestParams): Promise<any> {
  const opts = normalizeOptions(options, AWS_DEFAULTS);
  const { accessKeyId, accessKeySecret, stsToken, bucket, secure, region } = opts;
  const host = resolveAwsHost(opts);
  const headers: Record<string, any> = {
    host,
    'x-amz-date': iso8601(new Date()),
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    ...params.headers,
  };
  if (stsToken) headers['x-amz-security-token'] = stsToken;
  const pathname = `/${awsUriEscapePath(params.objectName)}`;
  const { signature, credentialScope, signedHeaders } = getAwsSignature({
    method: params.verb,
    pathname,
    query: params.subResource,
    headers,
    accessKeyId,
    secretAccessKey: accessKeySecret,
    region: region as string,
  });
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const protocol = secure ? 'https' : 'http';
  let url = `${protocol}://${host}${pathname}`;
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
