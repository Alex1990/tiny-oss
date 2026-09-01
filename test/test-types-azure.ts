// Type testing file for the Azure Blob Storage entry point — validates
// dist/azure.d.ts.
// Run: npx tsc --noEmit --skipLibCheck test-types-azure.ts

import {
  put,
  signatureUrl,
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  multipartUpload,
  bindOptions,
  type TinyOSS,
} from '../dist/azure';

const options: TinyOSS.TinyOSSOptions = {
  accessKeyId: 'myaccount',
  accessKeySecret: 'base64accountkey',
  bucket: 'mycontainer',
  secure: true,
};

const blob = new Blob(['test'], { type: 'text/plain' });

// Every operation keeps the same signature as the OSS entry.
const putPromise: Promise<any> = put(options, 'test.txt', blob);
const url: string = signatureUrl(options, 'test.txt', { expires: 600 });
const initResult: Promise<TinyOSS.InitMultipartUploadResult> = initMultipartUpload(options, 'test.txt');
const uploadPartResult: Promise<TinyOSS.UploadPartResult> = uploadPart(options, 'test.txt', 'u1', 1, blob, 0, 1024);
const completeResult: Promise<TinyOSS.CompleteMultipartUploadResult> = completeMultipartUpload(options, 'test.txt', 'u1', [{ number: 1, etag: 'MDAwMDE=' }]);
const multiResult: Promise<TinyOSS.CompleteMultipartUploadResult> = multipartUpload(options, 'test.txt', blob);
const upload = bindOptions(put, options);
const boundPromise: Promise<any> = upload('bound.txt', blob);

// Azure has no S3-style multipart sessions: these must not exist on the
// azure entry.
// @ts-expect-error - putSymlink must not exist on the azure entry
import { putSymlink } from '../dist/azure';
// @ts-expect-error - abortMultipartUpload must not exist on the azure entry
import { abortMultipartUpload } from '../dist/azure';
// @ts-expect-error - listParts must not exist on the azure entry
import { listParts } from '../dist/azure';
// @ts-expect-error - listUploads must not exist on the azure entry
import { listUploads } from '../dist/azure';
// @ts-expect-error - uploadPartCopy must not exist on the azure entry
import { uploadPartCopy } from '../dist/azure';

console.log('All Azure type tests passed!', putPromise, url, initResult, uploadPartResult, completeResult, multiResult, boundPromise);
