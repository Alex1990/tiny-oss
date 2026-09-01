import base64js from 'base64-js';
import { hmacSha256 } from '../aws/sha256';
import { encodeUtf8 } from '../utils';
import { normalizeOptions } from '../ops/request';
import { resolveAzureHost, azureEscapePath } from './host';
import { AZURE_API_VERSION } from './request';
import type { TinyOSS } from '../types';

/** Azure defaults: https, 60s timeout. */
const AZURE_DEFAULTS = {
  secure: true,
  timeout: 60000,
};

/** ISO 8061 without milliseconds, as the official SDK truncates it. */
function truncatedIso(date: Date): string {
  const s = date.toISOString();
  return s.substring(0, s.length - 5) + 'Z';
}

/**
 * Get a signed URL for an Azure blob (service SAS, version
 * 2020-12-06), mirroring @azure/storage-blob's
 * generateBlobSASQueryParameters byte for byte:
 *
 *   https://<account>.blob.core.windows.net/<container>/<blob>
 *     ?sv=2020-12-06&se=<ISO 8061>&sr=b&sp=<permission>&sig=<base64>
 *     [&rscc=<content-type>...]
 *
 * The string-to-sign fields must be URL-decoded; the canonical name is
 * "/blob/<account>/<container>/<blob>" with the un-encoded blob name.
 * The start time is omitted so the SAS is valid immediately.
 *
 * @param options client options (accessKeyId = account name,
 *   accessKeySecret = base64 account key, bucket = container)
 * @param objectName blob name
 * @param urlOptions signature options, same shape as the OSS entry
 * @return SAS URL
 */
export function azureSignUrl(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  urlOptions: TinyOSS.SignatureUrlOptions = {}
): string {
  const { expires = 1800, method, response } = urlOptions;
  const opts = normalizeOptions(options, AZURE_DEFAULTS);
  const { accessKeyId, accessKeySecret, bucket, secure } = opts;
  const account = accessKeyId as string;
  // GET/HEAD read; PUT writes. Azure has no separate upload-URL verb.
  const sp = method === 'PUT' ? 'w' : 'r';
  const se = truncatedIso(new Date(Date.now() + expires * 1000));
  const sr = 'b';
  const canonicalName = `/blob/${account}/${bucket}${objectName ? `/${objectName}` : ''}`;
  // Response-header overrides: rscc=cache-control, rscd=content-disposition,
  // rsce=content-encoding, rscl=content-language, rsct=content-type.
  const rscc = (response && response['cache-control']) || '';
  const rscd = (response && response['content-disposition']) || '';
  const rsce = (response && response['content-encoding']) || '';
  const rscl = (response && response['content-language']) || '';
  const rsct = (response && response['content-type']) || '';
  // Field order (version 2020-12-06): permissions, start, expiry,
  // canonical resource, identifier, IP, protocol, version, resource,
  // snapshot time, encryption scope, then the five response-header
  // overrides (rscc, rscd, rsce, rscl, rsct).
  const stringToSign = [sp, '', se, canonicalName, '', '', '', AZURE_API_VERSION, sr, '', '', rscc, rscd, rsce, rscl, rsct].join('\n');
  const hmac = hmacSha256();
  hmac.setKey(base64js.toByteArray(accessKeySecret as string));
  hmac.update(encodeUtf8(stringToSign));
  const sig = base64js.fromByteArray(new Uint8Array(hmac.finalize()));
  const queries: Array<[string, string]> = [];
  const push = (name: string, value: string) => {
    if (value) queries.push([name, value]);
  };
  push('sv', AZURE_API_VERSION);
  push('se', se);
  push('sr', sr);
  push('sp', sp);
  push('rscc', rscc);
  push('rscd', rscd);
  push('rsce', rsce);
  push('rscl', rscl);
  push('rsct', rsct);
  push('sig', sig);
  const qs = queries.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
  const protocol = secure ? 'https' : 'http';
  const pathname = `/${bucket}/${azureEscapePath(objectName)}`;
  return `${protocol}://${resolveAzureHost(opts)}${pathname}?${qs}`;
}
