import { describe, it, expect, vi, afterEach } from 'vitest';
import { getObsSignature, encodeObsUrl } from '../src/obs/signature';
import { obsSignUrl } from '../src/obs/signatureUrl';
// Official Huawei Cloud OBS SDK used as an oracle: our signer must
// produce byte-identical Authorization headers and signed URLs.
import ObsClient from 'esdk-obs-browserjs';

const AK = 'AKIDEXAMPLE';
const SK = 'SECRETKEY';
const REGION = 'cn-north-4';
const SERVER = 'obs.cn-north-4.myhuaweicloud.com';
const BUCKET = 'bucket';
const HOST = `${BUCKET}.${SERVER}`;
const OBS_CTX = { signature: 'obs', headerPrefix: 'x-obs-', headerMetaPrefix: 'x-obs-meta-', authPrefix: 'OBS' };

function makeClient() {
  return new ObsClient({
    access_key_id: AK,
    secret_access_key: SK,
    server: SERVER,
    signature: 'obs',
    region: REGION,
    security_token: 'TOKEN',
    is_secure: false,
  });
}

interface HeaderCase {
  name: string;
  verb: string;
  objectName: string;
  headers?: Record<string, any>;
  contentMd5?: string;
  subResource?: Record<string, any>;
}

const HEADER_CASES: HeaderCase[] = [
  {
    name: 'PUT with Content-MD5/Content-Type and security token',
    verb: 'PUT',
    objectName: 'exampleobject',
    headers: {
      'x-obs-date': 'Wed, 01 Sep 2026 00:00:00 GMT',
      Host: HOST,
      'Content-MD5': 'mQ/fVh815F3k6TAUm8m0eg==',
      'Content-Type': 'text/plain',
      'x-obs-security-token': 'TOKEN',
    },
  },
  {
    name: 'meta headers are trimmed in the signature',
    verb: 'PUT',
    objectName: 'exampleobject',
    headers: {
      'x-obs-date': 'Wed, 01 Sep 2026 00:00:00 GMT',
      Host: HOST,
      'x-obs-meta-title': '  padded title  ',
      'x-obs-acl': 'private',
    },
  },
  {
    name: 'GET with ?uploads (empty value)',
    verb: 'POST',
    objectName: 'bigfile.bin',
    headers: {
      'x-obs-date': 'Wed, 01 Sep 2026 00:00:00 GMT',
      Host: HOST,
      'Content-Type': 'application/octet-stream',
    },
    subResource: { uploads: '' },
  },
  {
    name: 'uploadPart: only whitelisted query params are signed',
    verb: 'PUT',
    objectName: 'bigfile.bin',
    headers: {
      'x-obs-date': 'Wed, 01 Sep 2026 00:00:00 GMT',
      Host: HOST,
      'Content-MD5': 'abc==',
    },
    subResource: { partNumber: '1', uploadId: 'u123' },
  },
  {
    name: 'listParts: max-parts/part-number-marker excluded from the signature',
    verb: 'GET',
    objectName: 'bigfile.bin',
    headers: {
      'x-obs-date': 'Wed, 01 Sep 2026 00:00:00 GMT',
      Host: HOST,
    },
    subResource: { uploadId: 'u123', 'max-parts': '10', 'part-number-marker': '3' },
  },
  {
    name: 'DELETE with uploadId',
    verb: 'DELETE',
    objectName: 'bigfile.bin',
    headers: {
      'x-obs-date': 'Wed, 01 Sep 2026 00:00:00 GMT',
      Host: HOST,
    },
    subResource: { uploadId: 'u456' },
  },
  {
    name: 'empty Content-Type header line',
    verb: 'PUT',
    objectName: 'exampleobject',
    headers: {
      'x-obs-date': 'Wed, 01 Sep 2026 00:00:00 GMT',
      Host: HOST,
      'Content-Type': '',
    },
  },
];

