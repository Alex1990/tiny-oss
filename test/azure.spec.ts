import { describe, it, expect, vi, afterEach } from 'vitest'
import { fromUint8Array } from 'js-base64'
import { resolveAzureHost } from '../src/azure/host'
import { azureSignUrl } from '../src/azure/signatureUrl'
import {
  getSharedKeyAuthorization,
  getCanonicalizedAzureHeaders,
  getCanonicalizedAzureResource,
} from '../src/azure/signature'
import { request } from '../src/azure/request'
import { setTransport, getTransport } from '../src/transport'
import { put, multipartUpload } from '../src/azure/index'

const ACCOUNT = 'myaccount'
const ACCOUNT_KEY = fromUint8Array(new Uint8Array(32).fill(7))
const OPTIONS = {
  accessKeyId: ACCOUNT,
  accessKeySecret: ACCOUNT_KEY,
  bucket: 'mycontainer',
  secure: true,
}

function truncatedIso(date: Date): string {
  const s = date.toISOString()
  return s.substring(0, s.length - 5) + 'Z'
}

describe('resolveAzureHost', () => {
  it('builds account.blob.core.windows.net', () => {
    expect(resolveAzureHost(OPTIONS)).toBe('myaccount.blob.core.windows.net')
  })

  it('prefers an explicit endpoint', () => {
    expect(resolveAzureHost({ ...OPTIONS, endpoint: '127.0.0.1:10000' })).toBe('127.0.0.1:10000')
  })
})

describe('canonicalized strings (MSDN documentation vector)', () => {
  it('matches the documented Get Blob example', () => {
    const headers = { 'x-ms-date': 'Fri, 26 Jun 2015 23:39:12 GMT', 'x-ms-version': '2015-02-21' }
    expect(getCanonicalizedAzureHeaders(headers)).toBe(
      'x-ms-date:Fri, 26 Jun 2015 23:39:12 GMT\nx-ms-version:2015-02-21\n',
    )
    expect(
      getCanonicalizedAzureResource('myaccount', '/mycontainer', {
        comp: 'metadata',
        restype: 'container',
        timeout: '20',
      }),
    ).toBe('/myaccount/mycontainer\ncomp:metadata\nrestype:container\ntimeout:20')
  })

  it('sorts query parameters lexicographically', () => {
    expect(getCanonicalizedAzureResource('a', '/b', { z: '1', a: '2', m: '3' })).toBe(
      '/a/b\na:2\nm:3\nz:1',
    )
  })

  it('drops query parameters without a value (official SDK rule)', () => {
    expect(getCanonicalizedAzureResource('a', '/b', { comp: '', restype: 'container' })).toBe(
      '/a/b\nrestype:container',
    )
  })

  it('canonicalizes x-ms-* headers only, lower-cased and sorted', () => {
    const headers = { 'x-ms-meta-title': 'T', 'X-Ms-Date': 'D', 'Content-Type': 'ignored' }
    expect(getCanonicalizedAzureHeaders(headers)).toBe('x-ms-date:D\nx-ms-meta-title:T\n')
  })
})

describe('SharedKey authorization (fixed vectors, computed with @azure/storage-common)', () => {
  it('matches the official SDK signature for a Put Blob with meta and query', () => {
    const mine = getSharedKeyAuthorization({
      verb: 'PUT',
      headers: {
        'x-ms-date': 'Tue, 01 Sep 2026 00:00:00 GMT',
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-meta-title': 'T',
        'x-ms-version': '2020-12-06',
      },
      pathname: '/mycontainer/dir/my%20file.txt',
      query: { comp: 'block', blockid: 'MDAwMDE=' },
      account: ACCOUNT,
      accountKey: ACCOUNT_KEY,
      contentMd5: 'abc==',
      contentType: 'text/plain',
      contentLength: 9,
    })
    // Byte-for-byte the output of @azure/storage-common's
    // StorageSharedKeyCredentialPolicy.signRequest for the same input
    // (verified by test/azure-oracle.node.ts).
    expect(mine).toBe('SharedKey myaccount:nO7Er5BGKJId0osRJT6Npa6tEBFNDH7G5OWNynzmQIY=')
  })

  it('matches the official SDK signature for a body-less GET', () => {
    const mine = getSharedKeyAuthorization({
      verb: 'GET',
      headers: { 'x-ms-date': 'Tue, 01 Sep 2026 00:00:00 GMT', 'x-ms-version': '2020-12-06' },
      pathname: '/mycontainer/blob.txt',
      account: ACCOUNT,
      accountKey: ACCOUNT_KEY,
    })
    expect(mine).toBe('SharedKey myaccount:+5P96FOU80smw+GYlf4ootXdMuw3Tykwb2w3eoxDkI8=')
  })
})

