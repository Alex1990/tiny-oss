import { describe, it, expect, vi, afterEach } from 'vitest'
import { getTosSignature, tosUriEscape, canonicalTosQuery } from '../src/tos/signature'
import { tosSignUrl } from '../src/tos/signatureUrl'
import { request as tosRequest } from '../src/tos/request'
import { resolveTosHost } from '../src/tos/host'
import { setTransport, getTransport } from '../src/transport'
import type { Options } from '../src/types'

// The byte-identical oracle for these values lives in test/tos-oracle.node.ts
// (it drives the official @volcengine/tos-sdk against a local capture server
// and compares the full Authorization header / pre-signed URL). The fixed
// vectors below are copied from that oracle so the normal `pnpm test` run
// pins the signer without importing the SDK (whose browser build does not
// survive vite's dependency optimizer).
const AK = 'AKIDEXAMPLE'
const SK = 'SECRETKEY'
const REGION = 'cn-beijing'
const BUCKET = 'examplebucket'
const TOKEN = 'TOKEN'

describe('getTosSignature fixed vectors (oracle: @volcengine/tos-sdk)', () => {
  it('signs host, x-tos-date and x-tos-content-sha256', () => {
    const { signature, credentialScope, signedHeaders } = getTosSignature({
      method: 'POST',
      pathname: '/examplebucket/bigfile.bin',
      query: { uploads: '' },
      headers: {
        host: '127.0.0.1:45893',
        'x-tos-date': '20260918T125156Z',
        'x-tos-content-sha256': 'UNSIGNED-PAYLOAD',
      },
      accessKeyId: AK,
      secretAccessKey: SK,
      region: REGION,
      date: '20260918T125156Z',
    })
    expect(credentialScope).toBe('20260918/cn-beijing/tos/request')
    expect(signedHeaders).toBe('host;x-tos-content-sha256;x-tos-date')
    expect(signature).toBe('57e4cfd365d312c5e37abb6d26e19b11b231e5d4e761d6b6b11fc3cf1b417b6c')
  })

  it('canonicalizes the query sorted and URI-escaped', () => {
    expect(canonicalTosQuery({ b: '2', a: '1 0' })).toBe('a=1%200&b=2')
    expect(canonicalTosQuery({ uploads: '' })).toBe('uploads=')
  })

  // Published vector from the official Go SDK's TestAlgV4
  // (ve-tos-golang-sdk tos/sign_v4_test.go): GET https://test.tos.com:8080/test.txt,
  // region cn-north-1, date 20210721T104454Z. It pins the query-signing path
  // and, critically, that the credential scope carries the region.
  it('matches the official Go SDK published query vector', () => {
    const { signature, credentialScope } = getTosSignature({
      method: 'GET',
      pathname: '/test.txt',
      query: {
        'X-Tos-Algorithm': 'TOS4-HMAC-SHA256',
        'X-Tos-Credential': 'AKIAIOSFODNN7EXAMPLE/20210721/cn-north-1/tos/request',
        'X-Tos-Date': '20210721T104454Z',
        'X-Tos-Expires': '3600',
        'X-Tos-SignedHeaders': 'host',
      },
      headers: { host: 'test.tos.com:8080' },
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'cn-north-1',
      date: '20210721T104454Z',
    })
    expect(credentialScope).toBe('20210721/cn-north-1/tos/request')
    expect(signature).toBe('decc75e2b2d453117f81e53954eb2cd3a2f56db2951e9b2257863db4c4921111')
  })
})

