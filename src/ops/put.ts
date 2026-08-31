import { blobToBuffer, getContentMd5 } from '../utils';
import { request } from './request';
import type { TinyOSS } from '../types';

/**
 * Put an object.
 *
 * @param options client options
 * @param objectName object name
 * @param data data to upload; Blob in browsers, ArrayBuffer/Uint8Array
 *        in environments without Blob (WeChat mini programs), or a string
 * @param putOptions put options
 */
export function put(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  data: TinyOSS.BlobLike | string,
  putOptions: TinyOSS.PutOptions = {}
): Promise<any> {
  return blobToBuffer(data)
    .then((buf) => {
      const contentMd5 = getContentMd5(buf);
      const contentType = typeof data === 'string'
        ? 'text/plain; charset=utf-8'
        : (data instanceof Blob ? data.type : 'application/octet-stream');
      const headers: Record<string, any> = {
        'Content-Md5': contentMd5,
        'Content-Type': contentType,
      };
      return request(options, {
        verb: 'PUT',
        objectName,
        contentMd5,
        headers,
        // Strings are already encoded to bytes for the MD5; send those
        // bytes to avoid encoding twice and to give the transport a size.
        data: typeof data === 'string' ? buf : data,
        onprogress: putOptions.onprogress,
      });
    });
}
