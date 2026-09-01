import { getXmlTag } from '../utils/xml';
import type { Options, SourceData, UploadPartCopyOptions, UploadPartCopyResult } from '../types';
import type { Protocol } from '../protocol';

/**
 * Upload a part by copying from an existing object.
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createUploadPartCopy(protocol: Protocol) {
  return function uploadPartCopy(
    options: Options,
    objectName: string,
    uploadId: string,
    partNo: number,
    range: string,
    sourceData: SourceData,
    copyOptions: UploadPartCopyOptions = {}
  ): Promise<UploadPartCopyResult> {
    const bucket = options.bucket;
    const sourceBucket = sourceData.sourceBucket || bucket;
    const copySource = `/${sourceBucket}/${encodeURIComponent(sourceData.sourceKey)}`;
    const headers: Record<string, any> = {
      [protocol.copySourceHeader]: copySource,
      [protocol.copySourceRangeHeader]: range,
      ...copyOptions.headers,
    };
    return protocol.request(options, {
      verb: 'PUT',
      objectName,
      headers,
      subResource: { uploadId, partNumber: partNo.toString() },
      timeout: copyOptions.timeout,
    }).then((res: any) => {
      const etag = getXmlTag(res.data, 'ETag');
      const lastModified = getXmlTag(res.data, 'LastModified');
      return {
        etag,
        lastModified,
        res: res.data,
      };
    });
  };
}
