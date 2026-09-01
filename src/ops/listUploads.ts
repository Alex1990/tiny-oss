import { getXmlTag, getXmlTags } from '../utils/xml';
import type { ListUploadsQuery, ListUploadsResult, MultipartOptions, Options, UploadInfo } from '../types';
import type { Protocol } from '../protocol';

/**
 * List multipart uploads.
 *
 * The marker query key is provider-specific: OSS uses `marker`, COS uses
 * `key-marker` (the protocol carries the right key).
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createListUploads(protocol: Protocol) {
  return function listUploads(
    options: Options,
    query: ListUploadsQuery = {},
    multipartOptions: MultipartOptions = {}
  ): Promise<ListUploadsResult> {
    const subResource: Record<string, any> = { uploads: '' };
    if (query.prefix) subResource.prefix = query.prefix;
    if (query.marker) subResource[protocol.listUploadsMarkerKey] = query.marker;
    if (query['max-uploads']) subResource['max-uploads'] = query['max-uploads'].toString();
    if (query['upload-id-marker']) subResource['upload-id-marker'] = query['upload-id-marker'];
    return protocol.request(options, {
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
      const uploads: UploadInfo[] = getXmlTags(xml, 'Upload').map((uploadXml) => ({
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
  };
}
