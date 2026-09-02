import {
  createDigest,
  createHmac,
  type BlockHashSpec,
  type DigestInterface,
  type HMACInterface,
} from './hash'

/* SHA-1 (RFC 3174), big-endian words, 64-byte blocks, 20-byte digest. */

const SHA1_SPEC: BlockHashSpec = {
  iv: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0],

  compress(state: Uint32Array, block: Uint8Array): void {
    const w = new Uint32Array(80)
    for (let i = 0; i < 16; i++) {
      const o = i * 4
      w[i] = (block[o] << 24) | (block[o + 1] << 16) | (block[o + 2] << 8) | block[o + 3] | 0
    }
    for (let i = 16; i < 80; i++) {
      const mix = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) | 0
      w[i] = (mix << 1) | (mix >>> 31) | 0
    }

    let a = state[0]
    let b = state[1]
    let c = state[2]
    let d = state[3]
    let e = state[4]

    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2) | 0
      b = a
      a = temp
    }

    state[0] = (state[0] + a) | 0
    state[1] = (state[1] + b) | 0
    state[2] = (state[2] + c) | 0
    state[3] = (state[3] + d) | 0
    state[4] = (state[4] + e) | 0
  },
}

/** SHA-1 digest with the streaming DigestInterface. */
export function sha1(): DigestInterface {
  return createDigest(SHA1_SPEC)
}

/** HMAC-SHA1 (RFC 2104). */
export function hmacSha1(): HMACInterface {
  return createHmac(sha1())
}
