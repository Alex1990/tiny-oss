import type { Protocol } from '../protocol'
import { request as awsRequest } from './request'
import { awsSignUrl } from './signatureUrl'
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
 * The AWS S3 protocol. This entry point never references the OSS, COS
 * or OBS signers, so bundlers tree-shake them away. putSymlink is
 * intentionally absent: S3 has no symlink API.
 */
const AWS_PROTOCOL: Protocol = {
  request: awsRequest,
  metaPrefix: 'x-amz-meta-',
  copySourceHeader: 'x-amz-copy-source',
  copySourceRangeHeader: 'x-amz-copy-source-range',
  listUploadsMarkerKey: 'key-marker',
  supportsSymlink: false,
  signUrl: awsSignUrl,
}

const put = createPut(AWS_PROTOCOL)
const initMultipartUpload = createInitMultipartUpload(AWS_PROTOCOL)
const uploadPart = createUploadPart(AWS_PROTOCOL)
const completeMultipartUpload = createCompleteMultipartUpload(AWS_PROTOCOL)
const multipartUpload = createMultipartUpload(AWS_PROTOCOL, {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
})
const abortMultipartUpload = createAbortMultipartUpload(AWS_PROTOCOL)
const listParts = createListParts(AWS_PROTOCOL)
const listUploads = createListUploads(AWS_PROTOCOL)
const uploadPartCopy = createUploadPartCopy(AWS_PROTOCOL)
const signatureUrl = AWS_PROTOCOL.signUrl

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
