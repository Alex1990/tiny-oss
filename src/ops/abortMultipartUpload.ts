import type { TinyOSS } from '../types';
import type { Protocol } from '../protocol';

/**
 * Abort a multipart upload.
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createAbortMultipartUpload(protocol: Protocol) {
  return function abortMultipartUpload(
    options: TinyOSS.TinyOSSOptions,
    objectName: string,
    uploadId: string,
    multipartOptions: TinyOSS.MultipartOptions = {}
  ): Promise<void> {
    return protocol.request(options, {
      verb: 'DELETE',
      objectName,
      headers: { ...multipartOptions.headers },
      subResource: { uploadId },
      timeout: multipartOptions.timeout,
    }).then(() => {
      return;
    });
  };
}
