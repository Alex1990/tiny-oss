import { blobToBuffer, getContentMd5, isBlob } from '../utils'
import type { BlobLike, Options, PutOptions } from '../types'
import type { Protocol } from '../protocol'

/**
 * Put an object.
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createPut(protocol: Protocol) {
  return function put(
    options: Options,
    objectName: string,
    data: BlobLike | string,
    putOptions: PutOptions = {},
  ): Promise<any> {
    return blobToBuffer(data).then((buf) => {
      const contentMd5 = getContentMd5(buf)
      const contentType =
        typeof data === 'string'
          ? 'text/plain; charset=utf-8'
          : isBlob(data)
            ? data.type
            : 'application/octet-stream'
      const headers: Record<string, any> = {
        'Content-Md5': contentMd5,
        'Content-Type': contentType,
      }
      return protocol.request(options, {
        verb: 'PUT',
        objectName,
        contentMd5,
        headers,
        // Strings are already encoded to bytes for the MD5; send those
        // bytes to avoid encoding twice and to give the transport a size.
        data: typeof data === 'string' ? buf : data,
        onprogress: putOptions.onprogress,
      })
    })
  }
}
