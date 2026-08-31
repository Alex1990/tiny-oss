import { blobToBuffer, getContentMd5 } from '../utils';
import type { TinyOSS } from '../types';
import type { Protocol } from '../protocol';

/**
 * Upload a part in a multipart upload.
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createUploadPart(protocol: Protocol) {
  return async function uploadPart(
    options: TinyOSS.TinyOSSOptions,
    objectName: string,
    uploadId: string,
    partNo: number,
    data: TinyOSS.BlobLike | string,
    start: number,
    end: number,
    multipartOptions: TinyOSS.MultipartOptions = {}
  ): Promise<TinyOSS.UploadPartResult> {
    // Uint8Array slicing is zero-copy (subarray); other inputs slice natively.
    const partData = ArrayBuffer.isView(data) && !(data instanceof DataView)
      ? data.subarray(start, end)
      : data.slice(start, end);
    const buf = await blobToBuffer(partData);
    const contentMd5 = getContentMd5(buf);
    // Only Blob carries a type; byte inputs default to octet-stream.
    const contentType = partData instanceof Blob ? partData.type || 'application/octet-stream' : 'application/octet-stream';
    const headers: Record<string, any> = {
      'Content-Md5': contentMd5,
      'Content-Type': contentType,
      ...multipartOptions.headers,
    };
    return protocol.request(options, {
      verb: 'PUT',
      objectName,
      contentMd5,
      headers,
      subResource: { uploadId, partNumber: partNo.toString() },
      data: partData,
      timeout: multipartOptions.timeout,
    }).then((res: any) => {
      return {
        name: objectName,
        etag: res.headers.etag || '',
        res: res.data,
      };
    });
  };
}
