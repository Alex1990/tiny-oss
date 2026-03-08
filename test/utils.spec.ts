import { describe, it, expect } from 'vitest';
import {
  unix,
  blobToBuffer,
  assertOptions,
  getContentMd5,
  getCanonicalizedOSSHeaders,
  getCanonicalizedResource,
  getSignature,
} from '../src/utils';

describe('utils', () => {
  describe('unix', () => {
    it('should return current timestamp when no argument', () => {
      const before = Math.floor(Date.now() / 1000);
      const result = unix();
      const after = Math.floor(Date.now() / 1000);
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it('should return timestamp from date string', () => {
      const result = unix('2024-01-01 00:00:00');
      expect(result).toBe(Math.floor(new Date('2024-01-01 00:00:00').getTime() / 1000));
    });

    it('should return timestamp from Date object', () => {
      const date = new Date('2024-06-15 12:30:00');
      const result = unix(date);
      expect(result).toBe(Math.floor(date.getTime() / 1000));
    });

    it('should return timestamp from number', () => {
      const timestamp = 1700000000000;
      const result = unix(timestamp);
      expect(result).toBe(Math.floor(timestamp / 1000));
    });

    it('should return current timestamp for invalid date', () => {
      const before = Math.floor(Date.now() / 1000);
      const result = unix('invalid-date');
      const after = Math.floor(Date.now() / 1000);
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe('blobToBuffer', () => {
    it('should convert Blob to Uint8Array', async () => {
      const content = 'Hello, World!';
      const blob = new Blob([content], { type: 'text/plain' });
      const result = await blobToBuffer(blob);
      
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(content.length);
      
      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe(content);
    });

    it('should handle empty blob', async () => {
      const blob = new Blob([], { type: 'text/plain' });
      const result = await blobToBuffer(blob);
      
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(0);
    });

    it('should handle binary data', async () => {
      const bytes = new Uint8Array([0, 1, 2, 255, 254, 253]);
      const blob = new Blob([bytes]);
      const result = await blobToBuffer(blob);
      
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(bytes.length);
      expect(Array.from(result)).toEqual(Array.from(bytes));
    });
  });

  describe('assertOptions', () => {
    it('should not throw for valid options with accessKeyId, accessKeySecret, and bucket', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          accessKeySecret: 'test-secret',
          bucket: 'test-bucket',
        });
      }).not.toThrow();
    });

    it('should not throw for valid options with accessKeyId, accessKeySecret, and endpoint', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          accessKeySecret: 'test-secret',
          endpoint: 'test-endpoint',
        });
      }).not.toThrow();
    });

    it('should throw error if accessKeyId is missing', () => {
      expect(() => {
        assertOptions({
          accessKeyId: '',
          accessKeySecret: 'test-secret',
          bucket: 'test-bucket',
        });
      }).toThrow('need accessKeyId');
    });

    it('should throw error if accessKeyId is undefined', () => {
      expect(() => {
        assertOptions({
          accessKeySecret: 'test-secret',
          bucket: 'test-bucket',
        } as any);
      }).toThrow('need accessKeyId');
    });

    it('should throw error if accessKeySecret is missing', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          accessKeySecret: '',
          bucket: 'test-bucket',
        });
      }).toThrow('need accessKeySecret');
    });

    it('should throw error if accessKeySecret is undefined', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          bucket: 'test-bucket',
        } as any);
      }).toThrow('need accessKeySecret');
    });

    it('should throw error if neither bucket nor endpoint is provided', () => {
      expect(() => {
        assertOptions({
          accessKeyId: 'test-id',
          accessKeySecret: 'test-secret',
        });
      }).toThrow('need bucket or endpoint');
    });
  });

  describe('getContentMd5', () => {
    it('should return base64 encoded MD5 hash', () => {
      const content = new TextEncoder().encode('Hello, World!');
      const result = getContentMd5(content);
      
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Verify it's a valid base64 string
      expect(() => atob(result)).not.toThrow();
    });

    it('should return consistent hash for same content', () => {
      const content = new TextEncoder().encode('Test content');
      const result1 = getContentMd5(content);
      const result2 = getContentMd5(content);
      
      expect(result1).toBe(result2);
    });

    it('should return different hash for different content', () => {
      const content1 = new TextEncoder().encode('Content A');
      const content2 = new TextEncoder().encode('Content B');
      const result1 = getContentMd5(content1);
      const result2 = getContentMd5(content2);
      
      expect(result1).not.toBe(result2);
    });

    it('should handle empty content', () => {
      const content = new Uint8Array(0);
      const result = getContentMd5(content);
      
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // MD5 of empty string in base64 is "1B2M2Y8AsgTpgAmY7PhCfg=="
      expect(result).toBe('1B2M2Y8AsgTpgAmY7PhCfg==');
    });
  });

  describe('getCanonicalizedOSSHeaders', () => {
    it('should return empty string for headers without x-oss-', () => {
      const headers = {
        'Content-Type': 'text/plain',
        'Authorization': 'Bearer token',
      };
      const result = getCanonicalizedOSSHeaders(headers);
      expect(result).toBe('');
    });

    it('should extract x-oss- headers', () => {
      const headers = {
        'x-oss-date': 'Mon, 01 Jan 2024 00:00:00 GMT',
        'x-oss-security-token': 'token123',
        'Content-Type': 'text/plain',
      };
      const result = getCanonicalizedOSSHeaders(headers);
      expect(result).toContain('x-oss-date:');
      expect(result).toContain('x-oss-security-token:');
    });

    it('should sort headers alphabetically', () => {
      const headers = {
        'x-oss-z-header': 'z',
        'x-oss-a-header': 'a',
        'x-oss-m-header': 'm',
      };
      const result = getCanonicalizedOSSHeaders(headers);
      const lines = result.trim().split('\n');
      expect(lines[0]).toContain('x-oss-a-header');
      expect(lines[1]).toContain('x-oss-m-header');
      expect(lines[2]).toContain('x-oss-z-header');
    });

    it('should lowercase header names', () => {
      const headers = {
        'X-OSS-Date': 'Mon, 01 Jan 2024 00:00:00 GMT',
      };
      const result = getCanonicalizedOSSHeaders(headers);
      expect(result).toContain('x-oss-date:');
    });
  });

  describe('getCanonicalizedResource', () => {
    it('should return empty path when bucket and objectName are empty', () => {
      const result = getCanonicalizedResource();
      expect(result).toBe('');
    });

    it('should include bucket in path', () => {
      const result = getCanonicalizedResource('my-bucket');
      expect(result).toBe('/my-bucket');
    });

    it('should include bucket and object name', () => {
      const result = getCanonicalizedResource('my-bucket', 'path/to/object.txt');
      expect(result).toBe('/my-bucket/path/to/object.txt');
    });

    it('should add leading slash to object name if missing', () => {
      const result = getCanonicalizedResource('my-bucket', 'object.txt');
      expect(result).toBe('/my-bucket/object.txt');
    });

    it('should not duplicate slash if object name starts with slash', () => {
      const result = getCanonicalizedResource('my-bucket', '/object.txt');
      expect(result).toBe('/my-bucket/object.txt');
    });

    it('should include sub-resource parameters', () => {
      const parameters = { symlink: '', uploads: '' };
      const result = getCanonicalizedResource('my-bucket', 'object.txt', parameters);
      expect(result).toContain('?');
      expect(result).toContain('symlink');
      expect(result).toContain('uploads');
    });

    it('should sort parameters alphabetically', () => {
      const parameters = { z: 'last', a: 'first', m: 'middle' };
      const result = getCanonicalizedResource('my-bucket', 'object.txt', parameters);
      const queryString = result.split('?')[1];
      const pairs = queryString.split('&');
      expect(pairs[0]).toContain('a=');
      expect(pairs[1]).toContain('m=');
      expect(pairs[2]).toContain('z=');
    });
  });

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
      });
      
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return a signature string for URL type', () => {
      const result = getSignature({
        type: 'url',
        verb: 'GET',
        expires: 1700000000,
        bucket: 'test-bucket',
        objectName: 'test.txt',
        accessKeySecret: 'test-secret',
      });
      
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should use default values when not provided', () => {
      const result = getSignature({
        accessKeySecret: 'test-secret',
      });
      
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return different signatures for different inputs', () => {
      const result1 = getSignature({
        verb: 'GET',
        bucket: 'bucket1',
        objectName: 'object1.txt',
        accessKeySecret: 'secret',
      });
      
      const result2 = getSignature({
        verb: 'PUT',
        bucket: 'bucket2',
        objectName: 'object2.txt',
        accessKeySecret: 'secret',
      });
      
      expect(result1).not.toBe(result2);
    });

    it('should include sub-resource in signature', () => {
      const result = getSignature({
        verb: 'PUT',
        bucket: 'test-bucket',
        objectName: 'test.txt',
        accessKeySecret: 'test-secret',
        subResource: { symlink: '' },
      });
      
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
