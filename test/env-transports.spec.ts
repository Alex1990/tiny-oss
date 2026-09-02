import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTransport } from '../src/transports/fetch';
import { wxRequestTransport } from '../src/transports/wx';

const globals = globalThis as unknown as { wx?: { request: (opts: unknown) => void } };

afterEach(() => {
  delete globals.wx;
  vi.unstubAllGlobals();
});

describe('wxRequestTransport', () => {
  it('should reject outside the mini program runtime', async () => {
    await expect(
      wxRequestTransport('http://example.com', { method: 'GET', headers: {} })
    ).rejects.toThrow(/WeChat mini program runtime/);
  });

  it('should delegate to wx.request with signed headers and buffer data', async () => {
    const calls: unknown[] = [];
    globals.wx = {
      request: (opts) => {
        calls.push(opts);
        const o = opts as { success: (res: unknown) => void };
        o.success({ data: '<Result><ETag>"x"</ETag></Result>', header: { etag: '"x"' }, statusCode: 200 });
      },
    };

    const progress: { loaded: number; total: number; lengthComputable: boolean }[] = [];
    const res = await wxRequestTransport('http://example.com/a.bin', {
      method: 'PUT',
      headers: { Authorization: 'OSS ak:xx' },
      data: new Uint8Array([1, 2, 3]),
      total: 3,
      onprogress: (e) => progress.push(e),
    });

    const call = calls[0] as {
      url: string;
      method: string;
      header: Record<string, string>;
      data: ArrayBuffer | string;
    };
    expect(call.url).toBe('http://example.com/a.bin');
    expect(call.method).toBe('PUT');
    expect(call.header.Authorization).toBe('OSS ak:xx');
    expect(new Uint8Array(call.data as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(res.data).toContain('ETag');
    expect(res.status).toBe(200);
    // Synthetic progress: 0% then 100%, not computable.
    expect(progress).toEqual([
      { loaded: 0, total: 3, lengthComputable: false },
      { loaded: 3, total: 3, lengthComputable: false },
    ]);
  });

  it('should reject on wx.request failure', async () => {
    globals.wx = {
      request: (opts) => {
        const o = opts as { fail: (err: unknown) => void };
        o.fail(new Error('network down'));
      },
    };
    await expect(
      wxRequestTransport('http://example.com', { method: 'GET', headers: {} })
    ).rejects.toThrow('network down');
  });

  it('reduces a foreign-realm Uint8Array to its buffer', async () => {
    // Separate realm via iframe (browser runtimes); skip where unavailable.
    if (typeof document === 'undefined' || !document.body) return;
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    document.body.appendChild(frame);
    const win = frame.contentWindow!;
    frame.remove();
    const foreign = new win.Uint8Array([7, 8, 9]);
    expect(foreign instanceof Uint8Array).toBe(false); // cross-realm premise

    const calls: unknown[] = [];
    globals.wx = {
      request: (opts) => {
        calls.push(opts);
        const o = opts as { success: (res: unknown) => void };
        o.success({ data: '', header: {}, statusCode: 200 });
      },
    };
    await wxRequestTransport('http://example.com/f.bin', {
      method: 'PUT',
      headers: {},
      data: foreign,
    });
    const call = calls[0] as { data: ArrayBuffer | string };
    expect(new Uint8Array(call.data as ArrayBuffer)).toEqual(new Uint8Array([7, 8, 9]));
  });
});

describe('fetchTransport', () => {
  it('should resolve with text and headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Result>ok</Result>', {
      status: 200,
      headers: { etag: '"x"' },
    })));
    const res = await fetchTransport('http://example.com', { method: 'GET', headers: {} });
    expect(res.data).toBe('<Result>ok</Result>');
    expect(res.headers.etag).toBe('"x"');
    expect(res.status).toBe(200);
  });

  it('should reject on non-2xx with the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error>denied</Error>', { status: 403, statusText: 'Forbidden' })));
    await expect(
      fetchTransport('http://example.com', { method: 'GET', headers: {} })
    ).rejects.toThrow(/403 Forbidden <Error>denied<\/Error>/);
  });

  it('should fire synthetic 0%/100% progress', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const progress: { loaded: number; total: number; lengthComputable: boolean }[] = [];
    await fetchTransport('http://example.com', {
      method: 'PUT',
      headers: {},
      data: new Uint8Array([1, 2, 3]),
      total: 3,
      onprogress: (e) => progress.push(e),
    });
    expect(progress).toEqual([
      { loaded: 0, total: 3, lengthComputable: false },
      { loaded: 3, total: 3, lengthComputable: false },
    ]);
  });

  it('should enforce the timeout via abort', async () => {
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
    }));
    await expect(
      fetchTransport('http://example.com', { method: 'GET', headers: {}, timeout: 10 })
    ).rejects.toThrow('aborted');
    expect(aborted).toBe(true);
  });
});
