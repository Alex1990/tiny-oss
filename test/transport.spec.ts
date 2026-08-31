import { describe, it, expect, vi, afterEach } from 'vitest';
import { setTransport, getTransport } from '../src/transport';
import type { Transport, TransportOptions } from '../src/transport';
import { request } from '../src/ops/request';
import { put } from '../src/index';

const options = {
  accessKeyId: 'ak',
  accessKeySecret: 'sk',
  bucket: 'test-bucket',
  region: 'oss-cn-hangzhou',
};

const defaultTransport = getTransport();

afterEach(() => {
  setTransport(defaultTransport);
});

describe('transport', () => {
  it('should route requests through the injected transport', async () => {
    const spy = vi.fn(async (_url: string) => ({
      data: '<Result><ETag>"abc"</ETag></Result>',
      headers: {},
      status: 200,
      statusText: 'OK',
    })) as unknown as Transport;
    setTransport(spy);

    const res = await request(options, { verb: 'PUT', objectName: 'a.txt' });
    expect(res.data).toContain('ETag');
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, transportOptions] = spy.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; total?: number },
    ];
    expect(url).toBe('http://test-bucket.oss-cn-hangzhou.aliyuncs.com/a.txt');
    expect(transportOptions.method).toBe('PUT');
    expect(transportOptions.headers.Authorization).toContain('OSS ak:');
  });

  it('should forward progress events in the normalized shape', async () => {
    // Simulate an adapter without native progress (fetch/wx.request):
    // fires 0% before sending and 100% after.
    const fakeTransport = (async (url: string, tOpts: TransportOptions) => {
      if (tOpts.onprogress) {
        tOpts.onprogress({ loaded: 0, total: tOpts.total, lengthComputable: false });
        tOpts.onprogress({ loaded: tOpts.total, total: tOpts.total, lengthComputable: false });
      }
      return { data: '', headers: {}, status: 200, statusText: 'OK' };
    }) as Transport;
    setTransport(fakeTransport);

    const events: { loaded: number; total: number; lengthComputable: boolean }[] = [];
    await put(options, 'a.txt', 'hello', {
      onprogress: (e) => events.push(e),
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ loaded: 0, total: 5, lengthComputable: false });
    expect(events[1]).toEqual({ loaded: 5, total: 5, lengthComputable: false });
  });

  it('should report the payload total for byte inputs', async () => {
    const spy = vi.fn(async () => ({ data: '', headers: {}, status: 200, statusText: 'OK' })) as unknown as Transport;
    setTransport(spy);

    await request(options, { verb: 'PUT', objectName: 'a.bin', data: new Uint8Array([1, 2, 3]) });
    const transportOptions = spy.mock.calls[0][1] as { total?: number };
    expect(transportOptions.total).toBe(3);
  });
});
