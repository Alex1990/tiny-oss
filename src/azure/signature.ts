import base64js from 'base64-js'
import { hmacSha256 } from '../aws/sha256'
import { encodeUtf8 } from '../utils'

/**
 * Azure Blob Storage Shared Key authorization (Blob service, version
 * 2009-09-19 and later). The StringToSign has a fixed 12-field header
 * block (empty fields stay as empty strings, keeping their newline),
 * followed by the canonicalized x-ms-* headers and the canonicalized
 * resource. The signing key is the Base64-decoded account key.
 *
 * Reference: https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
 */

/** URL-decode a canonicalized query value, tolerating unencoded input. */
function decodeQueryValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * CanonicalizedHeaders: every x-ms-* header, lower-cased, sorted
 * lexicographically, whitespace collapsed, terminated by a newline.
 */
export function getCanonicalizedAzureHeaders(headers: Record<string, any>): string {
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .filter((name) => name.indexOf('x-ms-') === 0)
    .sort()
  let result = ''
  names.forEach((name) => {
    const original = Object.keys(headers).find((key) => key.toLowerCase() === name)
    const value = String(headers[original as string]).trim()
    result += `${name}:${value}\n`
  })
  return result
}

function comparePairs(a: [string, string], b: [string, string]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1
  return 0
}

/**
 * CanonicalizedResource (Shared Key format, 2009-09-19 and later):
 * "/account" + the encoded URI path, then every query parameter
 * (lower-cased, URL-decoded, sorted) as "\nname:value" lines.
 */
export function getCanonicalizedAzureResource(
  account: string,
  pathname: string,
  query?: Record<string, any>,
): string {
  let result = `/${account}${pathname}`
  if (query) {
    const pairs: Array<[string, string]> = []
    Object.keys(query).forEach((key) => {
      const name = key.toLowerCase()
      const raw = query[key]
      // The official SDK drops parameters without a value (URLs where
      // the '=' is missing or the value is empty) before signing.
      if (raw == null || raw === '') return
      const values = Array.isArray(raw) ? raw : [raw]
      // The official SDK lower-cases the key (no URL-decode) and
      // URL-decodes the value before signing.
      const decoded = values
        .map((value: any) => decodeQueryValue(value == null ? '' : String(value)))
        .sort()
      pairs.push([name, decoded.join(',')])
    })
    pairs.sort(comparePairs)
    pairs.forEach(([name, value]) => {
      result += `\n${name}:${value}`
    })
  }
  return result
}

/**
 * Build the full StringToSign and return the Authorization header value:
 *   SharedKey <account>:<base64(HMAC-SHA256(base64decode(key), StringToSign))>
 */
export function getSharedKeyAuthorization(options: {
  verb: string
  headers: Record<string, any>
  pathname: string
  query?: Record<string, any>
  account: string
  accountKey: string
  contentMd5?: string
  contentType?: string
  contentLength?: number
}): string {
  const { verb, headers, pathname, query, account, accountKey } = options
  const contentMd5 = options.contentMd5 || ''
  const contentType = options.contentType || ''
  // Content-Length must be empty when the request body is absent or zero.
  const contentLength = options.contentLength ? String(options.contentLength) : ''
  // The Date field is empty because x-ms-date (canonicalized below) is present.
  const fields = [verb, '', '', contentLength, contentMd5, contentType, '', '', '', '', '', '']
  const stringToSign =
    fields.join('\n') +
    '\n' +
    getCanonicalizedAzureHeaders(headers) +
    getCanonicalizedAzureResource(account, pathname, query)
  const hmac = hmacSha256()
  hmac.setKey(base64js.toByteArray(accountKey))
  hmac.update(encodeUtf8(stringToSign))
  const signature = base64js.fromByteArray(new Uint8Array(hmac.finalize()))
  return `SharedKey ${account}:${signature}`
}
