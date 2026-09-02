import type { Protocol } from '../protocol'
import { request as cosRequest } from './request'
import { cosSignUrl } from './signatureUrl'
import { createPut } from '../ops/put'
import { createInitMultipartUpload } from '../ops/initMultipartUpload'
import { createUploadPart } from '../ops/uploadPart'
import { createCompleteMultipartUpload } from '../ops/completeMultipartUpload'
import { createAbortMultipartUpload } from '../ops/abortMultipartUpload'
import { createListParts } from '../ops/listParts'
import { createListUploads } from '../ops/listUploads'
import { createUploadPartCopy } from '../ops/uploadPartCopy'
import { createMultipartUpload } from '../ops/multipartUpload'

/**
 * The Tencent COS protocol. This entry point never references the OSS
 * signer, so bundlers tree-shake it away. putSymlink is intentionally
 * absent: COS has no symlink API.
 */
const COS_PROTOCOL: Protocol = {
  request: cosRequest,
  metaPrefix: 'x-cos-meta-',
  copySourceHeader: 'x-cos-copy-source',
  copySourceRangeHeader: 'x-cos-copy-source-range',
  listUploadsMarkerKey: 'key-marker',
  supportsSymlink: false,
  signUrl: cosSignUrl,
}

const put = createPut(COS_PROTOCOL)
const initMultipartUpload = createInitMultipartUpload(COS_PROTOCOL)
const uploadPart = createUploadPart(COS_PROTOCOL)
const completeMultipartUpload = createCompleteMultipartUpload(COS_PROTOCOL)
const multipartUpload = createMultipartUpload(COS_PROTOCOL, {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
})
const abortMultipartUpload = createAbortMultipartUpload(COS_PROTOCOL)
const listParts = createListParts(COS_PROTOCOL)
const listUploads = createListUploads(COS_PROTOCOL)
const uploadPartCopy = createUploadPartCopy(COS_PROTOCOL)
const signatureUrl = COS_PROTOCOL.signUrl

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
