// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { setTransport, getTransport } from '../src/transport'
import type { Transport, TransportOptions } from '../src/transport'
import {
  put as ossPut,
  multipartUpload as ossMultipartUpload,
  signatureUrl as ossSignUrl,
} from '../src/index'
import { put as cosPut, multipartUpload as cosMultipartUpload } from '../src/cos/index'
import { put as obsPut } from '../src/obs/index'
import { put as awsPut } from '../src/aws/index'
import type { SignatureUrlOptions } from '../src/types'

const savedTransport = getTransport()
afterEach(() => {
  setTransport(savedTransport)
})

const OSS_OPTIONS = {
  accessKeyId: 'test-ak',
  accessKeySecret: 'test-sk',
  bucket: 'test-bucket',
  region: 'oss-cn-hangzhou',
}
const COS_OPTIONS = {
  accessKeyId: 'AKIDtest123',
  accessKeySecret: 'secret123',
  region: 'ap-guangzhou',
  bucket: 'examplebucket-1250000000',
}
const OBS_OPTIONS = {
  accessKeyId: 'test-ak',
  accessKeySecret: 'test-sk',
  bucket: 'test-bucket',
  region: 'cn-north-4',
}
const AWS_OPTIONS = {
  accessKeyId: 'AKIDtest123',
  accessKeySecret: 'secret123',
  region: 'us-east-1',
  bucket: 'bucket',
}