describe('tosSignUrl fixed vectors (oracle: @volcengine/tos-sdk, endpoint === region)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const opts = {
    accessKeyId: AK,
    accessKeySecret: SK,
    region: REGION,
    endpoint: REGION,
    bucket: BUCKET,
    secure: true,
  }

  function at(date: string) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(date))
  }

  it('plain GET download', () => {
    at('2026-09-01T00:00:00.000Z')
    const url = new URL(tosSignUrl(opts, 'exampleobject', { expires: 600 }))
    expect(url.host).toBe(`${BUCKET}.cn-beijing`)
    expect(url.pathname).toBe('/exampleobject')
    expect(url.searchParams.get('X-Tos-Signature')).toBe(
      '4cba3a3c67f8da33a72d5b87c0c264715edfc56552c35a4cff81eed169c3f7c0',
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'X-Tos-Algorithm': 'TOS4-HMAC-SHA256',
      'X-Tos-Content-Sha256': 'UNSIGNED-PAYLOAD',
      'X-Tos-Credential': `${AK}/20260901/${REGION}/tos/request`,
      'X-Tos-Date': '20260901T000000Z',
      'X-Tos-Expires': '600',
      'X-Tos-SignedHeaders': 'host',
      'X-Tos-Signature': '4cba3a3c67f8da33a72d5b87c0c264715edfc56552c35a4cff81eed169c3f7c0',
    })
  })

  it('non-ASCII key with a space', () => {
    at('2026-09-01T00:00:00.000Z')
    const url = new URL(tosSignUrl(opts, '目录/a b.txt', { expires: 600 }))
    expect(decodeURIComponent(url.pathname)).toBe('/目录/a b.txt')
    expect(url.searchParams.get('X-Tos-Signature')).toBe(
      '9fc2461247b09863d0fe8bac0d545b07206fad757629a69da8adf0124f59a4d8',
    )
  })

  it('defaults to 1800s validity like the other entries', () => {
    at('2026-09-01T00:00:00.000Z')
    const url = new URL(tosSignUrl(opts, 'exampleobject'))
    expect(url.searchParams.get('X-Tos-Expires')).toBe('1800')
  })

  it('signs the credential scope with the region, not the endpoint', () => {
    at('2026-09-01T00:00:00.000Z')
    const url = new URL(
      tosSignUrl({ ...opts, endpoint: `tos-${REGION}.volces.com` }, 'exampleobject', {
        expires: 600,
      }),
    )
    expect(url.host).toBe(`${BUCKET}.tos-${REGION}.volces.com`)
    expect(url.searchParams.get('X-Tos-Credential')).toBe(`${AK}/20260901/${REGION}/tos/request`)
  })

  it('carries the security token in the signed query', () => {
    at('2026-09-01T00:00:00.000Z')
    const url = new URL(tosSignUrl({ ...opts, stsToken: TOKEN }, 'exampleobject', { expires: 60 }))
    expect(url.searchParams.get('X-Tos-Security-Token')).toBe(TOKEN)
  })

  it('maps response-* and process options into the query', () => {
    at('2026-09-01T00:00:00.000Z')
    const url = new URL(
      tosSignUrl(opts, 'exampleobject', {
        expires: 60,
        process: 'image/resize,w_100',
        response: { 'content-type': 'text/plain', 'content-disposition': 'attachment' },
      }),
    )
    expect(url.searchParams.get('x-tos-process')).toBe('image/resize,w_100')
    expect(url.searchParams.get('response-content-type')).toBe('text/plain')
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment')
  })
})

describe('tosUriEscape', () => {
  it('escapes the RFC 3986 chars encodeURIComponent leaves alone', () => {
    expect(tosUriEscape("!'()*")).toBe('%21%27%28%29%2A')
  })

  it('encodes spaces and slashes', () => {
    expect(tosUriEscape('a b/c')).toBe('a%20b%2Fc')
  })
})