describe('getObsSignature matches the official OBS SDK (oracle)', () => {
  for (const c of HEADER_CASES) {
    it(c.name, () => {
      const client = makeClient();
      const opt = {
        method: c.verb,
        uri: `/${BUCKET}/${c.objectName}`,
        urlPath: '',
        headers: { ...c.headers },
      };
      if (c.subResource) {
        opt.urlPath = `?${Object.keys(c.subResource)
          .map((k) => (c.subResource![k] === '' ? k : `${k}=${c.subResource![k]}`))
          .join('&')}`;
      }
      client.util.doAuth(opt, 'PutObject', OBS_CTX);
      const mine = getObsSignature({
        verb: c.verb,
        contentMd5: c.contentMd5,
        headers: c.headers,
        bucket: BUCKET,
        objectName: c.objectName,
        accessKeySecret: SK,
        subResource: c.subResource,
      });
      expect(`OBS ${AK}:${mine}`).toBe(opt.headers.Authorization);
    });
  }
});

const FIXED_TIME = new Date('2026-09-01T00:00:00.000Z');

function stripPort(url: string): string {
  return url.replace(/:80\//, '/').replace(/:443\//, '/');
}

describe('obsSignUrl matches the official OBS SDK (oracle)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const cases: Array<{ name: string; key: string; urlOptions?: Record<string, any>; officialExpires?: number }> = [
    { name: 'plain GET download', key: 'exampleobject', urlOptions: { expires: 1800 }, officialExpires: 1800 },
    { name: 'object key with non-ASCII characters', key: 'exampleobject(中文)', urlOptions: { expires: 1800 }, officialExpires: 1800 },
    { name: 'response-* headers and x-image-process', key: 'exampleobject', urlOptions: { expires: 1800, response: { 'content-disposition': 'attachment', 'content-type': 'text/plain' }, process: 'image/resize,w_100' }, officialExpires: 1800 },
    { name: 'custom expires', key: 'exampleobject', urlOptions: { expires: 60 }, officialExpires: 60 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_TIME);
      const client = makeClient();
      const official = client.createSignedUrlSync({
        Method: 'GET',
        Bucket: BUCKET,
        Key: c.key,
        Expires: c.officialExpires!,
        QueryParams: (() => {
          const q: Record<string, string> = {};
          if (c.urlOptions && c.urlOptions.response) {
            Object.keys(c.urlOptions.response).forEach((k) => {
              q[`response-${k}`] = c.urlOptions!.response[k];
            });
          }
          if (c.urlOptions && c.urlOptions.process) q['x-image-process'] = c.urlOptions.process;
          return Object.keys(q).length ? q : undefined;
        })(),
        signatureContext: OBS_CTX,
      }).SignedUrl;
      const mine = obsSignUrl(
        {
          accessKeyId: AK,
          accessKeySecret: SK,
          region: REGION,
          bucket: BUCKET,
          secure: false,
          stsToken: 'TOKEN',
        },
        c.key,
        (c.urlOptions || {}) as any
      );
      expect(stripPort(mine)).toBe(stripPort(official));
    });
  }

  it('the default validity is 1800s like the OSS entry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
    const url = obsSignUrl(
      { accessKeyId: AK, accessKeySecret: SK, region: REGION, bucket: BUCKET, secure: false },
      'exampleobject'
    );
    const exp = /Expires=(\d+)/.exec(url);
    expect(exp).toBeTruthy();
    expect(parseInt(exp![1], 10)).toBe(Math.floor(FIXED_TIME.getTime() / 1000) + 1800);
  });
});

describe('encodeObsUrl', () => {
  it('encodes the RFC 3986 chars that encodeURIComponent leaves alone', () => {
    expect(encodeObsUrl("!'()*", false)).toBe('%21%27%28%29%2A');
  });

  it('preserves slashes when keepSlash is on', () => {
    expect(encodeObsUrl('a/b c', true)).toBe('a/b%20c');
  });
});
