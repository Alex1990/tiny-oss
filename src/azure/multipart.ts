import base64js from 'base64-js';
import { blobToBuffer, getContentMd5, encodeUtf8, sliceUploadData } from '../utils';
import { request as azureRequest } from './request';
import type { BlobLike, CompleteMultipartUploadResult, InitMultipartUploadResult, MultipartOptions, Options, PartInfo, UploadPartResult } from '../types';

/**
 * Azure Block Blob multipart primitives. Azure has no server-side
 * upload session: the "upload id" is a client-generated label (kept so
 * the shared multipartUpload orchestrator can checkpoint it), each part
 * is a Put Block (?comp=block&blockid=<base64 id>) and completion is a
 * single Put Block List (?comp=blocklist) carrying the ordered block
 * ids as XML. No ETags are needed for the block list, so the part id
 * itself is returned as the "etag".
 */

/** Fixed-width decimal part label, base64-encoded as the block id. */
function blockIdFor(partNo: number): string {
  const label = String(partNo).padStart(5, '0');
  return base64js.fromByteArray(encodeUtf8(label));
}

/** A local upload id, meaningful only for checkpointing. */
function localUploadId(): string {
  return `az-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Meta headers passed to initMultipartUpload are held per upload id and
 * merged into the final Put Block List, which is where Azure applies
 * blob metadata (there is no init request to carry them).
 */
const pendingMeta = new Map<string, Record<string, any>>();

export function initMultipartUpload(
  options: Options,
  objectName: string,
  multipartOptions: MultipartOptions = {}
): Promise<InitMultipartUploadResult> {
  // Block blobs need no initiation request; the id is a client label.
  void options;
  const uploadId = localUploadId();
  if (multipartOptions.headers) pendingMeta.set(uploadId, multipartOptions.headers);
  return Promise.resolve({ name: objectName, uploadId });
}

export function uploadPart(
  options: Options,
  objectName: string,
  uploadId: string,
  partNo: number,
  data: BlobLike | string,
  start: number,
  end: number,
  multipartOptions: MultipartOptions = {}
): Promise<UploadPartResult> {
  void uploadId;
  const partData = sliceUploadData(data, start, end);
  return blobToBuffer(partData).then((buf) => {
    const blockId = blockIdFor(partNo);
    const headers: Record<string, any> = {
      'Content-Md5': getContentMd5(buf),
      ...multipartOptions.headers,
    };
    return azureRequest(options, {
      verb: 'PUT',
      objectName,
      contentMd5: headers['Content-Md5'],
      headers,
      subResource: { comp: 'block', blockid: blockId },
      data: partData,
      timeout: multipartOptions.timeout,
    }).then(() => {
      return {
        name: objectName,
        etag: blockId,
        res: undefined,
      };
    });
  });
}

export function completeMultipartUpload(
  options: Options,
  objectName: string,
  uploadId: string,
  parts: PartInfo[],
  multipartOptions: MultipartOptions = {}
): Promise<CompleteMultipartUploadResult> {
  const metaHeaders = pendingMeta.get(uploadId);
  pendingMeta.delete(uploadId);
  const ordered = [...parts].sort((a, b) => a.number - b.number);
  const body = '<?xml version="1.0" encoding="utf-8"?>'
    + '<BlockList>'
    + ordered.map((p) => `<Latest>${p.etag}</Latest>`).join('')
    + '</BlockList>';
  return azureRequest(options, {
    verb: 'PUT',
    objectName,
    headers: { ...metaHeaders, ...multipartOptions.headers },
    subResource: { comp: 'blocklist' },
    data: body,
    timeout: multipartOptions.timeout,
  }).then((res: any) => ({
    name: objectName,
    etag: (res && res.headers && res.headers.etag) || '',
    res: res ? res.data : undefined,
  }));
}

/** Export the three primitives in the shape the shared orchestrator expects. */
export function azureMultipartDeps() {
  return { initMultipartUpload, uploadPart, completeMultipartUpload };
}
