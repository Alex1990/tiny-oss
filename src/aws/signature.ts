import { sha256, hmacSha256 } from './sha256';
import { encodeUtf8 } from '../utils/utf8';

/**
 * AWS Signature Version 4 (SigV4) for S3, mirroring the official aws-sdk
 * v2 signers/v4.js behavior (S3 specifics included):
 *
 *   CanonicalRequest = Method\n
 *                      CanonicalURI\n             // URI-escaped, '/' kept
 *                      CanonicalQueryString\n     // sorted, URI-escaped
 *                      CanonicalHeaders\n\n
 *                      SignedHeaders\n
 *                      PayloadHash                 // 'UNSIGNED-PAYLOAD'
 *   StringToSign = AWS4-HMAC-SHA256\n
 *                  amzDate\n
 *                  date/region/s3/aws4_request\n
 *                  hex(SHA256(CanonicalRequest))
 *   SigningKey = HMAC-SHA256(HMAC-SHA256(HMAC-SHA256(HMAC-SHA256(
 *                'AWS4'+SecretKey, date), region), 's3'), 'aws4_request')
 *   Signature = hex(HMAC-SHA256(SigningKey, StringToSign))
 *
 * S3 specifics: the body hash is 'UNSIGNED-PAYLOAD' (the official SDK
 * disables body signing for S3), content-type/content-length are not
 * signable headers, and every query parameter participates.
 */

/** URI-escape per the AWS SDK: encodeURIComponent plus '*' -> %2A. */
export function awsUriEscape(str: string): string {
  return encodeURIComponent(str).replace(/\*/g, '%2A');
}

/** URI-escape a path segment by segment so '/' is preserved (aws-sdk uriEscapePath). */
export function awsUriEscapePath(str: string): string {
  return str.split('/').map(awsUriEscape).join('/');
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function sha256Hex(str: string): string {
  return bytesToHex(new Uint8Array(sha256().digest(encodeUtf8(str))));
}

function hmacSha256Hex(key: string | Uint8Array, message: string): string {
  const hmac = hmacSha256();
  hmac.setKey(key instanceof Uint8Array ? key : encodeUtf8(key));
  hmac.update(encodeUtf8(message));
  return bytesToHex(new Uint8Array(hmac.finalize()));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** Headers that never participate in a SigV4 signature. */
const UNSIGNABLE_HEADERS = [
  'authorization',
  'content-type',
  'content-length',
  'user-agent',
  'presigned-expires',
  'expect',
  'x-amzn-trace-id',
];

/** Serialize query params sorted and URI-escaped (aws-sdk queryParamsToString). */
export function canonicalQueryString(query: Record<string, any>): string {
  return Object.keys(query)
    .sort()
    .map((name) => {
      const value = query[name];
      const ename = awsUriEscape(name);
      if (value === undefined || value === null) return `${ename}=`;
      if (Array.isArray(value)) {
        return `${ename}=${value.map((v) => awsUriEscape(String(v))).sort().join(`&${ename}=`)}`;
      }
      return `${ename}=${awsUriEscape(String(value))}`;
    })
    .join('&');
}

export interface AwsSignOptions {
  method: string;
  /** Canonical URI — the URI-escaped object path with '/' kept, e.g. '/dir/file.txt'. */
  pathname: string;
  query?: Record<string, any>;
  /** Signable request headers; must include 'host'. */
  headers: Record<string, any>;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** Payload hash; defaults to 'UNSIGNED-PAYLOAD' (S3 behavior). */
  payloadHash?: string;
  /** Fixed 'YYYYMMDDTHHMMSSZ' timestamp for tests; defaults to now. */
  date?: string;
}

/**
 * Compute the SigV4 signature. Returns the pieces needed by both header
 * authorization and pre-signed URL construction.
 */
export function getAwsSignature(opt: AwsSignOptions): {
  amzDate: string;
  credentialScope: string;
  signedHeaders: string;
  signature: string;
} {
  const { method, pathname, headers, accessKeyId, secretAccessKey, region } = opt;
  if (!accessKeyId) throw new Error('need accessKeyId');
  if (!secretAccessKey) throw new Error('need accessKeySecret');
  const service = opt.service || 's3';
  const amzDate = opt.date || iso8601(new Date());
  const shortDate = amzDate.substr(0, 8);
  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;
  const payloadHash = opt.payloadHash || 'UNSIGNED-PAYLOAD';

  const canonicalHeaders: string[] = [];
  const signedNames: string[] = [];
  Object.keys(headers)
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
    .forEach((key) => {
      const lower = key.toLowerCase();
      if (lower.indexOf('x-amz-') === 0 || UNSIGNABLE_HEADERS.indexOf(lower) < 0) {
        signedNames.push(lower);
        canonicalHeaders.push(`${lower}:${String(headers[key]).replace(/\s+/g, ' ').trim()}`);
      }
    });
  const signedHeaders = signedNames.join(';');

  const canonicalRequest = [
    method,
    pathname,
    canonicalQueryString(opt.query || {}),
    `${canonicalHeaders.join('\n')}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256Hex(`AWS4${secretAccessKey}`, shortDate);
  const kRegion = hmacSha256Hex(hexToBytes(kDate), region);
  const kService = hmacSha256Hex(hexToBytes(kRegion), service);
  const kSigning = hmacSha256Hex(hexToBytes(kService), 'aws4_request');
  const signature = hmacSha256Hex(hexToBytes(kSigning), stringToSign);

  return { amzDate, credentialScope, signedHeaders, signature };
}

/** 'YYYYMMDDTHHMMSSZ' from a Date. */
export function iso8601(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}
