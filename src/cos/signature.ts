import { Digest } from '../digest';
import { encodeUtf8 } from '../utils/utf8';

/**
 * Tencent COS request signature (V5), per
 * https://cloud.tencent.com/document/product/436/7778.
 *
 * The algorithm mirrors the official cos-js-sdk-v5 util.getAuth exactly:
 *   KeyTime = [now];[expires]
 *   SignKey = hex(HMAC-SHA1(SecretKey, KeyTime))
 *   HttpString = method\npathname\nHttpParameters\nHttpHeaders\n
 *   StringToSign = sha1\nKeyTime\nhex(SHA1(HttpString))\n
 *   Signature = hex(HMAC-SHA1(SignKey, StringToSign))
 *   Authorization = q-sign-algorithm=sha1&q-ak=SecretId&q-sign-time=KeyTime
 *                   &q-key-time=KeyTime&q-header-list=...&q-url-param-list=...
 *                   &q-signature=Signature
 *
 * Headers participate only if they are in the signable whitelist or start
 * with x-cos-/x-ci-; host is always included. Keys are lower-cased and
 * URL-encoded, values URL-encoded, both sorted lexicographically.
 */

/** URL-encode per the COS spec: encodeURIComponent plus the extra RFC 3986 chars. */
export function camSafeUrlEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function sha1Hex(str: string): string {
  return bytesToHex(new Uint8Array(Digest.SHA1().digest(encodeUtf8(str))));
}

function hmacSha1Hex(key: string, message: string): string {
  const hmac = Digest.HMAC_SHA1();
  hmac.setKey(encodeUtf8(key));
  hmac.update(encodeUtf8(message));
  return bytesToHex(new Uint8Array(hmac.finalize()));
}

function getObjectKeys(obj: Record<string, string>, forKey?: boolean): string[] {
  const list = Object.keys(obj).map((key) => (forKey ? camSafeUrlEncode(key).toLowerCase() : key));
  return list.sort();
}

/** Serialize an object to `key=value&...` with COS encoding rules, keys sorted. */
function obj2str(obj: Record<string, string>, lowerCaseKey: boolean): string {
  return getObjectKeys(obj)
    .map((key) => {
      const val = obj[key] === undefined || obj[key] === null ? '' : String(obj[key]);
      const k = lowerCaseKey ? camSafeUrlEncode(key).toLowerCase() : camSafeUrlEncode(key);
      const v = camSafeUrlEncode(val) || '';
      return `${k}=${v}`;
    })
    .join('&');
}

/** Headers that participate in the signature, per the official SDK. */
const SIGN_HEADERS = [
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-md5',
  'expect',
  'expires',
  'host',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'origin',
  'range',
  'transfer-encoding',
  'pic-operations',
];

function pickSignHeaders(headers: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  Object.keys(headers).forEach((key) => {
    const lower = key.toLowerCase();
    if (lower.indexOf('x-cos-') === 0 || lower.indexOf('x-ci-') === 0 || SIGN_HEADERS.indexOf(lower) > -1) {
      out[key] = String(headers[key]);
    }
  });
  return out;
}

export interface CosAuthOptions {
  method: string;
  /** Request path, e.g. '/exampleobject' or '/'; NOT URL-encoded. */
  pathname: string;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  secretId: string;
  secretKey: string;
  /** Explicit 'start;end' key time; defaults to now-1;now+expires. */
  keyTime?: string;
  /** Validity in seconds; default 900. */
  expires?: number;
  /** Host to sign (and inject into headers when absent), e.g. bucket.cos.region.myqcloud.com. */
  host?: string;
}

/**
 * Compute a COS V5 Authorization header value.
 */
export function getCosAuth(opt: CosAuthOptions): string {
  const { method, pathname, secretId, secretKey } = opt;
  if (!secretId) throw new Error('need accessKeyId (SecretId)');
  if (!secretKey) throw new Error('need accessKeySecret (SecretKey)');

  const headers = pickSignHeaders({ ...opt.headers });
  if (opt.host && !headers.Host && !headers.host) headers.Host = opt.host;

  const query: Record<string, string> = {};
  if (opt.query) {
    Object.keys(opt.query).forEach((key) => {
      const value = opt.query![key];
      if (value !== undefined) query[key] = String(value);
    });
  }

  const now = Math.floor(Date.now() / 1000) - 1;
  const exp = now + (opt.expires === undefined ? 900 : (opt.expires || 0));
  const keyTime = opt.keyTime || `${now};${exp}`;

  // 步骤一：计算 SignKey
  const signKey = hmacSha1Hex(secretKey, keyTime);

  // 步骤二：构成 HttpString
  const formatString = [
    method.toLowerCase(),
    pathname,
    obj2str(query, true),
    obj2str(headers, true),
    '',
  ].join('\n');

  // 步骤三：计算 StringToSign
  const stringToSign = ['sha1', keyTime, sha1Hex(formatString), ''].join('\n');

  // 步骤四：计算 Signature
  const qSignature = hmacSha1Hex(signKey, stringToSign);

  // 步骤五：构造 Authorization
  const qHeaderList = getObjectKeys(headers, true).join(';');
  const qUrlParamList = getObjectKeys(query, true).join(';');
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${qHeaderList}`,
    `q-url-param-list=${qUrlParamList}`,
    `q-signature=${qSignature}`,
  ].join('&');
}
