import { createDigest, type BlockHashSpec, type DigestInterface } from './hash'

/* MD5 (RFC 1321), little-endian words, 64-byte blocks, 16-byte digest. */

// Round constants: abs(sin(i)) for i in 1..64, scaled by 2^32.
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

// Per-round left-rotation amounts.
const MD5_S = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
])

const MD5_SPEC: BlockHashSpec = {
  iv: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476],
  littleEndian: true,

  compress(state: Uint32Array, block: Uint8Array): void {
    // Message words are little-endian, unlike SHA-1/SHA-256.
    const m = new Uint32Array(16)
    for (let i = 0; i < 16; i++) {
      const o = i * 4
      m[i] = block[o] | (block[o + 1] << 8) | (block[o + 2] << 16) | (block[o + 3] << 24) | 0
    }

    let a = state[0]
    let b = state[1]
    let c = state[2]
    let d = state[3]

    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) & 15
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) & 15
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) & 15
      }
      const sum = (a + f + MD5_K[i] + m[g]) | 0
      const rotated = (sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])) | 0
      const nextA = (b + rotated) | 0
      a = d
      d = c
      c = b
      b = nextA
    }

    state[0] = (state[0] + a) | 0
    state[1] = (state[1] + b) | 0
    state[2] = (state[2] + c) | 0
    state[3] = (state[3] + d) | 0
  },
}

/** MD5 digest with the streaming DigestInterface. */
export function md5(): DigestInterface {
  return createDigest(MD5_SPEC)
}
