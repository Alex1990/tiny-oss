import { getXmlTag } from '../utils/xml';
import type { InitMultipartUploadResult, MultipartOptions, Options } from '../types';
import type { Protocol } from '../protocol';

/**
 * Initialize a multipart upload.
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createInitMultipartUpload(protocol: Protocol) {
  return function initMultipartUpload(
    options: Options,
    objectName: string,
    multipartOptions: MultipartOptions = {}
  ): Promise<InitMultipartUploadResult> {
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
