import { getSignature, unix } from '../utils'
import { normalizeOptions, resolveHost } from './request'
import type { Options, ResponseHeaderType, SignatureUrlOptions } from '../types'

/**
 * Get a signed url for an OSS object.
 *
 * @param options client options
 * @param objectName object name
 * @param urlOptions signature options, see https://github.com/ali-sdk/ali-oss#signatureurlname-options
 * @return signature url
 */
export function ossSignUrl(
  options: Options,
  objectName: string,
  urlOptions: SignatureUrlOptions = {},
): string {
  const { expires = 1800, method, process, response } = urlOptions
  const opts = normalizeOptions(options)
  const { accessKeyId, accessKeySecret, stsToken, bucket, secure } = opts
  const headers: Record<string, any> = {}
  const subResource: Record<string, any> = {}
  if (process) subResource['x-oss-process'] = process
  if (response) {
    Object.keys(response).forEach((k) => {
      const key = `response-${k.toLowerCase()}`
      subResource[key] = response[k as keyof ResponseHeaderType]
    })
  }
  Object.keys(urlOptions).forEach((key) => {
    const lowerKey = key.toLowerCase()
    const value = urlOptions[key]
    if (lowerKey.indexOf('x-oss-') === 0) {
      headers[lowerKey] = value
    } else if (lowerKey.indexOf('content-md5') === 0) {
      headers[key] = value
    } else if (lowerKey.indexOf('content-type') === 0) {
      headers[key] = value
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
  if (securityToken) subResource['security-token'] = securityToken
  const expireUnix = unix() + expires
  const signature = getSignature({
    type: 'url',
    verb: method || 'GET',
    accessKeySecret,
    bucket,
    objectName,
    headers,
    subResource,
    expires: expireUnix,
  })
  const protocol = secure ? 'https' : 'http'
  // Percent-encode each path segment (UTF-8) so non-ASCII names survive
  // any HTTP client; '/' stays a separator. The signature covers the
  // un-encoded name — OSS decodes the request path before comparing,
  // mirroring ali-oss's encoded URL / raw resource split.
  const encodedName = objectName.split('/').map(encodeURIComponent).join('/')
  let url = `${protocol}://${resolveHost(opts)}/${encodedName}`
  url += `?OSSAccessKeyId=${accessKeyId}`
  url += `&Expires=${expireUnix}`
  url += `&Signature=${encodeURIComponent(signature)}`
  Object.keys(subResource).forEach((k) => {
    url += `&${k}=${encodeURIComponent(subResource[k])}`
  })
  return url
}
