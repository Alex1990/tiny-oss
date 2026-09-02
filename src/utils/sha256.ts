import { createDigest, createHMAC } from './digest'
import type { DigestInterface, HMACInterface } from './digest'

/* SHA-256 Engine */

class SHA256Engine {
  current: Uint32Array
  currentLen: number
  inLen: number
  inbuf: Uint8Array
  blockLen: number
  digestLen: number

  constructor() {
    this.current = new Uint32Array(new ArrayBuffer(32))
    this.currentLen = 0
    this.inLen = 0
    this.inbuf = new Uint8Array(new ArrayBuffer(64))
    this.blockLen = 64
    this.digestLen = 32
    this.reset()
  }

  processBlock(input: Uint8Array): void {
    let a = this.current[0]
    let b = this.current[1]
    let c = this.current[2]
    let d = this.current[3]
    let e = this.current[4]
    let f = this.current[5]
    let g = this.current[6]
    let h = this.current[7]

    const W: number[] = new Array(64)
    for (let i = 0; i < 16; i++) {
      const j = i * 4
      W[i] = (input[j] << 24) | (input[j + 1] << 16) | (input[j + 2] << 8) | input[j + 3]
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]
      const w2 = W[i - 2]
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
      W[i] = (s1 + W[i - 7] + s0 + W[i - 16]) | 0
    }

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }

    this.current[0] = (this.current[0] + a) | 0
    this.current[1] = (this.current[1] + b) | 0
    this.current[2] = (this.current[2] + c) | 0
    this.current[3] = (this.current[3] + d) | 0
    this.current[4] = (this.current[4] + e) | 0
    this.current[5] = (this.current[5] + f) | 0
    this.current[6] = (this.current[6] + g) | 0
    this.current[7] = (this.current[7] + h) | 0
    this.currentLen += 64
  }

  doPadding(): Uint8Array {
    const datalen = (this.inLen + this.currentLen) * 8
    const msw = 0 // FIXME
    const lsw = datalen & 0xffffffff
    const zeros = this.inLen <= 55 ? 55 - this.inLen : 119 - this.inLen
    const pad = new Uint8Array(new ArrayBuffer(zeros + 1 + 8))
    pad[0] = 0x80
    pad[pad.length - 1] = lsw & 0xff
    pad[pad.length - 2] = (lsw >>> 8) & 0xff
    pad[pad.length - 3] = (lsw >>> 16) & 0xff
    pad[pad.length - 4] = (lsw >>> 24) & 0xff
    pad[pad.length - 5] = msw & 0xff
    pad[pad.length - 6] = (msw >>> 8) & 0xff
    pad[pad.length - 7] = (msw >>> 16) & 0xff
    pad[pad.length - 8] = (msw >>> 24) & 0xff
    return pad
  }

  getDigest(): ArrayBuffer {
    const rv = new Uint8Array(new ArrayBuffer(32))
    for (let i = 0; i < 8; i++) {
      const v = this.current[i]
      const o = i * 4
      rv[o] = (v >>> 24) & 0xff
      rv[o + 1] = (v >>> 16) & 0xff
      rv[o + 2] = (v >>> 8) & 0xff
      rv[o + 3] = v & 0xff
    }
    return rv.buffer
  }

  reset(): void {
    this.currentLen = 0
    this.inLen = 0
    this.current[0] = 0x6a09e667
    this.current[1] = 0xbb67ae85
    this.current[2] = 0x3c6ef372
    this.current[3] = 0xa54ff53a
    this.current[4] = 0x510e527f
    this.current[5] = 0x9b05688c
    this.current[6] = 0x1f83d9ab
    this.current[7] = 0x5be0cd19
  }
}

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

/** SHA-256 digest with the same interface as digest.ts's Digest.SHA1. */
export function sha256(): DigestInterface {
  return createDigest(SHA256Engine)
}

/** HMAC-SHA256 with the same interface as digest.ts's Digest.HMAC_SHA1. */
export function hmacSha256(): HMACInterface {
  return createHMAC(createDigest(SHA256Engine))
}
