import type { Protocol } from '../protocol'
import { obsCallbackHeaders } from './callback'
import { request as obsRequest } from './request'
import { obsSignUrl } from './signatureUrl'
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
 * The Huawei Cloud OBS protocol. This entry point never references the
 * OSS or COS signers, so bundlers tree-shake them away. putSymlink is
 * intentionally absent: OBS has no symlink API.
 */
const OBS_PROTOCOL: Protocol = {
  request: obsRequest,
  metaPrefix: 'x-obs-meta-',
  copySourceHeader: 'x-obs-copy-source',
  copySourceRangeHeader: 'x-obs-copy-source-range',
  listUploadsMarkerKey: 'key-marker',
  supportsSymlink: false,
  callbackHeaders: obsCallbackHeaders,
  signUrl: obsSignUrl,
}

const put = createPut(OBS_PROTOCOL)
const initMultipartUpload = createInitMultipartUpload(OBS_PROTOCOL)
const uploadPart = createUploadPart(OBS_PROTOCOL)
const completeMultipartUpload = createCompleteMultipartUpload(OBS_PROTOCOL)
const multipartUpload = createMultipartUpload(OBS_PROTOCOL, {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
})
const abortMultipartUpload = createAbortMultipartUpload(OBS_PROTOCOL)
const listParts = createListParts(OBS_PROTOCOL)
const listUploads = createListUploads(OBS_PROTOCOL)
const uploadPartCopy = createUploadPartCopy(OBS_PROTOCOL)
const signatureUrl = OBS_PROTOCOL.signUrl

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
