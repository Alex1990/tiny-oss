import { createDigest } from '../digest'
import type { DigestInterface } from '../digest'

/* MD5 Engine (RFC 1321) */

class MD5Engine {
  current: Uint32Array
  currentLen: number
  inLen: number
  inbuf: Uint8Array
  blockLen: number
  digestLen: number

  constructor() {
    this.current = new Uint32Array(new ArrayBuffer(16))
    this.currentLen = 0
    this.inLen = 0
    this.inbuf = new Uint8Array(new ArrayBuffer(64))
    this.blockLen = 64
    this.digestLen = 16
    this.reset()
  }

  processBlock(input: Uint8Array): void {
    let A = this.current[0]
    let B = this.current[1]
    let C = this.current[2]
    let D = this.current[3]

    // Message words are little-endian (MD5 differs from SHA1/SHA256 here).
    const M: number[] = Array.from({ length: 16 })
    for (let i = 0; i < 16; i++) {
      const j = i * 4
      M[i] = input[j] | (input[j + 1] << 8) | (input[j + 2] << 16) | (input[j + 3] << 24)
    }

    for (let i = 0; i < 64; i++) {
      let F: number
      let g: number
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) & 15
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) & 15
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) & 15
      }
      const sum = (A + F + MD5_K[i] + M[g]) | 0
      const rotated = (sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i]))
      const tmp = D
      D = C
      C = B
      B = (B + rotated) | 0
      A = tmp
    }

    this.current[0] = (this.current[0] + A) | 0
    this.current[1] = (this.current[1] + B) | 0
    this.current[2] = (this.current[2] + C) | 0
    this.current[3] = (this.current[3] + D) | 0
    this.currentLen += 64
  }

  doPadding(): Uint8Array {
    const datalen = (this.inLen + this.currentLen) * 8
    const msw = 0 // FIXME: inputs beyond 2^32 bits are unsupported, as in SHA1/SHA256
    const lsw = datalen & 0xffffffff
    const zeros = this.inLen <= 55 ? 55 - this.inLen : 119 - this.inLen
    const pad = new Uint8Array(new ArrayBuffer(zeros + 1 + 8))
    pad[0] = 0x80
    // 64-bit bit length, little-endian (MD5 differs from SHA1/SHA256 here).
    pad[pad.length - 8] = lsw & 0xff
    pad[pad.length - 7] = (lsw >>> 8) & 0xff
    pad[pad.length - 6] = (lsw >>> 16) & 0xff
    pad[pad.length - 5] = (lsw >>> 24) & 0xff
    pad[pad.length - 4] = msw & 0xff
    pad[pad.length - 3] = (msw >>> 8) & 0xff
    pad[pad.length - 2] = (msw >>> 16) & 0xff
    pad[pad.length - 1] = (msw >>> 24) & 0xff
    return pad
  }

  getDigest(): ArrayBuffer {
    const rv = new Uint8Array(new ArrayBuffer(16))
    for (let i = 0; i < 4; i++) {
      const v = this.current[i]
      const o = i * 4
      rv[o] = v & 0xff
      rv[o + 1] = (v >>> 8) & 0xff
      rv[o + 2] = (v >>> 16) & 0xff
      rv[o + 3] = (v >>> 24) & 0xff
    }
    return rv.buffer
  }

  reset(): void {
    this.currentLen = 0
    this.inLen = 0
    this.current[0] = 0x67452301
    this.current[1] = 0xefcdab89
    this.current[2] = 0x98badcfe
    this.current[3] = 0x10325476
  }
}

const MD5_K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
])

const MD5_S = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
])

/** MD5 digest with the same interface as digest.ts's Digest.SHA1. */
export function md5(): DigestInterface {
  return createDigest(MD5Engine)
}
