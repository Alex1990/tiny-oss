import { normalizeOptions } from '../ops/request';
import { getCosAuth } from './signature';
import { resolveCosHost } from './host';
import type { TinyOSS } from '../types';

/**
 * Get a signed url for a COS object.
 *
 * The COS signature travels as query parameters (q-sign-algorithm=sha1&...)
 * instead of OSS's OSSAccessKeyId/Expires/Signature trio. Only the host
 * header is signed, since a browser cannot attach custom headers to the
 * link; the response-xxx and pic-operations parameters are signed because
 * they appear in the URL.
 *
 * @param options client options
 * @param objectName object name
 * @param urlOptions signature options
 * @return signature url
 */
export function cosSignUrl(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  urlOptions: TinyOSS.SignatureUrlOptions = {}
): string {
  const { expires = 1800, method, process, response } = urlOptions;
  const opts = normalizeOptions(options);
  const { accessKeyId, accessKeySecret, stsToken, secure } = opts;
  const host = resolveCosHost(opts);
  const query: Record<string, string> = {};
  if (process) query['pic-operations'] = process;
  if (response) {
    Object.keys(response).forEach((k) => {
      query[`response-${k.toLowerCase()}`] = String(response[k as keyof TinyOSS.ResponseHeaderType]);
    });
  }
  Object.keys(urlOptions).forEach((key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey.indexOf('x-cos-') === 0) {
      query[lowerKey] = String(urlOptions[key]);
    } else if (lowerKey !== 'expires' && lowerKey !== 'response' && lowerKey !== 'process' && lowerKey !== 'method' && lowerKey !== 'security-token') {
      query[lowerKey] = String(urlOptions[key]);
    }
  });
  const securityToken = urlOptions['security-token'] || stsToken;
  const pathname = objectName === '' ? '/' : `/${objectName}`;
  const authorization = getCosAuth({
    method: method || 'GET',
    pathname,
    query,
    headers: { Host: host },
    secretId: accessKeyId,
    secretKey: accessKeySecret,
    expires,
    host,
  });
  const protocol = secure ? 'https' : 'http';
  let url = `${protocol}://${host}${pathname}?`;
  // The Authorization value embeds ';' inside q-sign-time/q-key-time;
  // URL-encode every parameter value so the link stays parseable.
  url += authorization
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      return `${pair.slice(0, eq)}=${encodeURIComponent(pair.slice(eq + 1))}`;
    })
    .join('&');
  if (securityToken) url += `&x-cos-security-token=${encodeURIComponent(securityToken)}`;
  Object.keys(query).forEach((k) => {
    url += `&${k}=${encodeURIComponent(query[k])}`;
  });
  return url;
}
