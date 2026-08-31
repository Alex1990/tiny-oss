import { request } from './request';
import { getXmlTag, getXmlTags } from '../utils/xml';
import type { TinyOSS } from '../types';

/**
 * List multipart uploads.
 *
 * @param options client options
 * @param query query parameters
 * @param multipartOptions multipart options
 * @return list of uploads
 */
export function listUploads(
  options: TinyOSS.TinyOSSOptions,
  query: TinyOSS.ListUploadsQuery = {},
  multipartOptions: TinyOSS.MultipartOptions = {}
): Promise<TinyOSS.ListUploadsResult> {
  const subResource: Record<string, any> = { uploads: '' };
  if (query.prefix) subResource.prefix = query.prefix;
  if (query.marker) subResource.marker = query.marker;
  if (query['max-uploads']) subResource['max-uploads'] = query['max-uploads'].toString();
  if (query['upload-id-marker']) subResource['upload-id-marker'] = query['upload-id-marker'];
  return request(options, {
    verb: 'GET',
    objectName: '',
    headers: { ...multipartOptions.headers },
    subResource,
    timeout: multipartOptions.timeout,
  }).then((res: any) => {
    const xml = res.data;
    const isTruncated = getXmlTag(xml, 'IsTruncated') === 'true';
    const nextKeyMarker = getXmlTag(xml, 'NextKeyMarker') || undefined;
    const nextUploadIdMarker = getXmlTag(xml, 'NextUploadIdMarker') || undefined;
    const uploads: TinyOSS.UploadInfo[] = getXmlTags(xml, 'Upload').map((uploadXml) => ({
      uploadId: getXmlTag(uploadXml, 'UploadId'),
      name: getXmlTag(uploadXml, 'Key'),
      initiated: getXmlTag(uploadXml, 'Initiated'),
    }));
    return {
      uploads,
      isTruncated,
      nextKeyMarker,
      nextUploadIdMarker,
      res: res.data,
    };
  });
}
