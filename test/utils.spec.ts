import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  unix,
  blobToBuffer,
  encodeUtf8,
  isArrayBuffer,
  isBlob,
  sliceUploadData,
  assertOptions,
  getContentMd5,
  getCanonicalizedOSSHeaders,
  getCanonicalizedResource,
  getSignature,
} from '../src/utils'
import { getXmlTag, getXmlTags } from '../src/utils/xml'

// A second JS realm (iframe in browsers, vm context in Node): instanceof
// fails across realms, which is exactly what the guards must survive.
interface ForeignRealm {
  ArrayBuffer: ArrayBufferConstructor
  Uint8Array: Uint8ArrayConstructor
}

async function foreignRealm(): Promise<ForeignRealm | null> {
  if (typeof document !== 'undefined' && document.body) {
    try {
      const frame = document.createElement('iframe')
      frame.style.display = 'none'
      document.body.appendChild(frame)
      const win = frame.contentWindow
      frame.remove()
      return win ? { ArrayBuffer: win.ArrayBuffer, Uint8Array: win.Uint8Array } : null
    } catch {
      return null
    }
  }
  // node:vm exists only in Node; a static import would break the browser
  // test bundle, so the Node branch loads it on demand (never reached
  // in browsers, where the iframe branch above already returned).
  try {
    const vm = await import('node:vm')
    // vm contexts share no intrinsics with this realm, same as an iframe.
    return vm.runInNewContext('({ ArrayBuffer, Uint8Array })') as ForeignRealm
  } catch {
    return null
  }
}

async function foreignArrayBuffer(size: number): Promise<ArrayBuffer | null> {
  const realm = await foreignRealm()
  return realm ? new realm.ArrayBuffer(size) : null
}

