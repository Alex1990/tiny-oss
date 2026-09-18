import { describe, it, expect, afterEach } from 'vitest'
import { put, putSymlink, multipartUpload, uploadPartCopy, type Options } from '../src/tos/index'
import { setTransport, getTransport } from '../src/transport'

const OPTIONS: Options = {
  accessKeyId: 'AKIDEXAMPLE',
  accessKeySecret: 'SECRETKEY',
  region: 'cn-beijing',
  bucket: 'examplebucket',
  secure: true,
}

function capture() {
  const calls: Array<{ url: string; options: any }> = []
  setTransport(async (url, options) => {
    calls.push({ url, options })
    return { data: '', headers: {}, status: 200, statusText: 'OK' }
  })
  return calls
}

afterEach(() => {
  setTransport(getTransport())
})

describe('TOS entry point', () => {
  it('put signs with the TOS4 scheme and sends Content-Md5/Content-Type', async () => {
    const calls = capture()
    await put(OPTIONS, 'dir/exampleobject.txt', new Blob(['hello'], { type: 'text/plain' }))
    const { url, options } = calls[0]
    expect(url).toBe(`https://examplebucket.tos-cn-beijing.volces.com/dir/exampleobject.txt`)
    expect(options.headers.authorization).toMatch(/^TOS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(options.headers['content-md5']).toBeTruthy()
    expect(options.headers['content-type']).toBe('text/plain')
  })

  it('putSymlink sends x-tos-symlink-target and ?symlink', async () => {
    const calls = capture()
    await putSymlink(OPTIONS, 'link.txt', 'dir/target.txt')
    expect(calls[0].url).toBe('https://examplebucket.tos-cn-beijing.volces.com/link.txt?symlink=')
    expect(calls[0].options.headers['x-tos-symlink-target']).toBe('dir/target.txt')
    expect(calls[0].options.headers.authorization).toContain('x-tos-symlink-target')
  })

  it('uploadPartCopy sends the TOS copy-source headers', async () => {
    const calls = capture()
    await uploadPartCopy(OPTIONS, 'bigfile.bin', 'u1', 2, 'bytes=0-1023', {
      sourceKey: 'dir/source.bin',
    })
    expect(calls[0].url).toBe(
      'https://examplebucket.tos-cn-beijing.volces.com/bigfile.bin?partNumber=2&uploadId=u1',
    )
    expect(calls[0].options.headers['x-tos-copy-source']).toBe('/examplebucket/dir%2Fsource.bin')
    expect(calls[0].options.headers['x-tos-copy-source-range']).toBe('bytes=0-1023')
  })

  it('multipartUpload drives init/upload/complete through the TOS protocol', async () => {
    const calls: Array<{ url: string; options: any }> = []
    setTransport(async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'POST' && url.includes('uploads=')) {
        return {
          data: '<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>',
          headers: {},
          status: 200,
          statusText: 'OK',
        }
      }
      if (options.method === 'POST' && url.includes('uploadId=u1')) {
        return {
          data: '<CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>',
          headers: {},
          status: 200,
          statusText: 'OK',
        }
      }
      return { data: '', headers: { etag: '"part1"' }, status: 200, statusText: 'OK' }
    })
    const result = await multipartUpload(OPTIONS, 'bigfile.bin', new Blob(['hello']))
    expect(result.name).toBe('bigfile.bin')
    expect(result.etag).toBe('"done"')
    const uploads = calls.filter((c) => c.options.method === 'POST' && c.url.includes('uploads='))
    const parts = calls.filter((c) => c.options.method === 'PUT')
    expect(uploads.length).toBe(1)
    expect(parts.length).toBeGreaterThanOrEqual(1)
    expect(parts[0].url).toContain('partNumber=1&uploadId=u1')
  })

  it('exports putSymlink (TOS has a symlink API)', async () => {
    const mod = await import('../src/tos/index')
    expect(typeof mod.putSymlink).toBe('function')
  })
})
