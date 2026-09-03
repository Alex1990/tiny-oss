import { getTransport } from '../transport'
import { assertOptions, getSignature, encodeUtf8, isArrayBuffer, isBlob } from '../utils'
import type { ObjectCallback, Options } from '../types'
import type { Protocol, RequestParams } from '../protocol'

const DEFAULT_OPTIONS = {
  internal: false,
  cname: false,
  secure: true,
  timeout: 60000,
}

/**
 * Validate and fill in defaults for client options. The result is a
 * plain object, so the functional API can be tree-shaken independently
 * of the TinyOSS class. Shared by every provider; providers may pass
 * their own defaults (e.g. OBS region 'cn-north-4').
 */
export function normalizeOptions(
  options: Options = {} as Options,
  defaults: Record<string, any> = DEFAULT_OPTIONS,
): Options {
  assertOptions(options)
  return Object.assign({}, defaults, options)
}

/**
 * Resolve the OSS host the requests are sent to. An explicit endpoint
 * wins over the bucket/region combination.
 */
export function resolveHost(options: Options): string {
  const { bucket, region, endpoint, internal } = options
  if (endpoint) return endpoint
  // No SDK default for region: without an explicit region or endpoint
  // there is no host to build.
  if (!region) throw new Error('options.region is required (or set options.endpoint)')
  // assertOptions guarantees bucket or endpoint, and endpoint is handled above.
  let host = bucket as string
  if (internal) host += '-internal'
  host += `.${region}.aliyuncs.com`
  return host
}

/**
 * Resolve the per-request timeout, honoring a per-request override and
 * tolerating string timeouts. Shared by every provider.
 */
export function resolveTimeout(options: Options, fallback?: number): number | undefined {
  const value = fallback || options.timeout
  return typeof value === 'string' ? parseInt(value, 10) : value
}

/**
 * Serialize a structured upload callback into request headers through
 * the provider's protocol hook. Returns undefined when no callback is
 * given; rejects on providers without a callback API (COS, AWS S3,
 * Azure) instead of silently dropping the option.
 *
 * When `userHeaders` already contains one of the serialized callback
 * headers, the whole serialization is skipped (the custom-value/var
 * header included): an explicit header wins, mirroring ali-oss
 * encodeCallback, which skips everything once x-oss-callback is set.
 */
export function resolveCallbackHeaders(
  protocol: Protocol,
  callback?: ObjectCallback,
  userHeaders?: Record<string, string>,
): Record<string, string> | undefined {
  if (!callback) return undefined
  if (!protocol.callbackHeaders) {
    throw new Error(
      'upload callback is not supported by this provider (Aliyun OSS and Huawei OBS support it; COS: pass x-cos-callback headers manually)',
    )
  }
  const headers = protocol.callbackHeaders(callback)
  if (
    userHeaders &&
    Object.keys(userHeaders).some((key) =>
      Object.keys(headers).some((callbackKey) => callbackKey.toLowerCase() === key.toLowerCase()),
    )
  ) {
    return undefined
  }
  return headers
}

/** Total payload size in bytes, for transports that need it. Shared by every provider. */
export function dataSize(data: any): number | undefined {
  if (data == null) return undefined
  if (typeof data === 'string') return encodeUtf8(data).length
  if (isBlob(data)) return data.size
  if (isArrayBuffer(data)) return data.byteLength
  if (ArrayBuffer.isView(data)) return data.byteLength
  return undefined
}

/**
 * Sign and send a single OSS request through the configured transport.
 * Headers are completed with the date, the STS token and the
 * Authorization signature, and the URL is built from the host plus the
 * sub-resource query parameters.
 */
export function request(options: Options, params: RequestParams): Promise<any> {
  const opts = normalizeOptions(options)
  const { accessKeyId, accessKeySecret, stsToken, bucket, secure } = opts
  const headers: Record<string, any> = {
    'x-oss-date': new Date().toUTCString(),
    ...params.headers,
  }
  if (stsToken) headers['x-oss-security-token'] = stsToken
  const signature = getSignature({
    verb: params.verb,
    contentMd5: params.contentMd5,
    headers,
    bucket,
    objectName: params.objectName,
    accessKeySecret,
    subResource: params.subResource,
  })
  headers.Authorization = `OSS ${accessKeyId}:${signature}`
  const protocol = secure ? 'https' : 'http'
  let url = `${protocol}://${resolveHost(opts)}/${params.objectName}`
  if (params.subResource) {
    const qs = Object.keys(params.subResource)
      .map((key) => {
        const value = params.subResource![key]
        return value === '' || value == null ? key : `${key}=${encodeURIComponent(value)}`
      })
      .join('&')
    if (qs) url += `?${qs}`
  }
  return getTransport()(url, {
    method: params.verb,
    headers,
    data: params.data,
    timeout: params.timeout == null ? resolveTimeout(opts) : params.timeout,
    onprogress: params.onprogress,
    total: dataSize(params.data),
  })
}
