import {
  createDigest,
  createHmac,
  type BlockHashSpec,
  type DigestInterface,
  type HMACInterface,
} from './hash'

/* SHA-256 (FIPS 180-4), big-endian words, 64-byte blocks, 32-byte digest. */

// Round constants: fractional parts of the cube roots of the first 64 primes.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const SHA256_SPEC: BlockHashSpec = {
  iv: [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ],

  compress(state: Uint32Array, block: Uint8Array): void {
    const w = new Uint32Array(64)
    for (let i = 0; i < 16; i++) {
      const o = i * 4
      w[i] = (block[o] << 24) | (block[o + 1] << 16) | (block[o + 2] << 8) | block[o + 3] | 0
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]
      const y = w[i - 2]
      const s0 = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) | 0
      const s1 = (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) | 0
      w[i] = (s1 + w[i - 7] + s0 + w[i - 16]) | 0
    }

    let a = state[0]
    let b = state[1]
    let c = state[2]
    let d = state[3]
    let e = state[4]
    let f = state[5]
    let g = state[6]
    let h = state[7]

    for (let i = 0; i < 64; i++) {
      const bigS1 =
        (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) | 0
      const ch = ((e & f) ^ (~e & g)) | 0
      const t1 = (h + bigS1 + ch + SHA256_K[i] + w[i]) | 0
      const bigS0 =
        (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) | 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) | 0
      const t2 = (bigS0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }

    state[0] = (state[0] + a) | 0
    state[1] = (state[1] + b) | 0
    state[2] = (state[2] + c) | 0
    state[3] = (state[3] + d) | 0
    state[4] = (state[4] + e) | 0
    state[5] = (state[5] + f) | 0
    state[6] = (state[6] + g) | 0
    state[7] = (state[7] + h) | 0
  },
}

/** SHA-256 digest with the streaming DigestInterface. */
export function sha256(): DigestInterface {
  return createDigest(SHA256_SPEC)
}

/** HMAC-SHA256 (RFC 2104). */
export function hmacSha256(): HMACInterface {
  return createHmac(sha256())
}
