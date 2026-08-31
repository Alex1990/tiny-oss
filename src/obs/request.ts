import { getTransport } from '../transport';
import { normalizeOptions, resolveTimeout, dataSize } from '../ops/request';
import { getObsSignature, encodeObsUrl } from './signature';
import { resolveObsHost } from './host';
import type { TinyOSS } from '../types';
import type { RequestParams } from '../protocol';

/** OBS defaults: Huawei Cloud China North 4 region, http, 60s timeout. */
const OBS_DEFAULTS = {
  region: 'cn-north-4',
  secure: false,
  timeout: 60000,
};

/**
 * Sign and send a single OBS request through the configured transport.
 * The signature (OBS scheme) covers the x-obs-date header, the optional
 * STS token, Content-MD5/Content-Type lines and the whitelisted
 * sub-resource query parameters; the object key is URL-encoded with '/'
 * preserved, in both the signature and the request URL.
 */
export function request(options: TinyOSS.TinyOSSOptions, params: RequestParams): Promise<any> {
  const opts = normalizeOptions(options, OBS_DEFAULTS);
  const { accessKeyId, accessKeySecret, stsToken, bucket, secure } = opts;
  const headers: Record<string, any> = {
    'x-obs-date': new Date().toUTCString(),
    ...params.headers,
  };
  if (stsToken) headers['x-obs-security-token'] = stsToken;
  const signature = getObsSignature({
    verb: params.verb,
    contentMd5: params.contentMd5,
    headers,
    bucket,
    objectName: params.objectName,
    accessKeySecret,
    subResource: params.subResource,
  });
  headers.Authorization = `OBS ${accessKeyId}:${signature}`;
  const protocol = secure ? 'https' : 'http';
  let url = `${protocol}://${resolveObsHost(opts)}/${encodeObsUrl(params.objectName, true)}`;
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
