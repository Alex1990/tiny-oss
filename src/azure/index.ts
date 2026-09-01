import type { Protocol } from '../protocol';
import { request as azureRequest } from './request';
import { azureSignUrl } from './signatureUrl';
import { createPut } from '../ops/put';
import { createMultipartUpload } from '../ops/multipartUpload';
import { initMultipartUpload, uploadPart, completeMultipartUpload } from './multipart';

/**
 * The Azure Blob Storage protocol (SharedKey authorization, service
 * SAS signed URLs). This entry point never references the OSS, COS,
 * OBS or AWS signers, so bundlers tree-shake them away.
 *
 * Azure has no S3-style multipart sessions, so abortMultipartUpload,
 * listParts, listUploads and uploadPartCopy are intentionally absent
 * (block blobs commit a block list instead). putSymlink is absent too.
 */
const AZURE_PROTOCOL: Protocol = {
  request: azureRequest,
  metaPrefix: 'x-ms-meta-',
  copySourceHeader: 'x-ms-copy-source',
  copySourceRangeHeader: 'x-ms-copy-source-range',
  listUploadsMarkerKey: 'marker',
  supportsSymlink: false,
  signUrl: azureSignUrl,
};

const put = createPut(AZURE_PROTOCOL);
const multipartUpload = createMultipartUpload(AZURE_PROTOCOL, {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
});
const signatureUrl = AZURE_PROTOCOL.signUrl;

export type { TinyOSS } from '../types';
export { setTransport, getTransport } from '../transport';
export type { Transport, TransportOptions, TransportResponse } from '../transport';
export { fetchTransport } from '../transports/fetch';
export { wxRequestTransport } from '../transports/wx';
export { bindOptions } from '../ops/bindOptions';
export {
  put,
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  multipartUpload,
  signatureUrl,
};
