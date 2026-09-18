import { normalizeOptions } from '../ops/request'
import { getTosSignature, tosUriEscapePath, iso8601 } from './signature'
import { resolveTosHost } from './host'
import type { Options, ResponseHeaderType, SignatureUrlOptions } from '../types'

/** TOS defaults: https, 60s timeout (region and endpoint come from the caller). */
const TOS_DEFAULTS = {
  secure: true,
  timeout: 60000,
}

/**
 * Get a signed TOS URL (TOS4-HMAC-SHA256 query authentication), mirroring
 * the official @volcengine/tos-sdk getPreSignedUrl:
 *
 *   https://<bucket>.<endpoint>/<key>
 *     ?X-Tos-Algorithm=TOS4-HMAC-SHA256
 *     &X-Tos-Content-Sha256=UNSIGNED-PAYLOAD
 *     &X-Tos-Credential=<ak>%2F<date>%2F<region>%2Ftos%2Frequest
 *     &X-Tos-Date=<tosDate>&X-Tos-Expires=<ttl-seconds>
 *     &X-Tos-SignedHeaders=host
 *     [&X-Tos-Security-Token=<token>]
 *     &X-Tos-Signature=<hex>
 *
 * Only `host` is signed (the official SDK's query signer does not sign the
 * X-Tos-Date header it injects), so the link stays usable from a plain
 * browser without custom headers.
 *
 * The credential scope uses the configured `region` (test/tos-oracle.node.ts
 * pins this against the official Go SDK's published query vector). The
 * official JS SDK's getPreSignedUrl substitutes the endpoint for the region
 * there (src/methods/base.ts: `region: this.opts.endpoint`), which disagrees
 * with the Go SDK and the standard V4 credential scope.
 *
 * @param options client options
 * @param objectName object name
 * @param urlOptions signature options, same shape as the OSS entry
 * @return signed URL
 */
export function tosSignUrl(
  options: Options,
  objectName: string,
  urlOptions: SignatureUrlOptions = {},
): string {
  const { expires = 1800, method, process, response } = urlOptions
  const opts = normalizeOptions(options, TOS_DEFAULTS)
  const { accessKeyId, accessKeySecret, stsToken, secure, region } = opts
  const host = resolveTosHost(opts)
  const query: Record<string, string> = {}
  if (process) query['x-tos-process'] = String(process)
  if (response) {
    Object.keys(response).forEach((key) => {
      query[`response-${key.toLowerCase()}`] = String(response[key as keyof ResponseHeaderType])
    })
  }
  Object.keys(urlOptions).forEach((key) => {
    const lower = key.toLowerCase()
    if (
      lower === 'expires' ||
      lower === 'method' ||
      lower === 'response' ||
      lower === 'process' ||
      lower === 'callback' ||
      lower === 'security-token' ||
      lower === 'content-type' ||
      lower === 'content-md5'
    ) {
      return
    }
    if (lower.indexOf('x-tos-') === 0) query[lower] = String(urlOptions[key])
    else query[key] = String(urlOptions[key])
  })
  const securityToken = urlOptions['security-token'] || stsToken
  const tosDate = iso8601(new Date())
  const credentialScope = `${tosDate.substr(0, 8)}/${region}/tos/request`
  const signParams: Record<string, string> = {
    'X-Tos-Algorithm': 'TOS4-HMAC-SHA256',
    'X-Tos-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Tos-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Tos-Date': tosDate,
    'X-Tos-Expires': String(expires),
    'X-Tos-SignedHeaders': 'host',
  }
  if (securityToken) signParams['X-Tos-Security-Token'] = securityToken
  const { signature } = getTosSignature({
    method: method || 'GET',
    pathname: `/${tosUriEscapePath(objectName)}`,
    query: { ...query, ...signParams },
    headers: { host },
    accessKeyId,
    secretAccessKey: accessKeySecret,
    region: region as string,
    date: tosDate,
  })
  const protocol = secure ? 'https' : 'http'
  const parts: string[] = []
  Object.keys(query).forEach((key) => {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
  })
  Object.keys(signParams).forEach((key) => {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(signParams[key])}`)
  })
  parts.push(`X-Tos-Signature=${signature}`)
  return `${protocol}://${host}/${tosUriEscapePath(objectName)}?${parts.join('&')}`
}
