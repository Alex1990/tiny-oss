import { blobToBuffer, getContentMd5, isBlob, sliceUploadData } from '../utils';
import type { BlobLike, MultipartOptions, Options, UploadPartResult } from '../types';
import type { Protocol } from '../protocol';

/**
 * Upload a part in a multipart upload.
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createUploadPart(protocol: Protocol) {
  return async function uploadPart(
    options: Options,
    objectName: string,
    uploadId: string,
    partNo: number,
    data: BlobLike | string,
    start: number,
    end: number,
    multipartOptions: MultipartOptions = {}
  ): Promise<UploadPartResult> {
    // TypedArrays slice zero-copy; DataView/Blob/ArrayBuffer/string go
    // through sliceUploadData's realm-proof branches.
    const partData = sliceUploadData(data, start, end);
    const buf = await blobToBuffer(partData);
    const contentMd5 = getContentMd5(buf);
    // Only Blob carries a type; byte inputs default to octet-stream.
    const contentType = isBlob(partData) ? partData.type || 'application/octet-stream' : 'application/octet-stream';
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
