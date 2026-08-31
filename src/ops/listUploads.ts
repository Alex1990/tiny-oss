import { request } from './request';
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
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(res.data, 'text/xml');
    const isTruncated = xmlDoc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
    const nextKeyMarker = xmlDoc.getElementsByTagName('NextKeyMarker')[0]?.textContent || undefined;
    const nextUploadIdMarker = xmlDoc.getElementsByTagName('NextUploadIdMarker')[0]?.textContent || undefined;
    const uploadElements = xmlDoc.getElementsByTagName('Upload');
    const uploads: TinyOSS.UploadInfo[] = [];
    for (let i = 0; i < uploadElements.length; i++) {
      const upload = uploadElements[i];
      uploads.push({
        uploadId: upload.getElementsByTagName('UploadId')[0]?.textContent || '',
        name: upload.getElementsByTagName('Key')[0]?.textContent || '',
        initiated: upload.getElementsByTagName('Initiated')[0]?.textContent || '',
      });
    }
    return {
      uploads,
      isTruncated,
      nextKeyMarker,
      nextUploadIdMarker,
      res: res.data,
    };
  });
}
