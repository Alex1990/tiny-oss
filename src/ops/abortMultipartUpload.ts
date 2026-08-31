import { request } from './request';
import type { TinyOSS } from '../types';

/**
 * Abort a multipart upload.
 *
 * @param options client options
 * @param objectName object name
 * @param uploadId upload id
 * @param multipartOptions multipart options
 * @return void
 */
export function abortMultipartUpload(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  uploadId: string,
  multipartOptions: TinyOSS.MultipartOptions = {}
): Promise<void> {
  return request(options, {
    verb: 'DELETE',
    objectName,
    headers: { ...multipartOptions.headers },
    subResource: { uploadId },
    timeout: multipartOptions.timeout,
  }).then(() => {
    return;
  });
}
