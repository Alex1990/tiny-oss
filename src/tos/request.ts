import { getTransport } from '../transport'
import { normalizeOptions, resolveTimeout, dataSize } from '../ops/request'
import { getTosSignature, tosUriEscapePath, canonicalTosQuery, iso8601 } from './signature'
import { resolveTosHost } from './host'
import type { Options } from '../types'
import type { RequestParams } from '../protocol'

/** TOS defaults: https, 60s timeout (region and endpoint come from the caller). */
const TOS_DEFAULTS = {
  secure: true,
  timeout: 60000,
}

/**
 * Sign and send a single TOS request through the configured transport.
 * The TOS4-HMAC-SHA256 Authorization covers the host, x-tos-date,
 * x-tos-content-sha256 (always 'UNSIGNED-PAYLOAD', like the official SDK),
 * x-tos-security-token and any other x-tos-* header (metadata, copy
 * source, …). The object key is URI-escaped ('/' kept) in both the
 * signature and the request URL, and the query string is sorted exactly
 * like the signed one.
 */
export function request(options: Options, params: RequestParams): Promise<any> {
  const opts = normalizeOptions(options, TOS_DEFAULTS)
  const { accessKeyId, accessKeySecret, stsToken, secure, region } = opts
  const host = resolveTosHost(opts)
  const headers: Record<string, any> = {
    host,
    'x-tos-date': iso8601(new Date()),
    'x-tos-content-sha256': 'UNSIGNED-PAYLOAD',
    ...params.headers,
  }
  if (stsToken) headers['x-tos-security-token'] = stsToken
  // The official SDK lower-cases every header name before signing, so the
  // signed-header set is host + all x-tos-* headers regardless of the
  // caller's casing. Send the same lower-cased names.
  const normalizedHeaders: Record<string, any> = {}
  Object.keys(headers).forEach((key) => {
    normalizedHeaders[key.toLowerCase()] = headers[key]
  })
  const pathname = `/${tosUriEscapePath(params.objectName)}`
  const { signature, credentialScope, signedHeaders } = getTosSignature({
    method: params.verb,
    pathname,
    query: params.subResource,
    headers: normalizedHeaders,
    accessKeyId,
    secretAccessKey: accessKeySecret,
    region: region as string,
  })
  normalizedHeaders.authorization = `TOS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const protocol = secure ? 'https' : 'http'
  let url = `${protocol}://${host}${pathname}`
  if (params.subResource) {
    const qs = canonicalTosQuery(params.subResource)
    if (qs) url += `?${qs}`
  }
  return getTransport()(url, {
    method: params.verb,
    headers: normalizedHeaders,
    data: params.data,
    timeout: params.timeout == null ? resolveTimeout(opts) : params.timeout,
    onprogress: params.onprogress,
    total: dataSize(params.data),
  })
}
