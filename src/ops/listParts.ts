import { request } from './request';
import { getXmlTag, getXmlTags } from '../utils/xml';
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
    const xml = res.data;
    const isTruncated = getXmlTag(xml, 'IsTruncated') === 'true';
    const nextPartNumberMarker = parseInt(getXmlTag(xml, 'NextPartNumberMarker') || '0', 10);
    const parts: TinyOSS.Part[] = getXmlTags(xml, 'Part').map((partXml) => ({
      PartNumber: parseInt(getXmlTag(partXml, 'PartNumber') || '0', 10),
      LastModified: getXmlTag(partXml, 'LastModified'),
      ETag: getXmlTag(partXml, 'ETag'),
      Size: parseInt(getXmlTag(partXml, 'Size') || '0', 10),
    }));
    return {
      isTruncated,
      nextPartNumberMarker,
      parts,
      res: res.data,
    };
  });
}
