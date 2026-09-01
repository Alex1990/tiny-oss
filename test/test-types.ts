// Type testing file - validates that the generated .d.ts file exports correct types
// Run: npx tsc --noEmit --skipLibCheck test-types.ts

import {
  put,
  putSymlink,
  signatureUrl,
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  listParts,
  listUploads,
  uploadPartCopy,
  multipartUpload,
  bindOptions,
  type Checkpoint,
  type CompleteMultipartUploadResult,
  type InitMultipartUploadResult,
  type ListPartsResult,
  type ListUploadsResult,
  type Options,
  type PartInfo,
  type ResponseHeaderType,
  type SourceData,
  type UploadPartCopyResult,
  type UploadPartResult,
} from '../dist/index';

const options: Options = {
  accessKeyId: 'test-key-id',
  accessKeySecret: 'test-secret',
  bucket: 'test-bucket',
  region: 'oss-cn-hangzhou',
};

// ========================================
// Test 1: Verify operation signatures
// ========================================
const blob = new Blob(['test content'], { type: 'text/plain' });

// put
const putPromise: Promise<any> = put(options, 'test.txt', blob);
const putWithProgress = put(options, 'test.txt', blob, {
  onprogress (e) {
    const loaded: number = e.loaded;
    const total: number = e.total;
    console.log(loaded, total);
  },
});

// putSymlink
const symlinkPromise: Promise<any> = putSymlink(options, 'link.txt', 'target.txt');

// signatureUrl
const basicUrl: string = signatureUrl(options, 'test.txt');
const urlWithOptions: string = signatureUrl(options, 'test.txt', { expires: 600, method: 'GET' });
const urlWithCallback: string = signatureUrl(options, 'test.txt', {
  callback: {
    url: 'https://example.com/callback',
    body: 'key=$(key)',
  },
});

// multipart upload workflow
const initResult: Promise<InitMultipartUploadResult> = initMultipartUpload(options, 'test.txt', { timeout: 30000 });
const uploadPartResult: Promise<UploadPartResult> = uploadPart(options, 'test.txt', 'upload-1', 1, blob, 0, 1024);
const completeResult: Promise<CompleteMultipartUploadResult> = completeMultipartUpload(
  options,
  'test.txt',
  'upload-1',
  [{ number: 1, etag: '"etag"' }]
);
const abortResult: Promise<void> = abortMultipartUpload(options, 'test.txt', 'upload-1');
const listPartsResult: Promise<ListPartsResult> = listParts(options, 'test.txt', 'upload-1');
const listUploadsResult: Promise<ListUploadsResult> = listUploads(options, { prefix: 'x' });
const uploadPartCopyResult: Promise<UploadPartCopyResult> = uploadPartCopy(
  options,
  'test.txt',
  'upload-1',
  1,
  'bytes=0-1023',
  { sourceKey: 'source.txt' }
);
const multipartResult: Promise<CompleteMultipartUploadResult> = multipartUpload(options, 'test.txt', blob, {
  partSize: 1024 * 1024,
  parallel: 3,
  progress: (percentage: number, checkpoint: Checkpoint) => {
    console.log(percentage, checkpoint.uploadId);
  },
});

// bindOptions
const upload = bindOptions(put, options);
const boundPutPromise: Promise<any> = upload('bound.txt', blob);

// ========================================
// Test 2: Verify interface types are exported
// ========================================
const responseHeaders: ResponseHeaderType = {
  'content-type': 'application/json',
};
const part: PartInfo = { number: 1, etag: '"etag"' };
const sourceData: SourceData = { sourceKey: 'src', sourceBucket: 'other' };

// ========================================
// Test 3: Test that incorrect types cause errors (uncomment to verify)
// ========================================
// @ts-expect-error - accessKeyId should be string
put({ accessKeyId: 123 }, 'test.txt', blob);

// @ts-expect-error - missing required accessKeySecret
put({ accessKeyId: 'test' }, 'test.txt', blob);

// @ts-expect-error - put requires objectName as string
put(options, 123, blob);

console.log('All type tests passed!');
