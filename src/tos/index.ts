import type { Protocol } from '../protocol'
import { request as tosRequest } from './request'
import { tosSignUrl } from './signatureUrl'
import { createPut } from '../ops/put'
import { createPutSymlink } from '../ops/putSymlink'
import { createInitMultipartUpload } from '../ops/initMultipartUpload'
import { createUploadPart } from '../ops/uploadPart'
import { createCompleteMultipartUpload } from '../ops/completeMultipartUpload'
import { createAbortMultipartUpload } from '../ops/abortMultipartUpload'
import { createListParts } from '../ops/listParts'
import { createListUploads } from '../ops/listUploads'
import { createUploadPartCopy } from '../ops/uploadPartCopy'
import { createMultipartUpload } from '../ops/multipartUpload'

/**
 * The Volcano Engine Torch Object Storage (TOS) protocol. This entry point
 * never references the OSS, COS, OBS or AWS signers, so bundlers tree-shake
 * them away. TOS has a symlink API (unlike COS/OBS/S3), so putSymlink is
 * exported; structured upload callbacks are not serialized (pass
 * `x-tos-callback` / `x-tos-callback-var` through `headers` instead).
 */
const TOS_PROTOCOL: Protocol = {
  request: tosRequest,
  metaPrefix: 'x-tos-meta-',
  copySourceHeader: 'x-tos-copy-source',
  copySourceRangeHeader: 'x-tos-copy-source-range',
  listUploadsMarkerKey: 'key-marker',
  supportsSymlink: true,
  symlinkHeaders: (targetObjectName) => ({ 'x-tos-symlink-target': targetObjectName }),
  signUrl: tosSignUrl,
}

const put = createPut(TOS_PROTOCOL)
const putSymlink = createPutSymlink(TOS_PROTOCOL)
const initMultipartUpload = createInitMultipartUpload(TOS_PROTOCOL)
const uploadPart = createUploadPart(TOS_PROTOCOL)
const completeMultipartUpload = createCompleteMultipartUpload(TOS_PROTOCOL)
const multipartUpload = createMultipartUpload(TOS_PROTOCOL, {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
})
const abortMultipartUpload = createAbortMultipartUpload(TOS_PROTOCOL)
const listParts = createListParts(TOS_PROTOCOL)
const listUploads = createListUploads(TOS_PROTOCOL)
const uploadPartCopy = createUploadPartCopy(TOS_PROTOCOL)
const signatureUrl = TOS_PROTOCOL.signUrl

export type {
  BlobLike,
  Checkpoint,
  CompleteMultipartUploadResult,
  HTTPMethods,
  InitMultipartUploadResult,
  ListPartsResult,
  ListQuery,
  ListUploadsQuery,
  ListUploadsResult,
  MultipartOptions,
  MultipartUploadOptions,
  ObjectCallback,
  Options,
  Part,
  PartInfo,
  Progress,
  PutOptions,
  ResponseHeaderType,
  SignatureUrlOptions,
  SourceData,
  UploadInfo,
  UploadPartCopyOptions,
  UploadPartCopyResult,
  UploadPartResult,
} from '../types'
export { setTransport, getTransport } from '../transport'
export type { Transport, TransportOptions, TransportResponse } from '../transport'
export { fetchTransport } from '../transports/fetch'
export { wxRequestTransport } from '../transports/wx'
export { bindOptions } from '../ops/bindOptions'
export {
  put,
  putSymlink,
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  multipartUpload,
  abortMultipartUpload,
  listParts,
  listUploads,
  uploadPartCopy,
  signatureUrl,
}
