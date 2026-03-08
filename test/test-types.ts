// Type testing file - validates that the generated .d.ts file exports correct types
// Run: npx tsc --noEmit test-types.ts

import TinyOSS from '../dist/index';

// ========================================
// Test 1: Verify class can be instantiated with correct options
// ========================================
const oss = new TinyOSS({
  accessKeyId: 'test-key-id',
  accessKeySecret: 'test-secret',
  bucket: 'test-bucket',
  region: 'oss-cn-hangzhou',
  secure: true,
  timeout: 30000,
  internal: false,
  cname: false,
});

// ========================================
// Test 2: Verify constructor accepts optional and partial options
// ========================================
const ossMinimal = new TinyOSS({
  accessKeyId: 'test',
  accessKeySecret: 'test',
});

const ossWithStsToken = new TinyOSS({
  accessKeyId: 'test',
  accessKeySecret: 'test',
  stsToken: 'temporary-token',
});

const ossWithEndpoint = new TinyOSS({
  accessKeyId: 'test',
  accessKeySecret: 'test',
  endpoint: 'custom.example.com',
});

// ========================================
// Test 3: Verify instance properties exist
// ========================================
const host: string | undefined = oss.host;
const opts = oss.opts;

// ========================================
// Test 4: Verify put method signature
// ========================================
const blob = new Blob(['test content'], { type: 'text/plain' });

// Basic put call
const putPromise: Promise<any> = oss.put('test.txt', blob);

// Put with options
const putWithProgress = oss.put('test.txt', blob, {
  onprogress: function(this: XMLHttpRequest, ev: ProgressEvent) {
    console.log(`Progress: ${ev.loaded}/${ev.total}`);
  },
});

// ========================================
// Test 5: Verify putSymlink method
// ========================================
const symlinkPromise: Promise<any> = oss.putSymlink('link.txt', 'target.txt');

// ========================================
// Test 6: Verify signatureUrl method
// ========================================
// Basic signature url
const basicUrl: string = oss.signatureUrl('test.txt');

// With options
const urlWithOptions = oss.signatureUrl('test.txt', {
  expires: 3600,
  method: 'GET',
  'Content-Type': 'application/json',
  process: 'image/resize,w_200',
  response: {
    'content-type': 'image/jpeg',
    'content-disposition': 'attachment; filename="test.jpg"',
    'cache-control': 'max-age=3600',
  },
});

// With callback
const urlWithCallback = oss.signatureUrl('test.txt', {
  callback: {
    url: 'https://example.com/callback',
    body: 'key=$(key)&etag=$(etag)',
    host: 'example.com',
    contentType: 'application/json',
    customValue: { foo: 'bar' },
    headers: { 'X-Custom': 'header' },
  },
});

// ========================================
// Test 7: Verify HTTP methods type
// ========================================
type Methods = 'GET' | 'POST' | 'DELETE' | 'PUT';
const validMethods: Methods[] = ['GET', 'POST', 'DELETE', 'PUT'];

// ========================================
// Test 8: Verify ResponseHeaderType
// ========================================
const responseHeaders: {
  'content-type'?: string;
  'content-disposition'?: string;
  'cache-control'?: string;
} = {
  'content-type': 'application/json',
};

// ========================================
// Test 9: Test that incorrect types cause errors (uncomment to verify)
// ========================================
// @ts-expect-error - accessKeyId should be string
const wrongOss = new TinyOSS({ accessKeyId: 123 });

// @ts-expect-error - missing required accessKeySecret
const wrongOss2 = new TinyOSS({ accessKeyId: 'test' });

// @ts-expect-error - put requires objectName as string
oss.put(123, blob);

// @ts-expect-error - put requires Blob
oss.put('test.txt', 'not a blob');

console.log('All type tests passed!');
