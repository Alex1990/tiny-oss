import { getContentMd5, encodeUtf8 } from '../utils'
import { getXmlTag } from '../utils/xml'
import { resolveCallbackHeaders } from './request'
import type { CompleteMultipartUploadResult, MultipartOptions, Options, PartInfo } from '../types'
import type { Protocol } from '../protocol'

/**
 * Complete a multipart upload.
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createCompleteMultipartUpload(protocol: Protocol) {
  return async function completeMultipartUpload(
    options: Options,
    objectName: string,
    uploadId: string,
    parts: PartInfo[],
    multipartOptions: MultipartOptions = {},
  ): Promise<CompleteMultipartUploadResult> {
    // Build complete multipart upload XML
    const xmlParts = parts
      .sort((a, b) => a.number - b.number)
      .map(
        (part) => `  <Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`,
      )
      .join('\n')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n${xmlParts}\n</CompleteMultipartUpload>`
    const buf = encodeUtf8(xml)
    const contentMd5 = getContentMd5(buf)
    const headers: Record<string, any> = {
      'Content-Md5': contentMd5,
      'Content-Type': 'application/xml',
      // User headers win over the serialized callback headers. When a
      // callback is set the provider replies with the callback response
      // instead of the CompleteMultipartUpload XML, so ETag below is
      // expected to be empty.
      ...resolveCallbackHeaders(protocol, multipartOptions.callback, multipartOptions.headers),
      ...multipartOptions.headers,
    }
    return protocol
      .request(options, {
        verb: 'POST',
        objectName,
        contentMd5,
        headers,
        subResource: { uploadId },
        data: buf,
        timeout: multipartOptions.timeout,
      })
      .then((res: any) => {
        const etag = getXmlTag(res.data, 'ETag')
        return {
          name: objectName,
          etag,
          bucket: options.bucket,
          res: res.data,
        }
      })
  }
}
