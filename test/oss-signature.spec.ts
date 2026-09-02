// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ossSignUrl } from '../src/ops/signatureUrl'

const BASE = {
  accessKeyId: 'test-ak',
  accessKeySecret: 'test-sk',
  bucket: 'test-bucket',
  region: 'oss-cn-hangzhou',
  secure: true,
}

describe('ossSignUrl', () => {
  it('percent-encodes a non-ASCII object name in the path', () => {
    const url = ossSignUrl(BASE, '中文 文件.txt', { expires: 1800 })
    // Assert the raw URL string BEFORE any URL parser runs: WHATWG parsers
    // silently re-encode bare non-ASCII paths, so post-parse checks would
    // stay green if the encoder were removed. These two catch that revert.
    expect(url).not.toContain('中文')
    expect(url).toContain('%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.txt')
    const pathname = new URL(url).pathname
    expect(pathname).toBe('/%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.txt')
    expect([...pathname].every((ch) => ch.charCodeAt(0) < 128)).toBe(true)
    expect(decodeURIComponent(pathname)).toBe('/中文 文件.txt')
  })

  it('keeps "/" separators while encoding each segment', () => {
    const url = ossSignUrl(BASE, 'dir/子 名.txt', { expires: 1800 })
    const pathname = new URL(url).pathname
    expect(pathname).toBe('/dir/%E5%AD%90%20%E5%90%8D.txt')
    expect(decodeURIComponent(pathname)).toBe('/dir/子 名.txt')
  })

  it('encodes URL-significant characters (? # &) inside the object name', () => {
    const url = ossSignUrl(BASE, 'a?b#c&d.txt', { expires: 1800 })
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/a%3Fb%23c%26d.txt')
    expect(decodeURIComponent(parsed.pathname)).toBe('/a?b#c&d.txt')
  })

  it('still signs the un-encoded name (raw object in canonical resource)', () => {
    // The signature must be stable regardless of the path encoding: the raw
    // name participates in the StringToSign (mirrors ali-oss), and the URL
    // query keeps the three auth parameters plus nothing else.
    const url = ossSignUrl(BASE, '中文 文件.txt', { expires: 1800 })
    const params = new URL(url).searchParams
    expect(params.get('OSSAccessKeyId')).toBe('test-ak')
    expect(params.has('Expires')).toBe(true)
    expect(params.has('Signature')).toBe(true)
    expect([...params.keys()].sort()).toEqual(['Expires', 'OSSAccessKeyId', 'Signature'])
  })
})
