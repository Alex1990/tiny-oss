import { describe, it, expect } from 'vitest'
import { md5 } from '../src/utils/md5'

/** RFC 1321 test suite digests (ASCII inputs). */
const RFC1321_VECTORS: Array<[string, string]> = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'd174ab98d277d9f5a5611c2c9f419d9f',
  ],
  [
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    '57edf4a22be3c955ac49da2e2107b67a',
  ],
]

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexDigest(input: string | Uint8Array): string {
  const digest = md5()
  digest.update(input)
  return bytesToHex(digest.finalize())
}

describe('MD5', () => {
  it('should return correct digest length', () => {
    expect(md5().digestLength()).toBe(16)
  })

  it('should match RFC 1321 test vectors', () => {
    RFC1321_VECTORS.forEach(([input, expected]) => {
      expect(hexDigest(input)).toBe(expected)
    })
  })

  it('should hash a million "a" characters (RFC 1321 A.5)', () => {
    expect(hexDigest('a'.repeat(1000000))).toBe('7707d6ae4e027c70eea2a935c2296f21')
  })

  it('should match one-shot digest across incremental updates', () => {
    const data = new Uint8Array(300)
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256
    const oneShot = hexDigest(data)
    const incremental = md5()
    for (let i = 0; i < data.length; i += 23) {
      incremental.update(data.subarray(i, i + 23))
    }
    expect(bytesToHex(incremental.finalize())).toBe(oneShot)
  })

  it('should reset after finalize for reuse', () => {
    const digest = md5()
    digest.update('first message')
    digest.finalize()
    expect(bytesToHex(digest.digest('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
})
