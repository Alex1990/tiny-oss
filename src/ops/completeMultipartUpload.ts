import { blobToBuffer, getContentMd5 } from '../utils';
import { request } from './request';
import type { TinyOSS } from '../types';

/**
 * Complete a multipart upload.
 *
 * @param options client options
 * @param objectName object name
 * @param uploadId upload id
 * @param parts array of part info with number and etag
 * @param multipartOptions multipart options
 * @return result with etag
 */
export async function completeMultipartUpload(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  uploadId: string,
  parts: TinyOSS.PartInfo[],
  multipartOptions: TinyOSS.MultipartOptions = {}
): Promise<TinyOSS.CompleteMultipartUploadResult> {
  // Build complete multipart upload XML
  const xmlParts = parts
    .sort((a, b) => a.number - b.number)
    .map((part) => `  <Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n${xmlParts}\n</CompleteMultipartUpload>`;
  const blob = new Blob([xml], { type: 'application/xml' });
  const buf = await blobToBuffer(blob);
  const contentMd5 = getContentMd5(buf);
  const headers: Record<string, any> = {
    'Content-Md5': contentMd5,
    'Content-Type': 'application/xml',
    ...multipartOptions.headers,
  };
  return request(options, {
    verb: 'POST',
    objectName,
    contentMd5,
    headers,
    subResource: { uploadId },
    data: blob,
    timeout: multipartOptions.timeout,
  }).then((res: any) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(res.data, 'text/xml');
    const etag = xmlDoc.getElementsByTagName('ETag')[0]?.textContent || '';
    return {
      name: objectName,
      etag,
      bucket: options.bucket,
      res: res.data,
    };
  });
}
