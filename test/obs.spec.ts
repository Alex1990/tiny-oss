import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveObsHost } from '../src/obs/host';
import { obsSignUrl } from '../src/obs/signatureUrl';
import { request } from '../src/obs/request';
import { setTransport, getTransport } from '../src/transport';
import { put } from '../src/obs/index';

const OPTIONS = {
  accessKeyId: 'AKIDEXAMPLE',
  accessKeySecret: 'SECRETKEY',
  region: 'cn-north-4',
  bucket: 'examplebucket',
  secure: true,
};

describe('resolveObsHost', () => {
  it('builds bucket.obs.region.myhuaweicloud.com', () => {
    expect(resolveObsHost(OPTIONS)).toBe('examplebucket.obs.cn-north-4.myhuaweicloud.com');
  });

  it('prefers an explicit endpoint', () => {
    expect(resolveObsHost({ ...OPTIONS, endpoint: 'obs.example.com' })).toBe('obs.example.com');
  });

  it('throws when neither region nor endpoint is set', () => {
    expect(() => resolveObsHost({ bucket: 'examplebucket' })).toThrow(/region/);
  });
});

describe('obsSignUrl', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the OBS query-parameter scheme with an encoded signature', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const url = obsSignUrl(OPTIONS, 'dir/file name.txt', { expires: 60 });
    const u = new URL(url);
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('examplebucket.obs.cn-north-4.myhuaweicloud.com');
    expect(u.pathname).toBe('/dir/file%20name.txt');
    expect(u.searchParams.get('AccessKeyId')).toBe('AKIDEXAMPLE');
    expect(u.searchParams.get('Expires')).toBe(String(Math.floor(Date.now() / 1000) + 60));
    // base64 signature survives the URL round-trip
    expect(/^[A-Za-z0-9+/=]+$/.test(u.searchParams.get('Signature')!)).toBe(true);
    // the raw URL keeps '/' but encodes '+' and '='
    const rawSig = /Signature=([^&]+)/.exec(url)![1];
    expect(rawSig).not.toContain('+');
    expect(rawSig).not.toContain('=');
  });

  it('appends x-obs-security-token for temporary credentials', () => {
    const url = obsSignUrl({ ...OPTIONS, stsToken: 'TOKEN' }, 'exampleobject');
    expect(url).toContain('x-obs-security-token=TOKEN');
  });

  it('adds response-* headers and x-image-process', () => {
    const url = obsSignUrl(OPTIONS, 'exampleobject', {
      response: { 'content-disposition': 'attachment' },
      process: 'image/resize,w_100',
    });
    expect(url).toContain('response-content-disposition=attachment');
    // '/' is preserved by the OBS encoding, ',' is percent-encoded
    expect(url).toContain('x-image-process=image/resize%2Cw_100');
  });

  it('supports a custom method', () => {
    const url = obsSignUrl(OPTIONS, 'exampleobject', { method: 'PUT' });
    expect(url.startsWith('https://')).toBe(true);
  });

  it('defaults to https when secure is unset (OBS serves HTTPS only)', () => {
    const url = obsSignUrl(
      { accessKeyId: 'AKIDEXAMPLE', accessKeySecret: 'SECRETKEY', region: 'cn-north-4', bucket: 'examplebucket' },
      'exampleobject'
    );
    expect(url.startsWith('https://')).toBe(true);
  });
});

describe('obs request', () => {
  afterEach(() => {
    setTransport(getTransport());
  });

  it('defaults to https when secure is unset (OBS serves HTTPS only)', async () => {
    let url = '';
    setTransport(async (u: string) => {
      url = u;
      return { data: '', headers: {}, status: 200, statusText: 'OK' };
    });
    await request(
      { accessKeyId: 'AKIDEXAMPLE', accessKeySecret: 'SECRETKEY', region: 'cn-north-4', bucket: 'examplebucket' },
      { verb: 'GET', objectName: 'exampleobject' }
    );
    expect(url.startsWith('https://')).toBe(true);
  });

  it('signs with x-obs-date, security token and Authorization header', async () => {
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
    expect(calls.length).toBe(1);
    const { url, opts } = calls[0];
    expect(url).toBe('https://examplebucket.obs.cn-north-4.myhuaweicloud.com/exampleobject');
    expect(opts.headers['x-obs-date']).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    expect(opts.headers.Authorization).toMatch(/^OBS AKIDEXAMPLE:[A-Za-z0-9+/=]+$/);
    expect(opts.method).toBe('PUT');
  });

  it('puts the STS token header and signs it', async () => {
    const calls: any[] = [];
    setTransport(async (url: string, opts: any) => {
      calls.push(opts);
      return { data: '', headers: {}, status: 200, statusText: 'OK' };
    });
    await request({ ...OPTIONS, stsToken: 'TOKEN' }, { verb: 'GET', objectName: 'exampleobject' });
    expect(calls[0].headers['x-obs-security-token']).toBe('TOKEN');
  });

  it('encodes the object key in the URL and sub-resources in the query', async () => {
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
      'https://examplebucket.obs.cn-north-4.myhuaweicloud.com/dir/file%20name.bin?partNumber=1&uploadId=u123'
    );
  });
});

describe('OBS entry point', () => {
  it('put signs with the OBS scheme', async () => {
    const calls: any[] = [];
    setTransport(async (url: string, opts: any) => {
      calls.push(opts);
      return { data: '', headers: {}, status: 200, statusText: 'OK' };
    });
    await put(OPTIONS, 'exampleobject', new Blob(['hello'], { type: 'text/plain' }));
    expect(calls[0].headers.Authorization).toMatch(/^OBS AKIDEXAMPLE:/);
    expect(calls[0].headers['Content-Md5']).toBeTruthy();
    expect(calls[0].headers['Content-Type']).toBe('text/plain');
  });

  it('does not export putSymlink', async () => {
    const mod = await import('../src/obs/index');
    expect((mod as any).putSymlink).toBeUndefined();
  });
});
