/**
 * Shared streaming machinery for the SHA-1 / SHA-256 / MD5 digest
 * implementations in this directory.
 *
 * Everything here is an original implementation written from the public
 * algorithm specifications (RFC 3174, FIPS 180-4, RFC 1321, RFC 2104);
 * it does not include or derive from third-party code.
 */

/** Accepted input forms for digest/HMAC calls. */
export type HashInput = string | Uint8Array | ArrayBuffer | number

export interface DigestInterface {
  update(input: HashInput): void
  finalize(): ArrayBuffer
  digest(input: HashInput): ArrayBuffer
  reset(): void
  digestLength(): number
}

export interface HMACInterface {
  setKey(key: HashInput): void
  update(input: HashInput): void
  finalize(): ArrayBuffer
  mac(input: HashInput): ArrayBuffer
  reset(): void
  hmacLength(): number
}

/** Convert any accepted input into bytes. Strings map char code to byte. */
export function toBytes(input: HashInput): Uint8Array {
  if (typeof input === 'string') {
    const out = new Uint8Array(input.length)
    for (let i = 0; i < input.length; i++) {
      out[i] = input.charCodeAt(i)
    }
    return out
  }
  if (typeof input === 'number') {
    if (input > 0xff) {
      throw new Error('For more than one byte, use an array buffer')
    }
    if (input < 0) {
      throw new Error('Input value must be positive')
    }
    return new Uint8Array([input])
  }
  // Any ArrayBuffer view (Uint8Array and friends) passes through as-is;
  // DataView has no byte elements and is rejected below.
  if (ArrayBuffer.isView(input)) {
    if (typeof (input as Uint8Array).subarray === 'function') {
      return input as Uint8Array
    }
    throw new Error('Unsupported type')
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input)
  }
  throw new Error('Unsupported type')
}

/** Static description of one block-based hash function. */
export interface BlockHashSpec {
  /** Initial state words (the standard IV). */
  iv: readonly number[]
  /** Compress exactly one `blockSize`-byte block into the state words. */
  compress(state: Uint32Array, block: Uint8Array): void
  /** Words and the length trailer serialized little-endian (MD5 only). */
  littleEndian?: boolean
}

/**
 * Incremental, block-buffered hashing core shared by SHA-1, SHA-256 and
 * MD5. `update` counts every absorbed byte; the final padding block is
 * absorbed through `finish` without touching the counters.
 */
class BlockHasher {
  private readonly state: Uint32Array
  private readonly blockSize = 64
  private readonly buffer = new Uint8Array(64)
  private buffered = 0
  private totalLo = 0
  private totalHi = 0

  constructor(private readonly spec: BlockHashSpec) {
    this.state = new Uint32Array(spec.iv)
  }

  reset(): void {
    this.state.set(this.spec.iv)
    this.buffered = 0
    this.totalLo = 0
    this.totalHi = 0
  }

  private count(bytes: number): void {
    this.totalLo += bytes
    if (this.totalLo >= 0x100000000) {
      this.totalLo -= 0x100000000
      this.totalHi += 1
    }
  }

  /** Buffer + compress bytes without counting them (padding path). */
  private absorb(bytes: Uint8Array): void {
    let pos = 0
    if (this.buffered > 0) {
      const take = Math.min(this.blockSize - this.buffered, bytes.length)
      this.buffer.set(bytes.subarray(0, take), this.buffered)
      this.buffered += take
      pos = take
      if (this.buffered === this.blockSize) {
        this.spec.compress(this.state, this.buffer)
        this.buffered = 0
      }
    }
    while (bytes.length - pos >= this.blockSize) {
      this.spec.compress(this.state, bytes.subarray(pos, pos + this.blockSize))
      pos += this.blockSize
    }
    if (pos < bytes.length) {
      const rest = bytes.subarray(pos)
      this.buffer.set(rest)
      this.buffered = rest.length
    }
  }

  update(bytes: Uint8Array): void {
    this.count(bytes.length)
    this.absorb(bytes)
  }

