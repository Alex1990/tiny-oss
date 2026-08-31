import { blobToBuffer, getContentMd5 } from '../utils';
import { request } from './request';
import type { TinyOSS } from '../types';

/**
 * Put an object.
 *
 * @param options client options
 * @param objectName object name
 * @param blob data
 * @param putOptions put options
 */
export function put(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  blob: Blob,
  putOptions: TinyOSS.PutOptions = {}
): Promise<any> {
  return blobToBuffer(blob)
    .then((buf) => {
      const contentMd5 = getContentMd5(buf);
      const contentType = blob.type;
      const headers: Record<string, any> = {
        'Content-Md5': contentMd5,
        'Content-Type': contentType,
      };
      return request(options, {
        verb: 'PUT',
        objectName,
        contentMd5,
        headers,
        data: blob,
        onprogress: putOptions.onprogress,
      });
    });
}
