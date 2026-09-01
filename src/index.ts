import type { Protocol } from './protocol';
import { request as ossRequest } from './ops/request';
import { ossSignUrl } from './ops/signatureUrl';
import { createPut } from './ops/put';
import { createInitMultipartUpload } from './ops/initMultipartUpload';
import { createUploadPart } from './ops/uploadPart';
import { createCompleteMultipartUpload } from './ops/completeMultipartUpload';
import { createAbortMultipartUpload } from './ops/abortMultipartUpload';
import { createListParts } from './ops/listParts';
import { createListUploads } from './ops/listUploads';
import { createUploadPartCopy } from './ops/uploadPartCopy';
import { createPutSymlink } from './ops/putSymlink';
import { createMultipartUpload } from './ops/multipartUpload';

/**
 * The Aliyun OSS protocol. Binding happens here so the COS signer is
 * never referenced by this entry point and gets tree-shaken away.
 */
const OSS_PROTOCOL: Protocol = {
  request: ossRequest,
  metaPrefix: 'x-oss-meta-',
  copySourceHeader: 'x-oss-copy-source',
  copySourceRangeHeader: 'x-oss-copy-source-range',
  listUploadsMarkerKey: 'marker',
  supportsSymlink: true,
  signUrl: ossSignUrl,
};

const put = createPut(OSS_PROTOCOL);
const initMultipartUpload = createInitMultipartUpload(OSS_PROTOCOL);
const uploadPart = createUploadPart(OSS_PROTOCOL);
const completeMultipartUpload = createCompleteMultipartUpload(OSS_PROTOCOL);
const multipartUpload = createMultipartUpload(OSS_PROTOCOL, {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
});
const abortMultipartUpload = createAbortMultipartUpload(OSS_PROTOCOL);
const listParts = createListParts(OSS_PROTOCOL);
const listUploads = createListUploads(OSS_PROTOCOL);
const uploadPartCopy = createUploadPartCopy(OSS_PROTOCOL);
const putSymlink = createPutSymlink(OSS_PROTOCOL);
const signatureUrl = OSS_PROTOCOL.signUrl;

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
} from './types';
export { setTransport, getTransport } from './transport';
export type { Transport, TransportOptions, TransportResponse } from './transport';
export { fetchTransport } from './transports/fetch';
export { wxRequestTransport } from './transports/wx';
export { bindOptions } from './ops/bindOptions';
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
  putSymlink,
  signatureUrl,
};