  /** Pad with 0x80 + zeros + 64-bit bit length, hash, then reset. */
  finish(): ArrayBuffer {
    const zeros = (this.blockSize - ((this.buffered + 9) % this.blockSize)) % this.blockSize
    const pad = new Uint8Array(9 + zeros)
    pad[0] = 0x80
    // Message length in bits, derived from the 64-bit byte counter.
    const lo = (this.totalLo * 8) >>> 0
    const hi = (this.totalHi * 8 + (this.totalLo >>> 29)) >>> 0
    const tail = pad.length - 8
    if (this.spec.littleEndian) {
      pad[tail] = lo & 0xff
      pad[tail + 1] = (lo >>> 8) & 0xff
      pad[tail + 2] = (lo >>> 16) & 0xff
      pad[tail + 3] = (lo >>> 24) & 0xff
      pad[tail + 4] = hi & 0xff
      pad[tail + 5] = (hi >>> 8) & 0xff
      pad[tail + 6] = (hi >>> 16) & 0xff
      pad[tail + 7] = (hi >>> 24) & 0xff
    } else {
      pad[tail] = (hi >>> 24) & 0xff
      pad[tail + 1] = (hi >>> 16) & 0xff
      pad[tail + 2] = (hi >>> 8) & 0xff
      pad[tail + 3] = hi & 0xff
      pad[tail + 4] = (lo >>> 24) & 0xff
      pad[tail + 5] = (lo >>> 16) & 0xff
      pad[tail + 6] = (lo >>> 8) & 0xff
      pad[tail + 7] = lo & 0xff
    }
    this.absorb(pad)
    const out = new Uint8Array(this.state.length * 4)
    for (let i = 0; i < this.state.length; i++) {
      const word = this.state[i]
      const o = i * 4
      if (this.spec.littleEndian) {
        out[o] = word & 0xff
        out[o + 1] = (word >>> 8) & 0xff
        out[o + 2] = (word >>> 16) & 0xff
        out[o + 3] = (word >>> 24) & 0xff
      } else {
        out[o] = (word >>> 24) & 0xff
        out[o + 1] = (word >>> 16) & 0xff
        out[o + 2] = (word >>> 8) & 0xff
        out[o + 3] = word & 0xff
      }
    }
    this.reset()
    return out.buffer
  }
}

/** Wrap a BlockHashSpec behind the public DigestInterface. */
export function createDigest(spec: BlockHashSpec): DigestInterface {
  const core = new BlockHasher(spec)
  return {
    update(input: HashInput): void {
      core.update(toBytes(input))
    },
    finalize(): ArrayBuffer {
      return core.finish()
    },
    digest(input: HashInput): ArrayBuffer {
      core.update(toBytes(input))
      return core.finish()
    },
    reset(): void {
      core.reset()
    },
    digestLength(): number {
      return spec.iv.length * 4
    },
  }
}

/** HMAC over a fresh digest per instance (RFC 2104, block size 64). */
export function createHmac(digest: DigestInterface): HMACInterface {
  let opad: Uint8Array | null = null

  return {
    setKey(keyInput: HashInput): void {
      let key = toBytes(keyInput)
      if (key.byteLength > 64) {
        key = new Uint8Array(digest.digest(key))
      }
      digest.reset()
      const ipad = new Uint8Array(64)
      opad = new Uint8Array(64)
      for (let i = 0; i < key.byteLength; i++) {
        ipad[i] = key[i] ^ 0x36
        opad[i] = key[i] ^ 0x5c
      }
      for (let i = key.byteLength; i < 64; i++) {
        ipad[i] = 0x36
        opad[i] = 0x5c
      }
      digest.update(ipad)
    },

    update(input: HashInput): void {
      digest.update(toBytes(input))
    },

    finalize(): ArrayBuffer {
      if (!opad) {
        throw new Error('MAC key is not defined')
      }
      const inner = digest.finalize()
      digest.update(opad)
      digest.update(inner)
      const result = digest.finalize()
      opad = null
      return result
    },

    mac(input: HashInput): ArrayBuffer {
      this.update(input)
      return this.finalize()
    },

    reset(): void {
      digest.reset()
      opad = null
    },

    hmacLength(): number {
      return digest.digestLength()
    },
  }
}