describe('resolveTosHost', () => {
  const base: Options = { accessKeyId: AK, accessKeySecret: SK, bucket: BUCKET, region: REGION }

  it('builds the virtual-hosted region host', () => {
    expect(resolveTosHost(base)).toBe(`${BUCKET}.tos-${REGION}.volces.com`)
  })

  it('uses the internal network domain when internal is set', () => {
    expect(resolveTosHost({ ...base, internal: true })).toBe(`${BUCKET}.tos-${REGION}.ivolces.com`)
  })

  it('prefixes the bucket to a custom endpoint domain', () => {
    expect(resolveTosHost({ ...base, endpoint: 'tos-cn-shanghai.volces.com' })).toBe(
      `${BUCKET}.tos-cn-shanghai.volces.com`,
    )
  })

  it('requires a region and a bucket, even with a custom endpoint', () => {
    expect(() => resolveTosHost({ ...base, region: undefined })).toThrow(/region/)
    expect(() =>
      resolveTosHost({ ...base, region: undefined, endpoint: 'tos.example.com' }),
    ).toThrow(/region/)
    expect(() => resolveTosHost({ ...base, bucket: undefined })).toThrow(/bucket/)
  })
})

describe('TOS request building', () => {
  function captureTransport() {
    const original = getTransport()
    const calls: Array<{ url: string; options: any }> = []
    setTransport(async (url, options) => {
      calls.push({ url, options })
      return { data: '', headers: {}, status: 200, statusText: 'OK' }
    })
    return { calls, restore: () => setTransport(original) }
  }

  const base: Options = {
    accessKeyId: AK,
    accessKeySecret: SK,
    bucket: BUCKET,
    region: REGION,
    secure: true,
  }

  it('builds the virtual-hosted URL and lower-cases the header names', async () => {
    const { calls, restore } = captureTransport()
    try {
      await tosRequest(base, {
        verb: 'PUT',
        objectName: 'dir/a b.txt',
        headers: { 'Content-Md5': 'abc==' },
      })
    } finally {
      restore()
    }
    expect(calls[0].url).toBe(`https://${BUCKET}.tos-${REGION}.volces.com/dir/a%20b.txt`)
    expect(calls[0].options.headers.authorization).toMatch(
      new RegExp(
        `^TOS4-HMAC-SHA256 Credential=${AK}\\/\\d{8}\\/${REGION}\\/tos\\/request, SignedHeaders=host;x-tos-content-sha256;x-tos-date, Signature=[0-9a-f]{64}$`,
      ),
    )
    expect(calls[0].options.headers['content-md5']).toBe('abc==')
    expect(calls[0].options.headers['x-tos-content-sha256']).toBe('UNSIGNED-PAYLOAD')
  })

  it('adds the STS token as a signed x-tos-security-token header', async () => {
    const { calls, restore } = captureTransport()
    try {
      await tosRequest({ ...base, stsToken: TOKEN }, { verb: 'GET', objectName: 'x' })
    } finally {
      restore()
    }
    expect(calls[0].options.headers['x-tos-security-token']).toBe(TOKEN)
    expect(calls[0].options.headers.authorization).toContain(
      'SignedHeaders=host;x-tos-content-sha256;x-tos-date;x-tos-security-token',
    )
  })

  it('sorts and encodes the query string exactly like the signature', async () => {
    const { calls, restore } = captureTransport()
    try {
      await tosRequest(base, {
        verb: 'PUT',
        objectName: 'bigfile.bin',
        subResource: { uploadId: 'u1', partNumber: '1' },
      })
    } finally {
      restore()
    }
    expect(calls[0].url).toBe(
      `https://${BUCKET}.tos-${REGION}.volces.com/bigfile.bin?partNumber=1&uploadId=u1`,
    )
    expect(calls[0].options.headers.authorization).toContain(
      'SignedHeaders=host;x-tos-content-sha256;x-tos-date',
    )
  })

  it('prefixes the bucket to a custom endpoint domain', async () => {
    const { calls, restore } = captureTransport()
    try {
      await tosRequest(
        { ...base, endpoint: 'tos-cn-shanghai.volces.com' },
        { verb: 'GET', objectName: 'x' },
      )
    } finally {
      restore()
    }
    expect(calls[0].url).toBe(`https://${BUCKET}.tos-cn-shanghai.volces.com/x`)
  })
})