function decodeB64Json(value: string): Record<string, string> {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

function captureCalls(): { url: string; opts: TransportOptions }[] {
  const calls: { url: string; opts: TransportOptions }[] = []
  const fake: Transport = async (url, opts) => {
    calls.push({ url, opts })
    return { data: '', headers: {}, status: 200, statusText: 'OK' }
  }
  setTransport(fake)
  return calls
}

// Init → part PUTs → complete POST, with per-stage responses like the real
// providers. Shared by every multipartUpload test below.
function mockMultipartTransport(calls: { url: string; opts: TransportOptions }[]): void {
  const fake: Transport = async (url, opts) => {
    calls.push({ url, opts })
    if (url.indexOf('?uploads') > -1) {
      return {
        data: '<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>',
        headers: {},
        status: 200,
        statusText: 'OK',
      }
    }
    if (opts.method === 'PUT') {
      return { data: '', headers: { etag: '"mock-etag"' }, status: 200, statusText: 'OK' }
    }
    return {
      data: '<CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>',
      headers: {},
      status: 200,
      statusText: 'OK',
    }
  }
  setTransport(fake)
}

function findComplete(calls: { url: string; opts: TransportOptions }[]) {
  return calls.find((c) => c.opts.method === 'POST' && c.url.indexOf('uploadId=') > -1)
}

describe('upload callback (Aliyun OSS)', () => {
  it('serializes callback and custom values into x-oss-callback headers on put', async () => {
    const calls = captureCalls()
    await ossPut(OSS_OPTIONS, 'a.txt', 'hello', {
      callback: {
        url: 'https://example.com/回调?a=1&b=2',
        host: 'example.com',
        body: 'key=$(key)&etag=$(etag)&user=$(x:userId)',
        contentType: 'application/x-www-form-urlencoded',
        customValue: { userId: 42, role: 'admin' },
      },
    })
    const headers = calls[0].opts.headers
    expect(headers['x-oss-callback']).toBeDefined()
    // x-oss-callback: base64 JSON with the URL encodeURI'd, ali-oss style
    expect(decodeB64Json(headers['x-oss-callback'])).toEqual({
      callbackUrl: 'https://example.com/%E5%9B%9E%E8%B0%83?a=1&b=2',
      callbackBody: 'key=$(key)&etag=$(etag)&user=$(x:userId)',
      callbackHost: 'example.com',
      callbackBodyType: 'application/x-www-form-urlencoded',
    })
    // x-oss-callback-var: base64 JSON of x:-prefixed custom values
    expect(decodeB64Json(headers['x-oss-callback-var'])).toEqual({
      'x:userId': '42',
      'x:role': 'admin',
    })
  })

  it('skips serialization wholesale when the user sets a callback header on put', async () => {
    const calls = captureCalls()
    await ossPut(OSS_OPTIONS, 'a.txt', 'hello', {
      headers: { 'x-oss-callback': 'user-header' },
      callback: {
        url: 'https://example.com/cb',
        body: 'k=$(key)',
        customValue: { uid: '7' },
      },
    })
    expect(calls[0].opts.headers['x-oss-callback']).toBe('user-header')
    expect(calls[0].opts.headers['x-oss-callback-var']).toBeUndefined()
  })

  it('omits optional fields when not given', async () => {
    const calls = captureCalls()
    await ossPut(OSS_OPTIONS, 'a.txt', 'hello', {
      callback: { url: 'https://example.com/cb', body: 'k=$(key)' },
    })
    expect(decodeB64Json(calls[0].opts.headers['x-oss-callback'])).toEqual({
      callbackUrl: 'https://example.com/cb',
      callbackBody: 'k=$(key)',
    })
    expect(calls[0].opts.headers['x-oss-callback-var']).toBeUndefined()
  })

  it('fires the callback on the complete request of multipartUpload', async () => {
    const calls: { url: string; opts: TransportOptions }[] = []
    mockMultipartTransport(calls)

    const blob = new Blob([new Uint8Array(1024 * 1024)])
    const result = await ossMultipartUpload(OSS_OPTIONS, 'big.bin', blob, {
      callback: { url: 'https://example.com/cb', body: 'k=$(key)' },
    })
    expect(result.etag).toBe('"done"')
    const complete = findComplete(calls)
    expect(complete).toBeDefined()
    expect(decodeB64Json(complete!.opts.headers['x-oss-callback'])).toEqual({
      callbackUrl: 'https://example.com/cb',
      callbackBody: 'k=$(key)',
    })
  })

  it('skips serialization on the multipart complete when the user set the header', async () => {
    const calls: { url: string; opts: TransportOptions }[] = []
    mockMultipartTransport(calls)

    const blob = new Blob([new Uint8Array(1024 * 1024)])
    await ossMultipartUpload(OSS_OPTIONS, 'big.bin', blob, {
      headers: { 'x-oss-callback': 'user-header' },
      callback: { url: 'https://example.com/cb', body: 'k=$(key)', customValue: { uid: '7' } },
    })
    const complete = findComplete(calls)
    expect(complete).toBeDefined()
    expect(complete!.opts.headers['x-oss-callback']).toBe('user-header')
    expect(complete!.opts.headers['x-oss-callback-var']).toBeUndefined()
  })

  it('ignores a stray callback key on signed URLs', () => {
    const url = ossSignUrl(OSS_OPTIONS, 'a.txt', {
      callback: { url: 'https://example.com/cb', body: 'k=$(key)' },
    } as unknown as SignatureUrlOptions)
    expect(url).not.toContain('callback')
    expect(url).not.toContain('[object')
  })
})

describe('upload callback (Huawei OBS)', () => {
  it('serializes callback into an x-obs-callback header on put', async () => {
    const calls = captureCalls()
    await obsPut(OBS_OPTIONS, 'a.txt', 'hello', {
      callback: {
        url: 'https://example.com/cb',
        host: 'callback.example.com',
        body: 'k=$(key)',
        contentType: 'application/json',
      },
    })
    // x-obs-callback: base64 JSON with lower-case-first keys, esdk style
    expect(decodeB64Json(calls[0].opts.headers['x-obs-callback'])).toEqual({
      callbackUrl: 'https://example.com/cb',
      callbackBody: 'k=$(key)',
      callbackHost: 'callback.example.com',
      callbackBodyType: 'application/json',
    })
    expect(calls[0].opts.headers['x-oss-callback']).toBeUndefined()
  })
})

describe('upload callback (Tencent COS via headers)', () => {
  it('carries user headers on the complete request of multipartUpload', async () => {
    const calls: { url: string; opts: TransportOptions }[] = []
    mockMultipartTransport(calls)

    const blob = new Blob([new Uint8Array(1024 * 1024)])
    await cosMultipartUpload(COS_OPTIONS, 'big.bin', blob, {
      headers: { 'x-cos-callback': 'raw-cos-callback' },
    })
    const complete = findComplete(calls)
    expect(complete).toBeDefined()
    expect(complete!.opts.headers['x-cos-callback']).toBe('raw-cos-callback')
  })
})

describe('upload callback (unsupported providers)', () => {
  it('rejects on COS with a clear error', async () => {
    await expect(
      cosPut(COS_OPTIONS, 'a.txt', 'hello', {
        callback: { url: 'https://example.com/cb', body: 'k=$(key)' },
      }),
    ).rejects.toThrow(/upload callback is not supported/)
  })

  it('rejects on AWS S3 with a clear error', async () => {
    await expect(
      awsPut(AWS_OPTIONS, 'a.txt', 'hello', {
        callback: { url: 'https://example.com/cb', body: 'k=$(key)' },
      }),
    ).rejects.toThrow(/upload callback is not supported/)
  })

  it('keeps working without a callback on unsupported providers', async () => {
    const calls = captureCalls()
    await cosPut(COS_OPTIONS, 'a.txt', 'hello')
    expect(calls[0].opts.headers['x-cos-callback']).toBeUndefined()
  })
})
