import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createPut,
  createInitMultipartUpload,
  createUploadPart,
  createCompleteMultipartUpload,
  createMultipartUpload,
  createAbortMultipartUpload,
  createListUploads,
  bindOptions,
  type Protocol,
} from '../src/provider'
import { setTransport, getTransport } from '../src/transport'

/**
 * A fake "ACME" object storage provider built only from the public
 * protocol layer — proves third parties can wire a new provider without
 * touching the library.
 */
const ACME_PROTOCOL: Protocol = {
  request: (options, params) => {
    // ACME signs with a toy HMAC header: `ACME ak:hex(sha1(verb+object))`
    // and sends the request through the configured transport.
    const { accessKeyId, accessKeySecret, secure } = options
    const objectName = params.objectName
    let hash = 0x811c9dc5
    const text = `${params.verb}:${objectName}:${accessKeySecret}`
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    const signature = (hash >>> 0).toString(16).padStart(8, '0')
    const host = `${options.bucket}.acme.example.com`
    let url = `${secure ? 'https' : 'http'}://${host}/${objectName}`
    if (params.subResource) {
      const qs = Object.keys(params.subResource)
        .map((key) => {
          const value = params.subResource![key]
          return value === '' || value == null ? key : `${key}=${encodeURIComponent(value)}`
        })
        .join('&')
      if (qs) url += `?${qs}`
    }
    const headers: Record<string, any> = {
      'x-acme-date': new Date().toUTCString(),
      Authorization: `ACME ${accessKeyId}:${signature}`,
      ...params.headers,
    }
    return getTransport()(url, {
      method: params.verb,
      headers,
      data: params.data,
      timeout: params.timeout,
    })
  },
  metaPrefix: 'x-acme-meta-',
  copySourceHeader: 'x-acme-copy-source',
  copySourceRangeHeader: 'x-acme-copy-source-range',
  listUploadsMarkerKey: 'marker',
  supportsSymlink: false,
  signUrl: (_options, objectName) => `https://acme.example.com/${objectName}?sig=toy`,
}

const OPTIONS = {
  accessKeyId: 'ak1',
  accessKeySecret: 'sk1',
  region: 'acme-1',
  bucket: 'bucket',
  secure: true,
}

function mockTransport() {
  const calls: any[] = []
  setTransport(async (url: string, opts: any) => {
    calls.push({ url, opts })
    if (url.indexOf('?uploads') > -1) {
      return {
        data: '<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>',
        headers: {},
        status: 200,
        statusText: 'OK',
      }
    }
    if (opts.method === 'POST' && url.indexOf('?uploadId') > -1) {
      return {
        data: '<CompleteMultipartUploadResult><ETag>"e"</ETag></CompleteMultipartUploadResult>',
        headers: {},
        status: 200,
        statusText: 'OK',
      }
    }
    return { data: '', headers: { etag: '"part"' }, status: 200, statusText: 'OK' }
  })
  return calls
}

describe('protocol layer: third-party provider composition', () => {
  afterEach(() => {
    setTransport(getTransport())
  })

  it('composes put from factories and signs with the custom protocol', async () => {
    const calls = mockTransport()
    const put = createPut(ACME_PROTOCOL)
    await put(OPTIONS, 'hello.txt', new Blob(['hello'], { type: 'text/plain' }))
    const { url, opts } = calls[0]
    expect(url).toBe('https://bucket.acme.example.com/hello.txt')
    expect(opts.headers.Authorization).toMatch(/^ACME ak1:[0-9a-f]{8}$/)
    expect(opts.headers['Content-Md5']).toBeTruthy()
  })

  it('composes multipartUpload end-to-end with injected deps', async () => {
    const calls = mockTransport()
    const init = createInitMultipartUpload(ACME_PROTOCOL)
    const part = createUploadPart(ACME_PROTOCOL)
    const complete = createCompleteMultipartUpload(ACME_PROTOCOL)
    const multipartUpload = createMultipartUpload(ACME_PROTOCOL, {
      initMultipartUpload: init,
      uploadPart: part,
      completeMultipartUpload: complete,
    })
    const result = await multipartUpload(OPTIONS, 'big.bin', new Uint8Array(3 * 1024 * 1024), {
      partSize: 1024 * 1024,
      parallel: 2,
      meta: { title: 't' },
    })
    expect(result.etag).toBeTruthy()
    // 3 parts uploaded concurrently + init + complete
    const puts = calls.filter((c) => c.opts.method === 'PUT')
    expect(puts.length).toBe(3)
    expect(puts[0].opts.headers.Authorization).toMatch(/^ACME ak1:/)
    const initCall = calls.find((c) => c.url.indexOf('?uploads') > -1)
    expect(initCall.opts.headers['x-acme-meta-title']).toBe('t')
  })

  it('bindOptions works with a custom provider put', async () => {
    const calls = mockTransport()
    const put = createPut(ACME_PROTOCOL)
    const upload = bindOptions(put, OPTIONS)
    await upload('b.txt', new Blob(['y']))
    expect(calls[0].url).toBe('https://bucket.acme.example.com/b.txt')
  })

  it('abort and listUploads use the protocol marker key', async () => {
    const calls = mockTransport()
    const abort = createAbortMultipartUpload(ACME_PROTOCOL)
    await abort(OPTIONS, 'big.bin', 'u1')
    expect(calls[0].url).toBe('https://bucket.acme.example.com/big.bin?uploadId=u1')
    expect(calls[0].opts.method).toBe('DELETE')

    const listUploads = createListUploads(ACME_PROTOCOL)
    calls.length = 0
    await listUploads(OPTIONS, { marker: 'm1' })
    // ACME protocol says listUploadsMarkerKey is 'marker'
    expect(calls[0].url).toContain('marker=m1')
  })
})
