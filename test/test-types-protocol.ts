// Type testing file for the protocol layer — validates dist/protocol.d.ts.
// Run: npx tsc --noEmit --skipLibCheck test-types-protocol.ts

import {
  createPut,
  createPutSymlink,
  createInitMultipartUpload,
  createUploadPart,
  createCompleteMultipartUpload,
  createMultipartUpload,
  createAbortMultipartUpload,
  createListParts,
  createListUploads,
  createUploadPartCopy,
  bindOptions,
  normalizeOptions,
  resolveTimeout,
  dataSize,
  type Protocol,
  type RequestParams,
  type CompleteMultipartUploadResult,
  type MultipartUploadDeps,
  type Options,
  type SignatureUrlOptions,
} from '../dist/protocol'

// A Protocol can be implemented outside the library: request signs and
// sends, signUrl builds a signed URL.
const myProtocol: Protocol = {
  request: (options: Options, params: RequestParams): Promise<any> => {
    return Promise.resolve({ data: '', headers: {}, status: 200, statusText: 'OK' })
  },
  metaPrefix: 'x-my-meta-',
  copySourceHeader: 'x-my-copy-source',
  copySourceRangeHeader: 'x-my-copy-source-range',
  listUploadsMarkerKey: 'marker',
  supportsSymlink: true,
  signUrl: (options: Options, objectName: string, urlOptions?: SignatureUrlOptions): string => {
    return `https://example.com/${objectName}`
  },
}

const options: Options = {
  accessKeyId: 'id',
  accessKeySecret: 'secret',
  bucket: 'b',
  region: 'r',
}

// Compose an entry from factories, mirroring the built-in providers.
const put = createPut(myProtocol)
const putSymlink = createPutSymlink(myProtocol)
const initMultipartUpload = createInitMultipartUpload(myProtocol)
const uploadPart = createUploadPart(myProtocol)
const completeMultipartUpload = createCompleteMultipartUpload(myProtocol)
const multipartUpload = createMultipartUpload(myProtocol, {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
})
const abortMultipartUpload = createAbortMultipartUpload(myProtocol)
const listParts = createListParts(myProtocol)
const listUploads = createListUploads(myProtocol)
const uploadPartCopy = createUploadPartCopy(myProtocol)

const p: Promise<any> = put(options, 'a.txt', new Blob(['x']))
const sp: Promise<any> = putSymlink(options, 'l', 't')
const mp: Promise<CompleteMultipartUploadResult> = multipartUpload(
  options,
  'big.bin',
  new Uint8Array(10),
)
const upload = bindOptions(put, options)
const bp: Promise<any> = upload('b.txt', new Blob(['y']))
const opts: Options = normalizeOptions(options)
const t: number | undefined = resolveTimeout(opts)
const s: number | undefined = dataSize('hello')

// Typing of the deps contract is enforced structurally.
const deps: MultipartUploadDeps = { initMultipartUpload, uploadPart, completeMultipartUpload }

console.log('All protocol type tests passed!', p, sp, mp, bp, opts, t, s, deps)
