import { Digest } from '../digest'
import { encodeUtf8 } from '../utils/utf8'
import base64js from 'base64-js'

/**
 * Huawei Cloud OBS request signature (the OBS / "obs" scheme), mirroring
 * the official esdk-obs-browserjs Utils.doAuth exactly:
 *
 *   StringToSign = Method\n
 *                  [Content-MD5]\n
 *                  [Content-Type]\n
 *                  \n                      // date line, empty because x-obs-date is set
 *                  x-obs-* headers sorted  // "key:value\n", meta values trimmed
 *                  /bucket/key             // URL-encoded key, '/' kept
 *                  ?whitelisted sub-resource query params
 *   Authorization = OBS AccessKeyId:base64(HMAC-SHA1(SecretKey, StringToSign))
 *
 * Only query parameters listed in OBS_RESOURCE_PARAMS (or starting with
 * x-obs-) participate in the signature; the official SDK filters with the
 * same table.
 */

/** Allowed sub-resource query parameters, verbatim from esdk-obs-browserjs utils.js. */
const OBS_RESOURCE_PARAMS = [
  'inventory',
  'acl',
  'backtosource',
  'policy',
  'torrent',
  'logging',
  'location',
  'storageinfo',
  'quota',
  'storageclass',
  'storagepolicy',
  'mirrorbacktosource',
  'requestpayment',
  'versions',
  'versioning',
  'versionid',
  'uploads',
  'uploadid',
  'partnumber',
  'website',
  'notification',
  'replication',
  'lifecycle',
  'deletebucket',
  'delete',
  'cors',
  'restore',
  'tagging',
  'append',
  'position',
  'response-content-type',
  'response-content-language',
  'response-expires',
  'response-cache-control',
  'response-content-disposition',
  'response-content-encoding',
  'x-image-process',
  'x-image-save-object',
  'x-image-save-bucket',
  'x-oss-process',
  'encryption',
  'obsworkflowtriggerpolicy',
  'x-workflow-limit',
  'x-workflow-prefix',
  'x-workflow-start',
  'x-workflow-template-name',
  'x-workflow-graph-name',
  'x-workflow-execution-state',
  'x-workflow-category',
  'x-workflow-prefix',
  'x-workflow-create',
  'directcoldaccess',
  'customdomain',
  'cdnnotifyconfiguration',
  'metadata',
  'dispolicy',
  'obscompresspolicy',
  'template_name',
  'template_name_prefix',
  'x-workflow-status',
  'x-workflow-type',
  'x-workflow-forbid',
  'sfsacl',
  'obsbucketalias',
  'obsalias',
  'rename',
  'name',
  'modify',
  'attname',
  'inventory',
  'truncate',
  'object-lock',
  'x-obs-security-token',
  'publicaccessblock',
  'x-obs-trash',
  'bucketstatus',
  'policystatus',
  'x-obs-callback',
]

/**
 * OBS URL encoding: encodeURIComponent plus the extra RFC 3986 chars
 * (! ' ( ) *), with '/' preserved when keepSlash is true. Matches the
 * official SDK's encodeURIWithSafe.
 */
export function encodeObsUrl(str: string, keepSlash = true): string {
  let out = ''
  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i)
    out += keepSlash && ch === '/' ? '/' : encodeURIComponent(ch)
  }
  return out
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

export interface ObsSignatureOptions {
  verb: string
  contentMd5?: string
  headers?: Record<string, any>
  bucket?: string
  objectName?: string
  accessKeySecret: string
  subResource?: Record<string, any>
  /** Unix timestamp for pre-signed URLs; when set it replaces the date line. */
  expires?: number
}

/**
 * The whitelisted sub-resource query string, sorted and filtered like the
 * official SDK: keys and values are decoded and used verbatim.
 */
export function canonicalObsQuery(subResource?: Record<string, any>): string {
  if (!subResource) return ''
  const items: string[] = []
  Object.keys(subResource).forEach((key) => {
    const value = subResource[key]
    items.push(value === '' || value == null ? key : `${key}=${value}`)
  })
  items.sort()
  const out: string[] = []
  for (const item of items) {
    const listvar = item.split('=')
    const key = decodeURIComponent(listvar[0])
    if (OBS_RESOURCE_PARAMS.indexOf(key.toLowerCase()) > -1) {
      out.push(
        listvar.length === 2 && listvar[1] ? `${key}=${decodeURIComponent(listvar[1])}` : key,
      )
    }
  }
  return out.length ? `?${out.join('&')}` : ''
}

/** x-obs-* headers sorted by lower-cased key; meta values are trimmed. */
export function canonicalObsHeaders(headers: Record<string, any>): string {
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .filter((name) => name.indexOf('x-obs-') === 0)
    .sort()
  let out = ''
  for (const name of names) {
    const value =
      name.indexOf('x-obs-meta-') === 0 ? String(headers[name]).trim() : String(headers[name])
    out += `${name}:${value}\n`
  }
  return out
}

/**
 * Build the OBS StringToSign and compute its HMAC-SHA1 base64 signature.
 * For header signing the caller sets x-obs-date, so the date line is
 * empty (the header participates via canonicalObsHeaders, exactly like
 * the official SDK). For URL signing pass `expires` instead.
 */
export function getObsSignature(opt: ObsSignatureOptions): string {
  const headers = opt.headers || {}
  const contentType =
    headers['Content-Type'] != null
      ? String(headers['Content-Type'])
      : headers['content-type'] != null
        ? String(headers['content-type'])
        : ''
  // The official SDK reads the MD5 from the headers ('Content-MD5'); our
  // put/uploadPart ops send 'Content-Md5' (OSS casing), so accept both.
  const contentMd5 =
    opt.contentMd5 != null
      ? String(opt.contentMd5)
      : headers['Content-MD5'] != null
        ? String(headers['Content-MD5'])
        : headers['Content-Md5'] != null
          ? String(headers['Content-Md5'])
          : ''
  const dateLine = opt.expires != null ? String(opt.expires) : ''
  const parts = [opt.verb, contentMd5, contentType, dateLine]
  let resource = opt.bucket ? `/${opt.bucket}` : ''
  if (opt.objectName) resource += `/${encodeObsUrl(opt.objectName, true)}`
  resource += canonicalObsQuery(opt.subResource)
  // The date line is followed by a newline (from the join), then the
  // x-obs-* headers, then the resource — same layout as the official SDK.
  parts.push(canonicalObsHeaders(headers) + resource)
  const text = parts.join('\n')
  const hmac = Digest.HMAC_SHA1()
  hmac.setKey(encodeUtf8(opt.accessKeySecret))
  hmac.update(encodeUtf8(text))
  return base64js.fromByteArray(new Uint8Array(hmac.finalize()))
}
