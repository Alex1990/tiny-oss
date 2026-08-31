import { getXmlTag } from '../utils/xml';
import type { TinyOSS } from '../types';
import type { Protocol } from '../protocol';

/**
 * Initialize a multipart upload.
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createInitMultipartUpload(protocol: Protocol) {
  return function initMultipartUpload(
    options: TinyOSS.TinyOSSOptions,
    objectName: string,
    multipartOptions: TinyOSS.MultipartOptions = {}
  ): Promise<TinyOSS.InitMultipartUploadResult> {
    const headers: Record<string, any> = { ...multipartOptions.headers };
    return protocol.request(options, {
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
  };
}
