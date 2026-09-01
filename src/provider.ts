/**
 * The protocol layer — the extension point for new object storage
 * providers.
 *
 * Implement a `Protocol` (a `request` function plus a few provider
 * constants), then compose the operation factories into your own entry:
 *
 * ```ts
 * import {
 *   createPut, createInitMultipartUpload, createUploadPart,
 *   createCompleteMultipartUpload, createMultipartUpload, type Protocol,
 * } from 'tiny-oss/protocol';
 *
 * const myProtocol: Protocol = {
 *   request: myRequest,      // sign + send one request
 *   metaPrefix: 'x-my-meta-',
 *   copySourceHeader: 'x-my-copy-source',
 *   copySourceRangeHeader: 'x-my-copy-source-range',
 *   listUploadsMarkerKey: 'marker',
 *   supportsSymlink: true,
 *   signUrl: mySignUrl,
 * };
 *
 * const put = createPut(myProtocol);
 * const initMultipartUpload = createInitMultipartUpload(myProtocol);
 * const uploadPart = createUploadPart(myProtocol);
 * const completeMultipartUpload = createCompleteMultipartUpload(myProtocol);
 * const multipartUpload = createMultipartUpload(myProtocol, {
 *   initMultipartUpload, uploadPart, completeMultipartUpload,
 * });
 *
 * export { put, multipartUpload };
 * ```
 *
 * See the README "Adding another object storage" section for the full
 * recipe, including request signing rules per provider.
 */

export type { Protocol, RequestParams } from './protocol';
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

export {
  createPut,
} from './ops/put';
export {
  createPutSymlink,
} from './ops/putSymlink';
export {
  createInitMultipartUpload,
} from './ops/initMultipartUpload';
export {
  createUploadPart,
} from './ops/uploadPart';
export {
  createCompleteMultipartUpload,
} from './ops/completeMultipartUpload';
export {
  createMultipartUpload,
  type MultipartUploadDeps,
} from './ops/multipartUpload';
export {
  createAbortMultipartUpload,
} from './ops/abortMultipartUpload';
export {
  createListParts,
} from './ops/listParts';
export {
  createListUploads,
} from './ops/listUploads';
export {
  createUploadPartCopy,
} from './ops/uploadPartCopy';

export { bindOptions } from './ops/bindOptions';

/** Shared request helpers every provider's request() can reuse. */
export {
  normalizeOptions,
  resolveTimeout,
  dataSize,
} from './ops/request';
