import { getSignature, unix } from '../utils';
import { resolveHost } from './request';
import type { TinyOSS } from '../types';

/**
 * Get a signed url for an object.
 *
 * @param options client options
 * @param objectName object name
 * @param urlOptions signature options, see https://github.com/ali-sdk/ali-oss#signatureurlname-options
 * @return signature url
 */
export function signatureUrl(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  urlOptions: TinyOSS.SignatureUrlOptions = {}
): string {
  const { expires = 1800, method, process, response } = urlOptions;
  const { accessKeyId, accessKeySecret, stsToken, bucket, secure } = options;
  const headers: Record<string, any> = {};
  const subResource: Record<string, any> = {};
  if (process) subResource['x-oss-process'] = process;
  if (response) {
    Object.keys(response).forEach((k) => {
      const key = `response-${k.toLowerCase()}`;
      subResource[key] = response[k as keyof TinyOSS.ResponseHeaderType];
    });
  }
  Object.keys(urlOptions).forEach((key) => {
    const lowerKey = key.toLowerCase();
    const value = urlOptions[key];
    if (lowerKey.indexOf('x-oss-') === 0) {
      headers[lowerKey] = value;
    } else if (lowerKey.indexOf('content-md5') === 0) {
      headers[key] = value;
    } else if (lowerKey.indexOf('content-type') === 0) {
      headers[key] = value;
    } else if (lowerKey !== 'expires' && lowerKey !== 'response' && lowerKey !== 'process' && lowerKey !== 'method') {
      subResource[lowerKey] = value;
    }
  });
  const securityToken = urlOptions['security-token'] || stsToken;
  if (securityToken) subResource['security-token'] = securityToken;
  const expireUnix = unix() + expires;
  const signature = getSignature({
    type: 'url',
    verb: method || 'GET',
    accessKeySecret,
    bucket,
    objectName,
    headers,
    subResource,
    expires: expireUnix,
  });
  const protocol = secure ? 'https' : 'http';
  let url = `${protocol}://${resolveHost(options)}/${objectName}`;
  url += `?OSSAccessKeyId=${accessKeyId}`;
  url += `&Expires=${expireUnix}`;
  url += `&Signature=${encodeURIComponent(signature)}`;
  Object.keys(subResource).forEach((k) => {
    url += `&${k}=${encodeURIComponent(subResource[k])}`;
  });
  return url;
}
