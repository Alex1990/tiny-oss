import { describe, it, expect } from 'vitest'
import { Digest } from '../src/utils/digest'

describe('Digest', () => {
  describe('SHA1', () => {
    it('should create a SHA1 digest instance', () => {
      const sha1 = Digest.SHA1()
      expect(sha1).toBeDefined()
      expect(typeof sha1.update).toBe('function')
      expect(typeof sha1.finalize).toBe('function')
      expect(typeof sha1.digest).toBe('function')
      expect(typeof sha1.reset).toBe('function')
      expect(typeof sha1.digestLength).toBe('function')
    })

    it('should return correct digest length', () => {
      const sha1 = Digest.SHA1()
      expect(sha1.digestLength()).toBe(20)
    })

    it('should hash empty string correctly', () => {
      const sha1 = Digest.SHA1()
      const result = sha1.digest('')
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)

      // SHA1 of empty string: da39a3ee5e6b4b0d3255bfef95601890afd80709
      const expected = new Uint8Array([
        0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55, 0xbf, 0xef, 0x95, 0x60, 0x18,
        0x90, 0xaf, 0xd8, 0x07, 0x09,
      ])
      expect(new Uint8Array(result)).toEqual(expected)
    })

    it('should hash string correctly', () => {
      const sha1 = Digest.SHA1()
      const result = sha1.digest('Hello, World!')
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)

      // SHA1 of "Hello, World!": 0a0a9f2a6772942557ab5355d76af442f8f65e01
      const expected = new Uint8Array([
        0x0a, 0x0a, 0x9f, 0x2a, 0x67, 0x72, 0x94, 0x25, 0x57, 0xab, 0x53, 0x55, 0xd7, 0x6a, 0xf4,
        0x42, 0xf8, 0xf6, 0x5e, 0x01,
      ])
      expect(new Uint8Array(result)).toEqual(expected)
    })

    it('should hash Uint8Array correctly', () => {
      const sha1 = Digest.SHA1()
      const input = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      const result = sha1.digest(input)
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)
    })

    it('should hash ArrayBuffer correctly', () => {
      const sha1 = Digest.SHA1()
      const buffer = new ArrayBuffer(5)
      const view = new Uint8Array(buffer)
      view.set([72, 101, 108, 108, 111])
      const result = sha1.digest(buffer)
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)
    })

    it('should handle incremental updates', () => {
      const sha1 = Digest.SHA1()
      sha1.update('Hello')
      sha1.update(', ')
      sha1.update('World!')
      const result = sha1.finalize()

      // Should match the digest of the complete string
      const sha1Direct = Digest.SHA1()
      const expected = sha1Direct.digest('Hello, World!')

      expect(new Uint8Array(result)).toEqual(new Uint8Array(expected))
    })

    it('should reset correctly', () => {
      const sha1 = Digest.SHA1()
      sha1.update('data')
      sha1.reset()
      sha1.update('Hello, World!')
      const result = sha1.finalize()

      const sha1Direct = Digest.SHA1()
      const expected = sha1Direct.digest('Hello, World!')

      expect(new Uint8Array(result)).toEqual(new Uint8Array(expected))
    })

    it('should handle long input', () => {
      const sha1 = Digest.SHA1()
      const longString = 'a'.repeat(1000)
      const result = sha1.digest(longString)
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)
    })
  })

  describe('HMAC_SHA1', () => {
    it('should create an HMAC-SHA1 instance', () => {
      const hmac = Digest.HMAC_SHA1()
      expect(hmac).toBeDefined()
      expect(typeof hmac.setKey).toBe('function')
      expect(typeof hmac.update).toBe('function')
      expect(typeof hmac.finalize).toBe('function')
      expect(typeof hmac.mac).toBe('function')
      expect(typeof hmac.reset).toBe('function')
      expect(typeof hmac.hmacLength).toBe('function')
    })

    it('should return correct HMAC length', () => {
      const hmac = Digest.HMAC_SHA1()
      expect(hmac.hmacLength()).toBe(20)
    })

    it('should throw error if key is not set', () => {
      const hmac = Digest.HMAC_SHA1()
      expect(() => {
        hmac.update('data')
        hmac.finalize()
      }).toThrow()
    })

    it('should compute HMAC with string key', () => {
      const hmac = Digest.HMAC_SHA1()
      hmac.setKey('secret')
      const result = hmac.mac('Hello, World!')

      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)
    })

    it('should compute HMAC with Uint8Array key', () => {
      const hmac = Digest.HMAC_SHA1()
      const key = new Uint8Array([115, 101, 99, 114, 101, 116]) // "secret"
      hmac.setKey(key)
      const result = hmac.mac('Hello, World!')

      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)
    })

    it('should produce consistent results', () => {
      const hmac1 = Digest.HMAC_SHA1()
      hmac1.setKey('key')
      const result1 = hmac1.mac('message')

      const hmac2 = Digest.HMAC_SHA1()
      hmac2.setKey('key')
      const result2 = hmac2.mac('message')

      expect(new Uint8Array(result1)).toEqual(new Uint8Array(result2))
    })

    it('should produce different results for different keys', () => {
      const hmac1 = Digest.HMAC_SHA1()
      hmac1.setKey('key1')
      const result1 = hmac1.mac('message')

      const hmac2 = Digest.HMAC_SHA1()
      hmac2.setKey('key2')
      const result2 = hmac2.mac('message')

      expect(new Uint8Array(result1)).not.toEqual(new Uint8Array(result2))
    })

    it('should produce different results for different messages', () => {
      const hmac1 = Digest.HMAC_SHA1()
      hmac1.setKey('key')
      const result1 = hmac1.mac('message1')

      const hmac2 = Digest.HMAC_SHA1()
      hmac2.setKey('key')
      const result2 = hmac2.mac('message2')

      expect(new Uint8Array(result1)).not.toEqual(new Uint8Array(result2))
    })

    it('should handle incremental updates', () => {
      const hmac = Digest.HMAC_SHA1()
      hmac.setKey('secret')
      hmac.update('Hello')
      hmac.update(', ')
      hmac.update('World!')
      const result = hmac.finalize()

      const hmacDirect = Digest.HMAC_SHA1()
      hmacDirect.setKey('secret')
      const expected = hmacDirect.mac('Hello, World!')

      expect(new Uint8Array(result)).toEqual(new Uint8Array(expected))
    })

    it('should reset correctly', () => {
      const hmac = Digest.HMAC_SHA1()
      hmac.setKey('secret')
      hmac.update('some data')
      hmac.reset()
      hmac.setKey('secret')
      hmac.update('Hello, World!')
      const result = hmac.finalize()

      const hmacDirect = Digest.HMAC_SHA1()
      hmacDirect.setKey('secret')
      const expected = hmacDirect.mac('Hello, World!')

      expect(new Uint8Array(result)).toEqual(new Uint8Array(expected))
    })

    it('should handle long key (longer than 64 bytes)', () => {
      const hmac = Digest.HMAC_SHA1()
      const longKey = 'a'.repeat(100)
      hmac.setKey(longKey)
      const result = hmac.mac('message')

      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)
    })

    it('should handle empty message', () => {
      const hmac = Digest.HMAC_SHA1()
      hmac.setKey('secret')
      const result = hmac.mac('')

      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)
    })

    it('should handle numeric input', () => {
      const hmac = Digest.HMAC_SHA1()
      hmac.setKey(123) // Must be <= 255
      const result = hmac.mac(45) // Must be <= 255

      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(20)
    })

    it('should throw error for invalid numeric input', () => {
      const hmac = Digest.HMAC_SHA1()
      expect(() => {
        hmac.setKey(256) // Greater than 0xFF
      }).toThrow('For more than one byte, use an array buffer')
    })

    it('should throw error for negative numeric input', () => {
      const hmac = Digest.HMAC_SHA1()
      expect(() => {
        hmac.setKey(-1)
      }).toThrow('Input value must be positive')
    })
  })
})