describe('utils', () => {
  describe('unix', () => {
    it('should return current timestamp when no argument', () => {
      const before = Math.floor(Date.now() / 1000)
      const result = unix()
      const after = Math.floor(Date.now() / 1000)
      expect(result).toBeGreaterThanOrEqual(before)
      expect(result).toBeLessThanOrEqual(after)
    })

    it('should return timestamp from date string', () => {
      const result = unix('2024-01-01 00:00:00')
      expect(result).toBe(Math.floor(new Date('2024-01-01 00:00:00').getTime() / 1000))
    })

    it('should return timestamp from Date object', () => {
      const date = new Date('2024-06-15 12:30:00')
      const result = unix(date)
      expect(result).toBe(Math.floor(date.getTime() / 1000))
    })

    it('should return timestamp from number', () => {
      const timestamp = 1700000000000
      const result = unix(timestamp)
      expect(result).toBe(Math.floor(timestamp / 1000))
    })

    it('should return current timestamp for invalid date', () => {
      const before = Math.floor(Date.now() / 1000)
      const result = unix('invalid-date')
      const after = Math.floor(Date.now() / 1000)
      expect(result).toBeGreaterThanOrEqual(before)
      expect(result).toBeLessThanOrEqual(after)
    })
  })

  describe('blobToBuffer', () => {
    it('should convert Blob to Uint8Array', async () => {
      const content = 'Hello, World!'
      const blob = new Blob([content], { type: 'text/plain' })
      const result = await blobToBuffer(blob)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(content.length)

      const decoded = new TextDecoder().decode(result)
      expect(decoded).toBe(content)
    })

    it('should handle empty blob', async () => {
      const blob = new Blob([], { type: 'text/plain' })
      const result = await blobToBuffer(blob)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(0)
    })

    it('should handle binary data', async () => {
      const bytes = new Uint8Array([0, 1, 2, 255, 254, 253])
      const blob = new Blob([bytes])
      const result = await blobToBuffer(blob)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(bytes.length)
      expect(Array.from(result)).toEqual(Array.from(bytes))
    })

    it('should accept ArrayBuffer', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4])
      const result = await blobToBuffer(bytes.buffer)
      expect(Array.from(result)).toEqual([1, 2, 3, 4])
    })

    it('should accept Uint8Array without copying', async () => {
      const bytes = new Uint8Array([9, 8, 7])
      const result = await blobToBuffer(bytes)
      // Zero-copy: the result is a view over the same underlying buffer.
      expect(result.buffer).toBe(bytes.buffer)
    })

    it('should accept a string via UTF-8 encoding', async () => {
      const result = await blobToBuffer('你好abc')
      expect(new TextDecoder().decode(result)).toBe('你好abc')
    })

    it('should accept an ArrayBuffer from another JS context', async () => {
      const foreign = await foreignArrayBuffer(4)
      if (!foreign) return
      const result = await blobToBuffer(foreign)
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.byteLength).toBe(4)
    })
  })

  describe('isBlob / isArrayBuffer', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('isBlob detects Blob instances only', () => {
      expect(isBlob(new Blob(['x']))).toBe(true)
      expect(isBlob(new Uint8Array(1))).toBe(false)
      expect(isBlob(new ArrayBuffer(1))).toBe(false)
    })

    it('isBlob is false and safe when the Blob global is absent (WeChat)', () => {
      vi.stubGlobal('Blob', undefined)
      expect(isBlob(new Uint8Array(1))).toBe(false)
      expect(isBlob({ size: 1, type: 'text/plain' })).toBe(false)
    })

    it('isArrayBuffer detects buffers from another JS context', async () => {
      expect(isArrayBuffer(new ArrayBuffer(1))).toBe(true)
      expect(isArrayBuffer(new Uint8Array(1))).toBe(false)
      const foreign = await foreignArrayBuffer(1)
      if (!foreign) return
      expect(foreign instanceof ArrayBuffer).toBe(false)
      expect(isArrayBuffer(foreign)).toBe(true)
    })

    it('blobToBuffer accepts an ArrayBuffer when Blob is absent (WeChat)', async () => {
      vi.stubGlobal('Blob', undefined)
      const result = await blobToBuffer(new Uint8Array([1, 2, 3]).buffer)
      expect(Array.from(result)).toEqual([1, 2, 3])
    })
  })

  describe('sliceUploadData', () => {
    it('slices a Uint8Array zero-copy', () => {
      const bytes = new Uint8Array([0, 1, 2, 3, 4, 5])
      const part = sliceUploadData(bytes, 1, 4) as Uint8Array
      expect(Array.from(part)).toEqual([1, 2, 3])
      expect(part.buffer).toBe(bytes.buffer)
    })

    it('slices ArrayBuffer and string by byte range', () => {
      const bytes = new Uint8Array([0, 1, 2, 3])
      const buf = sliceUploadData(bytes.buffer, 1, 3) as ArrayBuffer
      expect(Array.from(new Uint8Array(buf))).toEqual([1, 2])
      expect(sliceUploadData('abcdef', 1, 3)).toBe('bc')
    })

    it('rebuilds a DataView window over the same buffer', () => {
      const bytes = new Uint8Array([9, 8, 7, 6, 5])
      const view = new DataView(bytes.buffer, 1, 4) // window over [8, 7, 6, 5]
      // DataView is outside BlobLike; cast only to cross the type boundary.
      const part = sliceUploadData(view as unknown as Blob, 1, 3) as Uint8Array
      expect(Array.from(part)).toEqual([7, 6])
    })

    it('slices a TypedArray from another JS context', async () => {
      const realm = await foreignRealm()
      if (!realm) return
      const foreign = new realm.Uint8Array([1, 2, 3, 4])
      expect(foreign instanceof Uint8Array).toBe(false) // cross-realm premise
      const part = sliceUploadData(foreign as unknown as Blob, 1, 3) as Uint8Array
      expect(Array.from(part)).toEqual([2, 3])
    })
  })

  describe('encodeUtf8', () => {
    it('should match TextEncoder output', () => {
      const cases = ['', 'hello', '你好', 'emoji 😀', 'a𠜎b', 'ñ€é']
      cases.forEach((str) => {
        expect(Array.from(encodeUtf8(str))).toEqual(Array.from(new TextEncoder().encode(str)))
      })
    })

    it('should encode multi-byte sequences correctly', () => {
      // 你 = U+4F60 -> E4 BD A0
      expect(Array.from(encodeUtf8('你'))).toEqual([0xe4, 0xbd, 0xa0])
      // 😀 = U+1F600 (surrogate pair) -> F0 9F 98 80
      expect(Array.from(encodeUtf8('😀'))).toEqual([0xf0, 0x9f, 0x98, 0x80])
    })
  })

  describe('xml', () => {
    it('should extract the first tag text', () => {
      const xml = '<Result><UploadId>abc-123</UploadId><ETag>"xyz"</ETag></Result>'
      expect(getXmlTag(xml, 'UploadId')).toBe('abc-123')
      expect(getXmlTag(xml, 'ETag')).toBe('"xyz"')
      expect(getXmlTag(xml, 'Missing')).toBe('')
    })

    it('should extract repeated tags in order', () => {
      const xml = [
        '<ListPartsResult>',
        '<Part><PartNumber>1</PartNumber><Size>10</Size></Part>',
        '<Part><PartNumber>2</PartNumber><Size>20</Size></Part>',
        '</ListPartsResult>',
      ].join('')
      const parts = getXmlTags(xml, 'Part')
      expect(parts).toHaveLength(2)
      expect(getXmlTag(parts[0], 'PartNumber')).toBe('1')
      expect(getXmlTag(parts[1], 'PartNumber')).toBe('2')
    })

    it('should handle repeated upload tags', () => {
      const xml =
        '<ListUploadsResult><Upload><Key>a.txt</Key><UploadId>u1</UploadId></Upload></ListUploadsResult>'
      const uploads = getXmlTags(xml, 'Upload')
      expect(uploads).toHaveLength(1)
      expect(getXmlTag(uploads[0], 'Key')).toBe('a.txt')
    })
  })

  describe('assertOptions', () => {
    it('should not throw for valid options with accessKeyId, accessKeySecret, and bucket', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          accessKeySecret: 'test-secret',
          bucket: 'test-bucket',
        })
      }).not.toThrow()
    })

    it('should not throw for valid options with accessKeyId, accessKeySecret, and endpoint', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          accessKeySecret: 'test-secret',
          endpoint: 'test-endpoint',
        })
      }).not.toThrow()
    })

    it('should throw error if accessKeyId is missing', () => {
      expect(() => {
        assertOptions({
          accessKeyId: '',
          accessKeySecret: 'test-secret',
          bucket: 'test-bucket',
        })
      }).toThrow('need accessKeyId')
    })

    it('should throw error if accessKeyId is undefined', () => {
      expect(() => {
        assertOptions({
          accessKeySecret: 'test-secret',
          bucket: 'test-bucket',
        } as any)
      }).toThrow('need accessKeyId')
    })

    it('should throw error if accessKeySecret is missing', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          accessKeySecret: '',
          bucket: 'test-bucket',
        })
      }).toThrow('need accessKeySecret')
    })

    it('should throw error if accessKeySecret is undefined', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          bucket: 'test-bucket',
        } as any)
      }).toThrow('need accessKeySecret')
    })

    it('should throw error if neither bucket nor endpoint is provided', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          accessKeySecret: 'test-secret',
        })
      }).toThrow('need bucket or endpoint')
    })
  })

  describe('getContentMd5', () => {
    it('should return base64 encoded MD5 hash', () => {
      const content = new TextEncoder().encode('Hello, World!')
      const result = getContentMd5(content)

      // MD5 of "Hello, World!" in base64
      expect(result).toBe('ZajifYh5KDgxtmS9i38K1A==')
    })

    it('should return consistent hash for same content', () => {
      const content = new TextEncoder().encode('Test content')
      const result1 = getContentMd5(content)
      const result2 = getContentMd5(content)

      expect(result1).toBe(result2)
    })

    it('should return different hash for different content', () => {
      const content1 = new TextEncoder().encode('Content A')
      const content2 = new TextEncoder().encode('Content B')
      const result1 = getContentMd5(content1)
      const result2 = getContentMd5(content2)

      expect(result1).not.toBe(result2)
    })

    it('should handle empty content', () => {
      const content = new Uint8Array(0)
      const result = getContentMd5(content)

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
      // MD5 of empty string in base64 is "1B2M2Y8AsgTpgAmY7PhCfg=="
      expect(result).toBe('1B2M2Y8AsgTpgAmY7PhCfg==')
    })
  })

  describe('getCanonicalizedOSSHeaders', () => {
    it('should return empty string for headers without x-oss-', () => {
      const headers = {
        'Content-Type': 'text/plain',
        Authorization: 'Bearer token',
      }
      const result = getCanonicalizedOSSHeaders(headers)
      expect(result).toBe('')
    })

    it('should extract x-oss- headers', () => {
      const headers = {
        'x-oss-date': 'Mon, 01 Jan 2024 00:00:00 GMT',
        'x-oss-security-token': 'token123',
        'Content-Type': 'text/plain',
      }
      const result = getCanonicalizedOSSHeaders(headers)
      expect(result).toContain('x-oss-date:')
      expect(result).toContain('x-oss-security-token:')
    })

    it('should sort headers alphabetically', () => {
      const headers = {
        'x-oss-z-header': 'z',
        'x-oss-a-header': 'a',
        'x-oss-m-header': 'm',
      }
      const result = getCanonicalizedOSSHeaders(headers)
      const lines = result.trim().split('\n')
      expect(lines[0]).toContain('x-oss-a-header')
      expect(lines[1]).toContain('x-oss-m-header')
      expect(lines[2]).toContain('x-oss-z-header')
    })

    it('should lowercase header names', () => {
      const headers = {
        'X-OSS-Date': 'Mon, 01 Jan 2024 00:00:00 GMT',
      }
      const result = getCanonicalizedOSSHeaders(headers)
      expect(result).toContain('x-oss-date:')
    })
  })

  describe('getCanonicalizedResource', () => {
    it('should return empty path when bucket and objectName are empty', () => {
      const result = getCanonicalizedResource()
      expect(result).toBe('')
    })

    it('should include bucket in path', () => {
      const result = getCanonicalizedResource('my-bucket')
      expect(result).toBe('/my-bucket')
    })

    it('should include bucket and object name', () => {
      const result = getCanonicalizedResource('my-bucket', 'path/to/object.txt')
      expect(result).toBe('/my-bucket/path/to/object.txt')
    })

    it('should add leading slash to object name if missing', () => {
      const result = getCanonicalizedResource('my-bucket', 'object.txt')
      expect(result).toBe('/my-bucket/object.txt')
    })

    it('should not duplicate slash if object name starts with slash', () => {
      const result = getCanonicalizedResource('my-bucket', '/object.txt')
      expect(result).toBe('/my-bucket/object.txt')
    })

    it('should include sub-resource parameters', () => {
      const parameters = { symlink: '', uploads: '' }
      const result = getCanonicalizedResource('my-bucket', 'object.txt', parameters)
      expect(result).toContain('?')
      expect(result).toContain('symlink')
      expect(result).toContain('uploads')
    })

    it('should sort parameters alphabetically', () => {
      const parameters = { z: 'last', a: 'first', m: 'middle' }
      const result = getCanonicalizedResource('my-bucket', 'object.txt', parameters)
      const queryString = result.split('?')[1]
      const pairs = queryString.split('&')
      expect(pairs[0]).toContain('a=')
      expect(pairs[1]).toContain('m=')
      expect(pairs[2]).toContain('z=')
    })
  })

  describe('getSignature', () => {
    it('should return a signature string for header type', () => {
      const result = getSignature({
        type: 'header',
        verb: 'PUT',
        contentMd5: 'dGVzdG1kNQ==',
        bucket: 'test-bucket',
        objectName: 'test.txt',
        accessKeySecret: 'test-secret',
        headers: {
          'Content-Type': 'text/plain',
          'x-oss-date': 'Mon, 01 Jan 2024 00:00:00 GMT',
        },
      })

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should return a signature string for URL type', () => {
      const result = getSignature({
        type: 'url',
        verb: 'GET',
        expires: 1700000000,
        bucket: 'test-bucket',
        objectName: 'test.txt',
        accessKeySecret: 'test-secret',
      })

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should use default values when not provided', () => {
      const result = getSignature({
        accessKeySecret: 'test-secret',
      })

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should return different signatures for different inputs', () => {
      const result1 = getSignature({
        verb: 'GET',
        bucket: 'bucket1',
        objectName: 'object1.txt',
        accessKeySecret: 'secret',
      })

      const result2 = getSignature({
        verb: 'PUT',
        bucket: 'bucket2',
        objectName: 'object2.txt',
        accessKeySecret: 'secret',
      })

      expect(result1).not.toBe(result2)
    })

    it('should include sub-resource in signature', () => {
      const result = getSignature({
        verb: 'PUT',
        bucket: 'test-bucket',
        objectName: 'test.txt',
        accessKeySecret: 'test-secret',
        subResource: { symlink: '' },
      })

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })
})
