import { describe, it, expect } from 'vitest'
import { getCosAuth, camSafeUrlEncode } from '../src/cos/signature'
// Official Tencent COS SDK used as an oracle: our signer must produce
// byte-identical Authorization values for the same inputs.
import COS from 'cos-js-sdk-v5'

const SECRET_ID = 'AKIDtest123'
const SECRET_KEY = 'secret123'
const KEY_TIME = '1557989151;1557996351'
const HOST = 'examplebucket-1250000000.cos.ap-beijing.myqcloud.com'

interface SignCase {
  name: string
  method: string
  pathname: string
  headers?: Record<string, string>
  query?: Record<string, string>
}

const CASES: SignCase[] = [
  {
    name: 'plain GET',
    method: 'get',
    pathname: '/exampleobject',
    headers: { Host: HOST },
  },
  {
    name: 'PUT with content headers and security token',
    method: 'put',
    pathname: '/exampleobject',
    headers: {
      Host: HOST,
      'Content-Type': 'text/plain',
      'Content-Md5': 'mQ/fVh815F3k6TAUm8m0eg==',
      'x-cos-security-token': 'token123',
    },
  },
  {
    name: 'GET with response-* query parameters',
    method: 'get',
    pathname: '/exampleobject',
    headers: { Host: HOST },
    query: { 'response-content-type': 'application/octet-stream', 'max-keys': '10' },
  },
  {
    name: 'multipart part upload (uploadId + partNumber)',
    method: 'put',
    pathname: '/bigfile.bin',
    headers: {
      Host: 'bucket-1250000000.cos.ap-guangzhou.myqcloud.com',
      'Content-Type': 'application/octet-stream',
      'Content-Md5': 'abc==',
    },
    query: { uploadId: 'u123', partNumber: '1' },
  },
  {
    name: 'object key with non-ASCII characters',
    method: 'put',
    pathname: '/exampleobject(腾讯云)',
    headers: { Host: HOST },
  },
  {
    name: 'delete with uploadId',
    method: 'delete',
    pathname: '/bigfile.bin',
    headers: { Host: HOST },
    query: { uploadId: 'u456' },
  },
  {
    name: 'initiate multipart upload (?uploads)',
    method: 'post',
    pathname: '/bigfile.bin',
    headers: { Host: HOST },
    query: { uploads: '' },
  },
]

describe('getCosAuth matches the official COS SDK (oracle)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const mine = getCosAuth({
        method: c.method,
        pathname: c.pathname,
        headers: c.headers,
        query: c.query,
        secretId: SECRET_ID,
        secretKey: SECRET_KEY,
        keyTime: KEY_TIME,
      })
      const official = COS.getAuthorization({
        SecretId: SECRET_ID,
        SecretKey: SECRET_KEY,
        Method: c.method,
        Key: c.pathname.replace(/^\//, ''),
        KeyTime: KEY_TIME,
        Headers: c.headers,
        Query: c.query,
      })
      expect(mine).toBe(official)
    })
  }

  it('defaults to a 900s validity window when no expires/keyTime is given', () => {
    const now = Math.floor(Date.now() / 1000)
    const auth = getCosAuth({
      method: 'get',
      pathname: '/x',
      secretId: SECRET_ID,
      secretKey: SECRET_KEY,
    })
    const match = /q-sign-time=(\d+);(\d+)/.exec(auth)
    expect(match).toBeTruthy()
    expect(parseInt(match![2], 10) - parseInt(match![1], 10)).toBe(900)
    expect(parseInt(match![1], 10)).toBeLessThanOrEqual(now)
  })

  it('throws without credentials', () => {
    expect(() =>
      getCosAuth({ method: 'get', pathname: '/x', secretId: '', secretKey: 'k' }),
    ).toThrow(/SecretId/)
    expect(() =>
      getCosAuth({ method: 'get', pathname: '/x', secretId: 'i', secretKey: '' }),
    ).toThrow(/SecretKey/)
  })
})

describe('official documented example (PUT /exampleobject(腾讯云))', () => {
  it('produces the documented HeaderList ordering and key time', () => {
    const auth = getCosAuth({
      method: 'put',
      pathname: '/exampleobject(腾讯云)',
      secretId: SECRET_ID,
      secretKey: SECRET_KEY,
      keyTime: KEY_TIME,
      headers: {
        Host: HOST,
        Date: 'Thu, 16 May 2019 06:45:51 GMT',
        'Content-Type': 'text/plain',
        'Content-Length': '13',
        'Content-Md5': 'mQ/fVh815F3k6TAUm8m0eg==',
        'x-cos-acl': 'private',
        'x-cos-grant-read': 'uin="100000000011"',
      },
    })
    // Documented HeaderList includes content-type and date because the doc
    // demonstrates manual header selection; the official SDK whitelist
    // deliberately excludes them, and our signer matches the SDK.
    expect(auth).toContain(
      'q-header-list=content-length;content-md5;host;x-cos-acl;x-cos-grant-read',
    )
    expect(auth).toContain('q-sign-time=1557989151;1557996351')
    expect(auth).toContain('q-key-time=1557989151;1557996351')
    // No query parameters on this request.
    expect(auth).toContain('q-url-param-list=')
  })
})

describe('camSafeUrlEncode', () => {
  it('encodes the RFC 3986 chars that encodeURIComponent leaves alone', () => {
    expect(camSafeUrlEncode("!'()*")).toBe('%21%27%28%29%2A')
  })

  it('keeps unreserved characters and slash semantics for values', () => {
    expect(camSafeUrlEncode('a b/c')).toBe('a%20b%2Fc')
  })
})
