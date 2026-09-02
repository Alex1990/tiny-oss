import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveCosHost } from '../src/cos/host';
import { cosSignUrl } from '../src/cos/signatureUrl';
import { request as cosRequest } from '../src/cos/request';
import { createPutSymlink } from '../src/ops/putSymlink';
import { createMultipartUpload } from '../src/ops/multipartUpload';
import { setTransport, getTransport } from '../src/transport';
import * as cosEntry from '../src/cos/index';
import type { Protocol } from '../src/protocol';
import type { Transport } from '../src/transport';

const COS_OPTIONS = {
  accessKeyId: 'AKIDtest123',
  accessKeySecret: 'secret123',
  region: 'ap-guangzhou',
  bucket: 'examplebucket-1250000000',
  secure: true,
};

const savedTransport = getTransport();
afterEach(() => {
  setTransport(savedTransport);
});

describe('resolveCosHost', () => {
  it('builds bucket.cos.region.myqcloud.com', () => {
    expect(resolveCosHost(COS_OPTIONS)).toBe('examplebucket-1250000000.cos.ap-guangzhou.myqcloud.com');
  });

  it('lets an explicit endpoint win', () => {
    expect(resolveCosHost({ ...COS_OPTIONS, endpoint: 'cdn.example.com' })).toBe('cdn.example.com');
  });

  it('throws when neither region nor endpoint is set', () => {
    expect(() => resolveCosHost({ bucket: 'examplebucket-1250000000' })).toThrow(/region/);
  });
});

describe('cosSignUrl', () => {
  it('emits the q-* parameter signature with encoded key time', () => {
    const url = cosSignUrl(COS_OPTIONS, 'dir/a.txt', { expires: 100 });
    expect(url.startsWith('https://examplebucket-1250000000.cos.ap-guangzhou.myqcloud.com/dir/a.txt?')).toBe(true);
    expect(url).toContain('q-sign-algorithm=sha1');
    expect(url).toContain('q-ak=AKIDtest123');
    expect(url).toContain('q-sign-time=');
    // The ';' inside q-sign-time must be URL-encoded to keep the link parseable.
    expect(url).toContain('%3B');
    expect(url).toContain('q-header-list=host');
    expect(url).toContain('q-signature=');
  });

  it('signs response-* parameters that appear in the URL', () => {
    const url = cosSignUrl(COS_OPTIONS, 'a.txt', {
      response: { 'content-type': 'text/plain', 'content-disposition': 'attachment' },
    });
    expect(url).toContain('response-content-type=text%2Fplain');
    expect(url).toContain('response-content-disposition=attachment');
    // Semicolons in q-url-param-list are URL-encoded in the link.
    expect(url).toContain('q-url-param-list=response-content-disposition%3Bresponse-content-type');
  });

  it('appends the security token for temporary credentials', () => {
    const url = cosSignUrl({ ...COS_OPTIONS, stsToken: 'tok123' }, 'a.txt');
    expect(url).toContain('&x-cos-security-token=tok123');
  });

  it('honors secure:false with an http scheme', () => {
    const url = cosSignUrl({ ...COS_OPTIONS, secure: false }, 'a.txt');
    expect(url.startsWith('http://')).toBe(true);
  });

  it('defaults to https when secure is unset', () => {
    const url = cosSignUrl(
      { accessKeyId: 'AKIDtest123', accessKeySecret: 'secret123', region: 'ap-guangzhou', bucket: 'examplebucket-1250000000' },
      'a.txt'
    );
    expect(url.startsWith('https://')).toBe(true);
  });
});

describe('COS request', () => {
  it('signs host/date/token and passes the q-* Authorization through the transport', async () => {
    const calls: { url: string; opts: { method: string; headers: Record<string, string> } }[] = [];
    const mock: Transport = (url, opts) => {
      calls.push({ url, opts: { method: opts.method, headers: opts.headers } });
      return Promise.resolve({ data: '<Result/>', headers: {}, status: 200, statusText: 'OK' });
    };
    setTransport(mock);

    await cosRequest(
      { ...COS_OPTIONS, stsToken: 'tok123' },
      { verb: 'PUT', objectName: 'dir/obj.txt', subResource: { uploadId: 'u1', partNumber: '1' } }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://examplebucket-1250000000.cos.ap-guangzhou.myqcloud.com/dir/obj.txt?uploadId=u1&partNumber=1'
    );
    const headers = calls[0].opts.headers;
    expect(headers.Host).toBe('examplebucket-1250000000.cos.ap-guangzhou.myqcloud.com');
    expect(headers.Date).toBeTruthy();
    expect(headers['x-cos-security-token']).toBe('tok123');
    expect(headers.Authorization).toMatch(/^q-sign-algorithm=sha1&q-ak=AKIDtest123&q-sign-time=/);
    // uploadId and partNumber participate in the signature.
    expect(headers.Authorization).toContain('q-url-param-list=partnumber;uploadid');
  });

  it('sends empty objectName as the bucket root path', async () => {
    const calls: { url: string }[] = [];
    setTransport((url) => {
      calls.push({ url });
      return Promise.resolve({ data: '<Result/>', headers: {}, status: 200, statusText: 'OK' });
    });
    await cosRequest(COS_OPTIONS, { verb: 'GET', objectName: '', subResource: { uploads: '' } });
    expect(calls[0].url).toBe('https://examplebucket-1250000000.cos.ap-guangzhou.myqcloud.com/?uploads');
  });

  it('requests default to https when secure is unset', async () => {
    let url = '';
    setTransport(async (u: string) => {
      url = u;
      return { data: '<Result/>', headers: {}, status: 200, statusText: 'OK' };
    });
    await cosRequest(
      { accessKeyId: 'AKIDtest123', accessKeySecret: 'secret123', region: 'ap-guangzhou', bucket: 'examplebucket-1250000000' },
      { verb: 'GET', objectName: 'a.txt' }
    );
    expect(url.startsWith('https://')).toBe(true);
  });
});

