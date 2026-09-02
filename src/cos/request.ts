import { getTransport } from '../transport'
import { encodeUtf8 } from '../utils'
import { normalizeOptions, resolveTimeout, dataSize } from '../ops/request'
import { getCosAuth } from './signature'
import { resolveCosHost } from './host'
import type { Options } from '../types'
import type { RequestParams } from '../protocol'

/** COS defaults: https, 60s timeout (region and endpoint come from the caller). */
const COS_DEFAULTS = {
  secure: true,
  timeout: 60000,
}

/**
 * Sign and send a single COS request through the configured transport.
 * Headers are completed with the host, the date, the temporary token and
 * the Authorization signature; the URL is built from the host plus the
 * sub-resource query parameters.
 *
 * Unlike OSS, the COS signature covers the host header and the query
 * parameters, so both are fixed before the signature is computed.
 */
export function request(options: Options, params: RequestParams): Promise<any> {
  const opts = normalizeOptions(options, COS_DEFAULTS)
  const { accessKeyId, accessKeySecret, stsToken, secure } = opts
  const host = resolveCosHost(opts)
  const headers: Record<string, any> = {
    Host: host,
    Date: new Date().toUTCString(),
    ...params.headers,
  }
  if (stsToken) headers['x-cos-security-token'] = stsToken
  const pathname = params.objectName === '' ? '/' : `/${params.objectName}`
  const authorization = getCosAuth({
    method: params.verb,
    pathname,
    query: params.subResource,
    headers,
    secretId: accessKeyId,
    secretKey: accessKeySecret,
    host,
  })
  headers.Authorization = authorization
  const protocol = secure ? 'https' : 'http'
  let url = `${protocol}://${host}${pathname}`
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
