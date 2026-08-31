import { request } from './request';
import type { TinyOSS } from '../types';

/**
 * List parts of a multipart upload.
 *
 * @param options client options
 * @param objectName object name
 * @param uploadId upload id
 * @param query query parameters
 * @param multipartOptions multipart options
 * @return list of parts
 */
export function listParts(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  uploadId: string,
  query: TinyOSS.ListQuery = {},
  multipartOptions: TinyOSS.MultipartOptions = {}
): Promise<TinyOSS.ListPartsResult> {
  const subResource: Record<string, any> = { uploadId };
  if (query['max-parts']) subResource['max-parts'] = query['max-parts'].toString();
  if (query['part-number-marker']) subResource['part-number-marker'] = query['part-number-marker'].toString();
  return request(options, {
    verb: 'GET',
    objectName,
    headers: { ...multipartOptions.headers },
    subResource,
    timeout: multipartOptions.timeout,
  }).then((res: any) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(res.data, 'text/xml');
    const isTruncated = xmlDoc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
    const nextPartNumberMarker = parseInt(xmlDoc.getElementsByTagName('NextPartNumberMarker')[0]?.textContent || '0', 10);
    const partElements = xmlDoc.getElementsByTagName('Part');
    const parts: TinyOSS.Part[] = [];
    for (let i = 0; i < partElements.length; i++) {
      const part = partElements[i];
      parts.push({
        PartNumber: parseInt(part.getElementsByTagName('PartNumber')[0]?.textContent || '0', 10),
        LastModified: part.getElementsByTagName('LastModified')[0]?.textContent || '',
        ETag: part.getElementsByTagName('ETag')[0]?.textContent || '',
        Size: parseInt(part.getElementsByTagName('Size')[0]?.textContent || '0', 10),
      });
    }
    return {
      isTruncated,
      nextPartNumberMarker,
      parts,
      res: res.data,
    };
  });
}
