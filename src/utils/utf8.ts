/**
 * Encode a string to UTF-8 bytes without depending on platform APIs.
 *
 * Native TextEncoder is used when available (browsers, Service Workers,
 * Node). WeChat mini programs do not provide TextEncoder, so the
 * feature detection falls back to a hand-written UTF-8 encoder that
 * produces identical bytes.
 */

function fallbackEncodeUtf8(str: string): Uint8Array {
  // Worst case: every code point needs 4 bytes.
  const bytes = new Uint8Array(str.length * 4)
  let offset = 0
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    // Combine surrogate pairs into a single code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000
        i += 1
      }
    }
    if (code < 0x80) {
      bytes[offset++] = code
    } else if (code < 0x800) {
      bytes[offset++] = 0xc0 | (code >> 6)
      bytes[offset++] = 0x80 | (code & 0x3f)
    } else if (code < 0x10000) {
      bytes[offset++] = 0xe0 | (code >> 12)
      bytes[offset++] = 0x80 | ((code >> 6) & 0x3f)
      bytes[offset++] = 0x80 | (code & 0x3f)
    } else {
      bytes[offset++] = 0xf0 | (code >> 18)
      bytes[offset++] = 0x80 | ((code >> 12) & 0x3f)
      bytes[offset++] = 0x80 | ((code >> 6) & 0x3f)
      bytes[offset++] = 0x80 | (code & 0x3f)
    }
  }
  return bytes.subarray(0, offset)
}

// Detected once at module load; environments do not gain TextEncoder at
// runtime, and caching the instance avoids re-creating it per call.
const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

export function encodeUtf8(str: string): Uint8Array {
  return encoder ? encoder.encode(str) : fallbackEncodeUtf8(str)
}
