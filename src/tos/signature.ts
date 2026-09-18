import { sha256, hmacSha256 } from '../utils/sha256'
import { encodeUtf8 } from '../utils/utf8'

/**
 * Volcano Engine Torch Object Storage (TOS) request signature, TOS4-HMAC-SHA256.
 *
 * The algorithm mirrors the official @volcengine/tos-sdk SignersV4
 * (src/signatureV4.ts) exactly:
 *
 *   CanonicalRequest = Method\n
 *                      CanonicalURI\n            // URI-escaped, '/' kept
 *                      CanonicalQueryString\n    // sorted, URI-escaped
 *                      CanonicalHeaders\n\n
 *                      SignedHeaders\n
 *                      'UNSIGNED-PAYLOAD'
 *   StringToSign = TOS4-HMAC-SHA256\n
 *                  tosDate\n
 *                  date/region/tos/request\n
 *                  hex(SHA256(CanonicalRequest))
 *   SigningKey = HMAC-SHA256(HMAC-SHA256(HMAC-SHA256(HMAC-SHA256(
 *                SecretKey, date), region), 'tos'), 'request')
 *   Signature = hex(HMAC-SHA256(SigningKey, StringToSign))
 *
 * Signed headers are `host` plus every `x-tos-*` header (lower-cased,
 * sorted); unlike SigV4 the canonical header block is followed by a blank
 * line. The body hash is always the literal 'UNSIGNED-PAYLOAD' (the official
 * SDK never signs the body).
 */

/** URI-escape per the official SDK: encodeURIComponent plus the RFC 3986 chars it leaves. */
export function tosUriEscape(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

/** URI-escape a path segment by segment so '/' is preserved. */
export function tosUriEscapePath(str: string): string {
  return str.split('/').map(tosUriEscape).join('/')
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

function sha256Hex(str: string): string {
  return bytesToHex(new Uint8Array(sha256().digest(encodeUtf8(str))))
}

function hmacSha256Hex(key: string | Uint8Array, message: string): string {
  const hmac = hmacSha256()
  // instanceof is realm-bound; any TypedArray view carries subarray.
  const keyView = key as Uint8Array // structural stand-in; checked below
  const secret =
    ArrayBuffer.isView(key) && typeof keyView.subarray === 'function'
      ? keyView
      : encodeUtf8(key as string)
  hmac.setKey(secret)
  hmac.update(encodeUtf8(message))
  return bytesToHex(new Uint8Array(hmac.finalize()))
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return out
}

/** Normalize a header value the way the official SDK does before signing. */
function canonicalHeaderValue(value: any): string {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
}

/** Serialize query params sorted and URI-escaped, like the official SDK. */
export function canonicalTosQuery(query: Record<string, any>): string {
  return Object.keys(query)
    .sort()
    .map((name) => {
      const value = query[name]
      return `${tosUriEscape(name)}=${tosUriEscape(value === undefined || value === null ? '' : String(value))}`
    })
    .join('&')
}

export interface TosSignOptions {
  method: string
  /** Canonical URI — the URI-escaped object path with '/' kept, e.g. '/dir/file.txt'. */
  pathname: string
  query?: Record<string, any>
  /** Signable request headers; must include 'host'. Only host and x-tos-* are signed. */
  headers: Record<string, any>
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
  /** Fixed 'YYYYMMDDTHHMMSSZ' timestamp for tests; defaults to now. */
  date?: string
}

/**
 * Compute the TOS4-HMAC-SHA256 signature. Returns the pieces needed by both
 * header authorization and pre-signed URL construction.
 */
export function getTosSignature(opt: TosSignOptions): {
  tosDate: string
  credentialScope: string
  signedHeaders: string
  signature: string
} {
  const { method, pathname, headers, accessKeyId, secretAccessKey, region } = opt
  if (!accessKeyId) throw new Error('need accessKeyId')
  if (!secretAccessKey) throw new Error('need accessKeySecret')
  const service = opt.service || 'tos'
  const tosDate = opt.date || iso8601(new Date())
  const shortDate = tosDate.substr(0, 8)
  const credentialScope = `${shortDate}/${region}/${service}/request`

  // Lower-case the header names, drop null values, and keep host + x-tos-*.
  const normalized: Record<string, any> = {}
  Object.keys(headers).forEach((key) => {
    if (headers[key] != null) normalized[key.toLowerCase()] = headers[key]
  })
  const signedNames = Object.keys(normalized)
    .filter((key) => key === 'host' || key.indexOf('x-tos-') === 0)
    .sort()
  const canonicalHeaders = signedNames
    .map((key) => `${key}:${canonicalHeaderValue(normalized[key])}`)
    .join('\n')
  const signedHeaders = signedNames.join(';')

  const canonicalRequest = [
    method,
    pathname,
    canonicalTosQuery(opt.query || {}),
    `${canonicalHeaders}\n`,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'TOS4-HMAC-SHA256',
    tosDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmacSha256Hex(secretAccessKey, shortDate)
  const kRegion = hmacSha256Hex(hexToBytes(kDate), region)
  const kService = hmacSha256Hex(hexToBytes(kRegion), service)
  const kSigning = hmacSha256Hex(hexToBytes(kService), 'request')
  const signature = hmacSha256Hex(hexToBytes(kSigning), stringToSign)

  return { tosDate, credentialScope, signedHeaders, signature }
}

/** 'YYYYMMDDTHHMMSSZ' from a Date, matching the official SDK's getDateTime. */
export function iso8601(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}
