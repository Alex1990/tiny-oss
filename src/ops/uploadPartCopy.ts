import { request } from './request';
import { getXmlTag } from '../utils/xml';
import type { TinyOSS } from '../types';

/**
 * Upload a part by copying from an existing object.
 *
 * @param options client options
 * @param objectName target object name
 * @param uploadId upload id
 * @param partNo part number
 * @param range byte range to copy (e.g., "bytes=0-1023")
 * @param sourceData source object data
 * @param copyOptions upload part copy options
 * @return result with etag
 */
export function uploadPartCopy(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  uploadId: string,
  partNo: number,
  range: string,
  sourceData: TinyOSS.SourceData,
  copyOptions: TinyOSS.UploadPartCopyOptions = {}
): Promise<TinyOSS.UploadPartCopyResult> {
  const bucket = options.bucket;
  const sourceBucket = sourceData.sourceBucket || bucket;
  const copySource = `/${sourceBucket}/${encodeURIComponent(sourceData.sourceKey)}`;
  const headers: Record<string, any> = {
    'x-oss-copy-source': copySource,
    'x-oss-copy-source-range': range,
    ...copyOptions.headers,
  };
  return request(options, {
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
}