describe('azureSignUrl (fixed vectors, computed with @azure/storage-blob)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('matches generateBlobSASQueryParameters for a read URL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    const url = azureSignUrl(OPTIONS, 'dir/file name.txt', { expires: 60 })
    const u = new URL(url)
    expect(u.protocol).toBe('https:')
    expect(u.hostname).toBe('myaccount.blob.core.windows.net')
    expect(u.pathname).toBe('/mycontainer/dir/file%20name.txt')
    expect(u.searchParams.get('sv')).toBe('2020-12-06')
    expect(u.searchParams.get('sr')).toBe('b')
    expect(u.searchParams.get('sp')).toBe('r')
    expect(u.searchParams.get('se')).toBe(truncatedIso(new Date(Date.now() + 60 * 1000)))
    // Byte-for-byte the sig of @azure/storage-blob's
    // generateBlobSASQueryParameters for the same inputs.
    expect(u.searchParams.get('sig')).toBe('0lTyxEm06iNhsNilaobIiRx0l6gcXJDAy1Zp2I8EWgI=')
  })

  it('matches the oracle for a write URL and a UTF-8 blob name', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    const url = azureSignUrl(OPTIONS, '目录/文件.txt', { method: 'PUT', expires: 300 })
    // Assert the raw URL string BEFORE any URL parser runs: WHATWG parsers
    // silently re-encode bare non-ASCII paths, so post-parse pathname
    // checks would stay green if azureEscapePath were removed.
    expect(url).not.toContain('目录')
    expect(url).toContain('/mycontainer/%E7%9B%AE%E5%BD%95/%E6%96%87%E4%BB%B6.txt?')
    const u = new URL(url)
    expect(u.searchParams.get('sp')).toBe('w')
    expect(u.pathname).toBe('/mycontainer/%E7%9B%AE%E5%BD%95/%E6%96%87%E4%BB%B6.txt')
    expect(u.searchParams.get('sig')).toBe('QTALrQ8uI9OtC9VAjUIMC8f4YrnoH0TKhHqVI/7XDjA=')
  })

  it('matches the oracle with response-header overrides', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    const url = azureSignUrl(OPTIONS, 'a.txt', {
      expires: 60,
      response: {
        'cache-control': 'max-age=3600',
        'content-type': 'text/plain',
        'content-disposition': 'attachment',
      },
    })
    const u = new URL(url)
    expect(u.searchParams.get('rscc')).toBe('max-age=3600')
    expect(u.searchParams.get('rsct')).toBe('text/plain')
    expect(u.searchParams.get('rscd')).toBe('attachment')
    expect(u.searchParams.get('sig')).toBe('nSUbKYGo91RZmpwCrBkvvrG4h5oV70erj5lL7dGop9I=')
  })

  it('does not emit a start time (valid immediately)', () => {
    const url = azureSignUrl(OPTIONS, 'a.txt')
    expect(new URL(url).searchParams.has('st')).toBe(false)
  })
})

describe('azure request', () => {
  afterEach(() => {
    setTransport(getTransport())
  })

  it('signs a Put Blob with x-ms-date, x-ms-version and SharedKey', async () => {
    const calls: any[] = []
    setTransport(async (url: string, opts: any) => {
      calls.push({ url, opts })
      return { data: '', headers: {}, status: 200, statusText: 'OK' }
    })
    await request(OPTIONS, {
      verb: 'PUT',
      objectName: 'dir/file name.txt',
      contentMd5: 'abc==',
      headers: { 'Content-Type': 'text/plain' },
      data: new Blob(['hello']),
    })
    const { url, opts } = calls[0]
    expect(url).toBe('https://myaccount.blob.core.windows.net/mycontainer/dir/file%20name.txt')
    expect(opts.headers['x-ms-date']).toMatch(
      /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
    )
    expect(opts.headers['x-ms-version']).toBe('2020-12-06')
    expect(opts.headers['x-ms-blob-type']).toBe('BlockBlob')
    expect(opts.headers.Authorization).toMatch(/^SharedKey myaccount:[A-Za-z0-9+/=]+$/)
  })

  it('puts sub-resources in the query and skips x-ms-blob-type for block ops', async () => {
    const calls: any[] = []
    setTransport(async (url: string, opts: any) => {
      calls.push({ url, opts })
      return { data: '', headers: {}, status: 200, statusText: 'OK' }
    })
    await request(OPTIONS, {
      verb: 'PUT',
      objectName: 'blob.txt',
      subResource: { comp: 'block', blockid: 'MDAwMDE=' },
      data: new Blob(['x']),
    })
    expect(calls[0].url).toBe(
      'https://myaccount.blob.core.windows.net/mycontainer/blob.txt?comp=block&blockid=MDAwMDE%3D',
    )
    expect(calls[0].opts.headers['x-ms-blob-type']).toBeUndefined()
  })
})

