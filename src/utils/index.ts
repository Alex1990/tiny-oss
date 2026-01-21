import md5 from 'md5';
import base64js from 'base64-js';
import { Digest } from '../digest';

function isDate(obj: any): boolean {
  return obj instanceof Date && !isNaN(obj.getTime());
}

function unix(date?: string | number | Date): number {
  const timestamp = date ? new Date(date).getTime() : Date.now();
  return Math.floor(isNaN(timestamp) ? Date.now() : timestamp / 1000);
}

function blobToBuffer(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = new Uint8Array(fr.result as ArrayBuffer);
      resolve(result);
    };
    fr.onerror = () => {
      reject(fr.error);
    };
    fr.readAsArrayBuffer(blob);
  });
}

interface Options {
  accessKeyId?: string;
  accessKeySecret?: string;
  bucket?: string;
  endpoint?: string;
}

function assertOptions(options: Options): void {
  const { accessKeyId, accessKeySecret, bucket, endpoint } = options;
  if (!accessKeyId) throw new Error('need accessKeyId');
  if (!accessKeySecret) throw new Error('need accessKeySecret');
  if (!bucket && !endpoint) throw new Error('need bucket or endpoint');
}

function hexToBuffer(hex: string): Uint8Array {
  const arr = [];
  for (let i = 0; i < hex.length; i += 2) {
    arr.push(parseInt(hex[i] + hex[i + 1], 16));
  }
  return Uint8Array.from(arr);
}

function getContentMd5(buf: Uint8Array): string {
  const bytes = Array.prototype.slice.call(buf, 0);
  const md5Buf = hexToBuffer(md5(bytes));
  return base64js.fromByteArray(md5Buf);
}

function getCanonicalizedOSSHeaders(headers: Record<string, any>): string {
  let result = '';
  let headerNames = Object.keys(headers);
  headerNames = headerNames.map(name => name.toLowerCase());
  headerNames.sort();
  headerNames.forEach((name) => {
    if (name.indexOf('x-oss-') === 0) {
      result += `${name}:${headers[name]}\n`;
    }
  });
  return result;
}

function getCanonicalizedResource(bucket = '', objectName = '', parameters?: Record<string, any>): string {
  let resourcePath = '';
  if (bucket) resourcePath += `/${bucket}`;
  if (objectName) {
    if (objectName.charAt(0) !== '/') resourcePath += '/';
    resourcePath += objectName;
  }
  let canonicalizedResource = `${resourcePath}`;
  let separatorString = '?';
  if (parameters) {
    const compareFunc = (entry1: string, entry2: string) => entry1 > entry2 ? 1 : (entry1 < entry2 ? -1 : 0);
    const processFunc = (key: string) => {
      canonicalizedResource += separatorString + key;
      if (parameters[key]) canonicalizedResource += `=${parameters[key]}`;
      separatorString = '&';
    };
    Object.keys(parameters).sort(compareFunc).forEach(processFunc);
  }
  return canonicalizedResource;
}

interface SignatureOptions {
  type?: 'header' | 'url';
  verb?: string;
  contentMd5?: string;
  expires?: number;
  bucket?: string;
  objectName?: string;
  accessKeySecret: string;
  headers?: Record<string, any>;
  subResource?: Record<string, any>;
}

function getSignature(options: SignatureOptions): string {
  const {
    type = 'header',
    verb = '',
    contentMd5 = '',
    expires = unix() + 3600,
    bucket,
    objectName,
    accessKeySecret,
    headers = {},
    subResource,
  } = options;
  const date = headers['x-oss-date'] || '';
  const contentType = headers['Content-Type'] || '';
  const data = [verb, contentMd5, contentType];
  if (type === 'header') {
    data.push(date);
  } else {
    data.push(expires);
  }
  const canonicalizedOSSHeaders = getCanonicalizedOSSHeaders(headers);
  const canonicalizedResource = getCanonicalizedResource(bucket, objectName, subResource);
  data.push(`${canonicalizedOSSHeaders}${canonicalizedResource}`);
  const text = data.join('\n');
  const hmac = Digest.HMAC_SHA1();
  hmac.setKey(accessKeySecret);
  hmac.update(text);
  const hashBuf = new Uint8Array(hmac.finalize());
  const signature = base64js.fromByteArray(hashBuf);
  return signature;
}

export {
  unix,
  blobToBuffer,
  assertOptions,
  getContentMd5,
  getCanonicalizedOSSHeaders,
  getCanonicalizedResource,
  getSignature,
};
