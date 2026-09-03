import { unix } from '../utils'
import { normalizeOptions } from '../ops/request'
import { getObsSignature, encodeObsUrl } from './signature'
import { resolveObsHost } from './host'
import type { Options, ResponseHeaderType, SignatureUrlOptions } from '../types'

/** OBS defaults: https (OBS endpoints are HTTPS-only), 60s timeout. */
const OBS_DEFAULTS = {
  secure: true,
  timeout: 60000,
}

/**
 * Get a signed OBS URL (the OBS "obs" scheme), mirroring the official
 * esdk-obs-browserjs createV2SignedUrlSync:
 *
 *   https://bucket.obs.region.myhuaweicloud.com/key
 *     ?AccessKeyId=<ak>&Expires=<unix>&[x-obs-security-token=<token>]
 *     &Signature=<base64(HMAC-SHA1)>
 *
 * The signature covers Method, optional Content-MD5/Content-Type,
 * Expires, x-obs-* headers and the whitelisted sub-resource parameters
 * (response-* response headers and x-image-process are supported).
 *
 * @param options client options
 * @param objectName object name
 * @param urlOptions signature options, same shape as the OSS entry
 * @return signed URL
 */
export function obsSignUrl(
  options: Options,
  objectName: string,
  urlOptions: SignatureUrlOptions = {},
): string {
  const { expires = 1800, method, process, response } = urlOptions
  const opts = normalizeOptions(options, OBS_DEFAULTS)
  const { accessKeyId, accessKeySecret, stsToken, bucket, secure } = opts
  const subResource: Record<string, any> = {}
  if (process) subResource['x-image-process'] = process
  if (response) {
    Object.keys(response).forEach((k) => {
      const key = `response-${k.toLowerCase()}`
      subResource[key] = response[k as keyof ResponseHeaderType]
    })
  }
  const headers: Record<string, any> = {}
  Object.keys(urlOptions).forEach((key) => {
    const lowerKey = key.toLowerCase()
    const value = urlOptions[key]
    if (lowerKey.indexOf('x-obs-') === 0) {
      headers[lowerKey] = value
    } else if (lowerKey === 'content-md5' || lowerKey === 'content-type') {
      headers[lowerKey] = value
    } else if (
      lowerKey !== 'expires' &&
      lowerKey !== 'response' &&
      lowerKey !== 'process' &&
      lowerKey !== 'method'
    ) {
      // callback is only supported on put/multipartUpload; ignore it on
      // signed URLs instead of emitting a bogus query parameter.
      if (lowerKey !== 'callback') subResource[lowerKey] = value
    }
  })
  const securityToken = urlOptions['security-token'] || stsToken
  if (securityToken) subResource['x-obs-security-token'] = securityToken
  const expireUnix = unix() + expires
  const signature = getObsSignature({
    verb: method || 'GET',
    contentMd5: headers['content-md5'],
    headers,
    bucket,
    objectName,
    accessKeySecret,
    subResource,
    expires: expireUnix,
  })
  const protocol = secure ? 'https' : 'http'
  let url = `${protocol}://${resolveObsHost(opts)}/${encodeObsUrl(objectName, true)}`
  const query: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Expires: String(expireUnix),
  }
  Object.keys(subResource).forEach((k) => {
    query[k] = String(subResource[k])
  })
  const keys = Object.keys(query).sort()
  const qs = keys
    .map((k) => {
      const v = query[k]
      return v === '' ? encodeObsUrl(k, true) : `${encodeObsUrl(k, true)}=${encodeObsUrl(v, true)}`
    })
    .join('&')
  url += `?${qs}&Signature=${encodeObsUrl(signature, true)}`
  return url
}