describe('azure entry point', () => {
  afterEach(() => {
    setTransport(getTransport())
  })

  it('put sends Content-Md5, Content-Type and the blob type', async () => {
    const calls: any[] = []
    setTransport(async (url: string, opts: any) => {
      calls.push(opts)
      return { data: '', headers: {}, status: 201, statusText: 'Created' }
    })
    await put(OPTIONS, 'example.txt', new Blob(['hello'], { type: 'text/plain' }))
    expect(calls[0].headers['Content-Md5']).toBeTruthy()
    expect(calls[0].headers['Content-Type']).toBe('text/plain')
    expect(calls[0].headers['x-ms-blob-type']).toBe('BlockBlob')
    expect(calls[0].headers.Authorization).toMatch(/^SharedKey /)
  })

  it('multipartUpload runs Put Block x3 then Put Block List with the right block ids', async () => {
    const calls: Array<{ url: string; opts: any }> = []
    setTransport(async (url: string, opts: any) => {
      calls.push({ url, opts })
      return { data: '', headers: { etag: '"e"' }, status: 201, statusText: 'Created' }
    })
    const result = await multipartUpload(OPTIONS, 'big.bin', new Uint8Array(300000), {
      partSize: 100 * 1024,
      parallel: 2,
    })
    expect(result.etag).toBe('"e"')
    const blocks = calls.filter((c) => c.url.indexOf('comp=block&') > -1)
    const lists = calls.filter((c) => c.url.indexOf('comp=blocklist') > -1)
    expect(blocks.length).toBe(3)
    expect(lists.length).toBe(1)
    expect(blocks[0].url).toContain('blockid=MDAwMDE%3D')
    expect(blocks[1].url).toContain('blockid=MDAwMDI%3D')
    expect(blocks[2].url).toContain('blockid=MDAwMDM%3D')
    expect(blocks[0].opts.headers['x-ms-blob-type']).toBeUndefined()
    const xml = lists[0].opts.data
    expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>')
    expect(xml).toContain('<BlockList>')
    expect(xml).toContain('<Latest>MDAwMDE=</Latest>')
    expect(xml).toContain('<Latest>MDAwMDM=</Latest>')
    // Block ids appear in part-number order in the final XML.
    expect(xml.indexOf('MDAwMDE=')).toBeLessThan(xml.indexOf('MDAwMDI='))
    expect(xml.indexOf('MDAwMDI=')).toBeLessThan(xml.indexOf('MDAwMDM='))
  })

  it('multipartUpload meta uses the x-ms-meta- prefix on the final Put Block List', async () => {
    const calls: Array<{ url: string; opts: any }> = []
    setTransport(async (url: string, opts: any) => {
      calls.push({ url, opts })
      return { data: '', headers: { etag: '"e"' }, status: 201, statusText: 'Created' }
    })
    await multipartUpload(OPTIONS, 'k', new Uint8Array(150000), {
      partSize: 100 * 1024,
      meta: { title: 't' },
    })
    const blockList = calls.find((c) => c.url.indexOf('comp=blocklist') > -1)
    // Azure applies blob metadata on the Put Block List request.
    expect(blockList!.opts.headers['x-ms-meta-title']).toBe('t')
  })

  it('does not export putSymlink, abortMultipartUpload, listParts, listUploads or uploadPartCopy', async () => {
    const mod = await import('../src/azure/index')
    expect((mod as any).putSymlink).toBeUndefined()
    expect((mod as any).abortMultipartUpload).toBeUndefined()
    expect((mod as any).listParts).toBeUndefined()
    expect((mod as any).listUploads).toBeUndefined()
    expect((mod as any).uploadPartCopy).toBeUndefined()
  })
})