describe('mini program environment (no Blob global)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('put accepts an ArrayBuffer and sizes it without touching Blob', async () => {
    vi.stubGlobal('Blob', undefined);
    const calls: { url: string; opts: { method: string; headers: Record<string, string>; data?: unknown; total?: number } }[] = [];
    setTransport(async (url: string, opts) => {
      calls.push({ url, opts: { method: opts.method, headers: opts.headers, data: opts.data, total: opts.total } });
      return { data: '<Result/>', headers: {}, status: 200, statusText: 'OK' };
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await cosEntry.put(COS_OPTIONS, 'mini.bin', bytes.buffer as ArrayBuffer);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.total).toBe(4);
    expect(calls[0].opts.data).toBe(bytes.buffer);
    expect(calls[0].opts.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('uploadPart accepts an ArrayBuffer without touching Blob', async () => {
    vi.stubGlobal('Blob', undefined);
    const calls: { url: string; opts: { method: string; headers: Record<string, string>; data?: unknown; total?: number } }[] = [];
    setTransport(async (url: string, opts) => {
      calls.push({ url, opts: { method: opts.method, headers: opts.headers, data: opts.data, total: opts.total } });
      return { data: '<Result/>', headers: {}, status: 200, statusText: 'OK' };
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await cosEntry.uploadPart(COS_OPTIONS, 'mini.bin', 'uploadId-1', 1, bytes.buffer as ArrayBuffer, 0, 4);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('multipartUpload sizes byte input without touching Blob', async () => {
    vi.stubGlobal('Blob', undefined);
    let initCalls = 0;
    const multipartUpload = createMultipartUpload(
      { metaPrefix: 'x-cos-meta-' } as Protocol,
      {
        initMultipartUpload: async () => {
          initCalls++;
          return { name: 'x', uploadId: 'u1' };
        },
        uploadPart: async () => ({ name: 'x', etag: '"e"' }),
        completeMultipartUpload: async () => ({ name: 'x', etag: '"E"', bucket: 'b' }),
      }
    );
    const file = new Uint8Array(200 * 1024);
    await multipartUpload(COS_OPTIONS, 'mini.bin', file, { partSize: 100 * 1024 });
    expect(initCalls).toBe(1);
  });
});

describe('putSymlink against the COS protocol', () => {
  it('rejects because COS has no symlink API', async () => {
    const cosProtocol: Protocol = {
      request: cosRequest,
      metaPrefix: 'x-cos-meta-',
      copySourceHeader: 'x-cos-copy-source',
      copySourceRangeHeader: 'x-cos-copy-source-range',
      listUploadsMarkerKey: 'key-marker',
      supportsSymlink: false,
      signUrl: cosSignUrl,
    };
    const putSymlink = createPutSymlink(cosProtocol);
    await expect(putSymlink(COS_OPTIONS, 'link', 'target')).rejects.toThrow(/does not support symlink/);
  });
});

describe('multipartUpload with the COS protocol', () => {
  it('uses x-cos-meta-* headers for metadata', async () => {
    let initHeaders: Record<string, any> | undefined;
    const multipartUpload = createMultipartUpload(
      {
        metaPrefix: 'x-cos-meta-',
      } as Protocol,
      {
        initMultipartUpload: async (options, name, opts) => {
          initHeaders = opts!.headers;
          return { name, uploadId: 'u1' };
        },
        uploadPart: async () => ({ name: 'x', etag: '"e"' }),
        completeMultipartUpload: async () => ({ name: 'x', etag: '"E"', bucket: 'b' }),
      }
    );

    // 2 parts at the 100KB minimum part size.
    const file = new Uint8Array(200 * 1024);
    await multipartUpload(COS_OPTIONS, 'f.bin', file, {
      partSize: 100 * 1024,
      meta: { author: 'me', 'custom-key': 'v' },
    });

    expect(initHeaders).toBeDefined();
    expect(initHeaders!['x-cos-meta-author']).toBe('me');
    expect(initHeaders!['x-cos-meta-custom-key']).toBe('v');
  });
});

describe('COS entry point', () => {
  it('exports the full API except putSymlink', () => {
    for (const fn of [
      'put',
      'initMultipartUpload',
      'uploadPart',
      'completeMultipartUpload',
      'abortMultipartUpload',
      'listParts',
      'listUploads',
      'uploadPartCopy',
      'multipartUpload',
      'signatureUrl',
      'bindOptions',
      'setTransport',
      'getTransport',
      'fetchTransport',
      'wxRequestTransport',
    ]) {
      expect(typeof (cosEntry as any)[fn]).toBe('function');
    }
    expect((cosEntry as any).putSymlink).toBeUndefined();
  });
});
