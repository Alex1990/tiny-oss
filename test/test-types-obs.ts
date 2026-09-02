// Type testing file for the OBS entry point — validates dist/tiny-oss.obs.es.d.ts.
// Run: npx tsc --noEmit --skipLibCheck test-types-obs.ts

import {
  put,
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
  type CompleteMultipartUploadResult,
  type InitMultipartUploadResult,
  type ListPartsResult,
  type ListUploadsResult,
  type Options,
  type UploadPartCopyResult,
  type UploadPartResult,
} from '../dist/tiny-oss.obs.es'

const options: Options = {
  accessKeyId: 'AKIDxxxxxxxxxxxxxxxx',
  accessKeySecret: 'secret',
  bucket: 'examplebucket',
  region: 'cn-north-4',
  secure: true,
}

const blob = new Blob(['test'], { type: 'text/plain' })

// Every operation keeps the same signature as the OSS entry.
const putPromise: Promise<any> = put(options, 'test.txt', blob)
const url: string = signatureUrl(options, 'test.txt', { expires: 600 })
const initResult: Promise<InitMultipartUploadResult> = initMultipartUpload(options, 'test.txt')
const uploadPartResult: Promise<UploadPartResult> = uploadPart(
  options,
  'test.txt',
  'u1',
  1,
  blob,
  0,
  1024,
)
const completeResult: Promise<CompleteMultipartUploadResult> = completeMultipartUpload(
  options,
  'test.txt',
  'u1',
  [{ number: 1, etag: '"e"' }],
)
const abortResult: Promise<void> = abortMultipartUpload(options, 'test.txt', 'u1')
const listPartsResult: Promise<ListPartsResult> = listParts(options, 'test.txt', 'u1')
const listUploadsResult: Promise<ListUploadsResult> = listUploads(options, { prefix: 'x' })
const copyResult: Promise<UploadPartCopyResult> = uploadPartCopy(
  options,
  'test.txt',
  'u1',
  1,
  'bytes=0-1023',
  { sourceKey: 'src.txt' },
)
const multiResult: Promise<CompleteMultipartUploadResult> = multipartUpload(
  options,
  'test.txt',
  blob,
)
const upload = bindOptions(put, options)
const boundPromise: Promise<any> = upload('bound.txt', blob)

// putSymlink is intentionally absent from the OBS entry.
// @ts-expect-error - putSymlink must not exist on the OBS entry
import { putSymlink } from '../dist/tiny-oss.obs.es'

console.log(
  'All OBS type tests passed!',
  putPromise,
  url,
  initResult,
  uploadPartResult,
  completeResult,
  abortResult,
  listPartsResult,
  listUploadsResult,
  copyResult,
  multiResult,
  boundPromise,
)
