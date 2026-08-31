import { request } from './request';
import { getXmlTag } from '../utils/xml';
import type { TinyOSS } from '../types';

/**
 * Initialize a multipart upload.
 *
 * @param options client options
 * @param objectName object name
 * @param multipartOptions multipart upload options
 * @return result with uploadId
 */
export function initMultipartUpload(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  multipartOptions: TinyOSS.MultipartOptions = {}
): Promise<TinyOSS.InitMultipartUploadResult> {
  const headers: Record<string, any> = { ...multipartOptions.headers };
  return request(options, {
    verb: 'POST',
    objectName,
    headers,
    subResource: { uploads: '' },
    timeout: multipartOptions.timeout,
  }).then((res: any) => {
    const uploadId = getXmlTag(res.data, 'UploadId');
    return {
      name: objectName,
      uploadId,
      res: res.data,
    };
  });
}
