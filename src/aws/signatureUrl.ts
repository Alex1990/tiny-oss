import { normalizeOptions } from '../ops/request'
import { getAwsSignature, awsUriEscapePath, iso8601, canonicalQueryString } from './signature'
import { resolveAwsHost } from './host'
import type { Options, ResponseHeaderType, SignatureUrlOptions } from '../types'

/** AWS defaults: https, 60s timeout. */
const AWS_DEFAULTS = {
  secure: true,
  timeout: 60000,
}

/**
 * Get a pre-signed S3 URL (SigV4 query-string auth), mirroring the
 * official aws-sdk v2 getSignedUrl:
 *
 *   https://bucket.s3.region.amazonaws.com/key
 *     ?X-Amz-Algorithm=AWS4-HMAC-SHA256
 *     &X-Amz-Credential=<ak>/<scope>
 *     &X-Amz-Date=<YYYYMMDDTHHMMSSZ>
 *     &X-Amz-Expires=<seconds>
 *     &X-Amz-SignedHeaders=host
 *     [&X-Amz-Security-Token=<token>]
 *     [&<business query params>]
 *     &X-Amz-Signature=<hex>
 *
 * The payload is signed as UNSIGNED-PAYLOAD; only the host header
 * participates.
 *
 * @param options client options
 * @param objectName object name
 * @param urlOptions signature options, same shape as the OSS entry
 * @return pre-signed URL
 */
export function awsSignUrl(
  options: Options,
  objectName: string,
  urlOptions: SignatureUrlOptions = {},
): string {
  const { expires = 1800, method, response } = urlOptions
  const opts = normalizeOptions(options, AWS_DEFAULTS)
  const { accessKeyId, accessKeySecret, stsToken, bucket, secure, region, pathStyle } = opts
  const query: Record<string, any> = {}
  if (response) {
    Object.keys(response).forEach((k) => {
      const key = `response-${k.toLowerCase()}`
      query[key] = response[k as keyof ResponseHeaderType]
    })
  }
  Object.keys(urlOptions).forEach((key) => {
    const lowerKey = key.toLowerCase()
    const value = urlOptions[key]
    if (lowerKey.indexOf('x-amz-') === 0) {
      query[lowerKey] = value
    } else if (lowerKey === 'content-md5') {
      query['Content-MD5'] = value
    } else if (
      lowerKey !== 'expires' &&
      lowerKey !== 'response' &&
      lowerKey !== 'process' &&
      lowerKey !== 'method'
    ) {
      query[lowerKey] = value
    }
  })
  const securityToken = urlOptions['security-token'] || stsToken

  const host = resolveAwsHost(opts)
  const objectPath = `/${awsUriEscapePath(objectName)}`
  const pathname = pathStyle && bucket ? `/${bucket}${objectPath}` : objectPath
  const amzDate = iso8601(new Date())
  const signQuery: Record<string, any> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${amzDate.substr(0, 8)}/${region}/s3/aws4_request`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  }
  if (securityToken) signQuery['X-Amz-Security-Token'] = securityToken
  Object.keys(query).forEach((k) => {
    signQuery[k] = query[k]
  })
  const { signature } = getAwsSignature({
    method: method || 'GET',
    pathname,
    query: signQuery,
    headers: { host },
    accessKeyId,
    secretAccessKey: accessKeySecret,
    region: region as string,
    date: amzDate,
  })
  const protocol = secure ? 'https' : 'http'
  const qs = canonicalQueryString({ ...signQuery, 'X-Amz-Signature': signature })
  return `${protocol}://${host}${pathname}?${qs}`
}
