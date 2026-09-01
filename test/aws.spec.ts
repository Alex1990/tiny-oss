import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveAwsHost } from '../src/aws/host';
import { awsSignUrl } from '../src/aws/signatureUrl';
import { request } from '../src/aws/request';
import { setTransport, getTransport } from '../src/transport';
import { put, multipartUpload } from '../src/aws/index';

const OPTIONS = {
  accessKeyId: 'AKIDEXAMPLE',
  accessKeySecret: 'SECRETKEY',
  region: 'us-west-2',
  bucket: 'examplebucket',
  secure: true,
};

describe('resolveAwsHost', () => {
  it('builds bucket.s3.region.amazonaws.com', () => {
    expect(resolveAwsHost(OPTIONS)).toBe('examplebucket.s3.us-west-2.amazonaws.com');
  });

  it('omits the region for us-east-1', () => {
    expect(resolveAwsHost({ ...OPTIONS, region: 'us-east-1' })).toBe('examplebucket.s3.amazonaws.com');
  });

  it('prefers an explicit endpoint', () => {
    expect(resolveAwsHost({ ...OPTIONS, endpoint: 's3.example.com' })).toBe('s3.example.com');
  });
});

describe('awsSignUrl', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the SigV4 query-parameter scheme', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const url = awsSignUrl(OPTIONS, 'dir/file name.txt', { expires: 60 });
    const u = new URL(url);
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('examplebucket.s3.us-west-2.amazonaws.com');
    expect(u.pathname).toBe('/dir/file%20name.txt');
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Date')).toBe('20260901T000000Z');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(u.searchParams.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20260901/us-west-2/s3/aws4_request');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('appends X-Amz-Security-Token for temporary credentials', () => {
    const url = awsSignUrl({ ...OPTIONS, stsToken: 'TOKEN' }, 'exampleobject');
    expect(url).toContain('X-Amz-Security-Token=TOKEN');
  });

  it('adds response-* headers', () => {
    const url = awsSignUrl(OPTIONS, 'exampleobject', {
      response: { 'content-disposition': 'attachment' },
    });
    expect(url).toContain('response-content-disposition=attachment');
  });
});

describe('aws request', () => {
  afterEach(() => {
    setTransport(getTransport());
  });

  it('signs with SigV4 headers and UNSIGNED-PAYLOAD', async () => {
    const calls: any[] = [];
    setTransport(async (url: string, opts: any) => {
      calls.push({ url, opts });
      return { data: '', headers: {}, status: 200, statusText: 'OK' };
    });
    await request(OPTIONS, {
      verb: 'PUT',
      objectName: 'exampleobject',
      contentMd5: 'abc==',
      headers: { 'Content-Type': 'text/plain' },
      data: new Blob(['hello']),
    });
    const { url, opts } = calls[0];
    expect(url).toBe('https://examplebucket.s3.us-west-2.amazonaws.com/exampleobject');
    expect(opts.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(opts.headers['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD');
    expect(opts.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-west-2\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/
    );
    expect(opts.method).toBe('PUT');
  });

  it('puts the STS token header and signs it', async () => {
    const calls: any[] = [];
    setTransport(async (url: string, opts: any) => {
      calls.push(opts);
      return { data: '', headers: {}, status: 200, statusText: 'OK' };
    });
    await request({ ...OPTIONS, stsToken: 'TOKEN' }, { verb: 'GET', objectName: 'exampleobject' });
    expect(calls[0].headers['x-amz-security-token']).toBe('TOKEN');
    expect(calls[0].headers.Authorization).toContain('x-amz-security-token');
  });

  it('encodes the object key and puts sub-resources in the query', async () => {
    const calls: any[] = [];
    setTransport(async (url: string, opts: any) => {
      calls.push({ url, opts });
      return { data: '', headers: {}, status: 200, statusText: 'OK' };
    });
    await request(OPTIONS, {
      verb: 'PUT',
      objectName: 'dir/file name.bin',
      subResource: { partNumber: '1', uploadId: 'u123' },
    });
    expect(calls[0].url).toBe(
      'https://examplebucket.s3.us-west-2.amazonaws.com/dir/file%20name.bin?partNumber=1&uploadId=u123'
    );
  });
});

describe('AWS entry point', () => {
  it('put signs with SigV4 and sends Content-Md5', async () => {
    const calls: any[] = [];
    setTransport(async (url: string, opts: any) => {
      calls.push(opts);
      return { data: '', headers: {}, status: 200, statusText: 'OK' };
    });
    await put(OPTIONS, 'exampleobject', new Blob(['hello'], { type: 'text/plain' }));
    expect(calls[0].headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(calls[0].headers['Content-Md5']).toBeTruthy();
    expect(calls[0].headers['Content-Type']).toBe('text/plain');
  });

  it('multipartUpload meta uses the x-amz-meta- prefix', async () => {
    const calls: any[] = [];
    setTransport(async (url: string, opts: any) => {
      const headers: Record<string, string> = {};
      if (url.indexOf('?uploads') > -1) {
        calls.push({ url, opts });
        return { data: '<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>u1</UploadId></InitiateMultipartUploadResult>', headers: {}, status: 200, statusText: 'OK' };
      }
      if (url.indexOf('?uploadId') > -1 && opts.method === 'POST') {
        return { data: '<CompleteMultipartUploadResult><Location>x</Location><Bucket>b</Bucket><Key>k</Key><ETag>"e"</ETag></CompleteMultipartUploadResult>', headers: {}, status: 200, statusText: 'OK' };
      }
      calls.push({ url, opts });
      return { data: '', headers: { etag: '"part"' }, status: 200, statusText: 'OK' };
    });
    const result = await multipartUpload(OPTIONS, 'k', new Uint8Array([1, 2, 3]), { meta: { title: 't' } });
    expect(result.etag).toBeTruthy();
    const initCall = calls.find((c) => c.url.indexOf('?uploads') > -1);
    expect(initCall.opts.headers['x-amz-meta-title']).toBe('t');
  });

  it('does not export putSymlink', async () => {
    const mod = await import('../src/aws/index');
    expect((mod as any).putSymlink).toBeUndefined();
  });
});
