import type { Options } from '../types'
import type { Protocol } from '../protocol'

/**
 * Put a symlink. OSS and TOS both support it; the provider supplies the
 * target header through `symlinkHeaders` (OSS URI-encodes the target, TOS
 * sends it verbatim), and protocols without a symlink API reject the call
 * (and their entry point does not export it).
 *
 * @param protocol provider protocol (OSS or TOS)
 */
export function createPutSymlink(protocol: Protocol) {
  return function putSymlink(
    options: Options,
    objectName: string,
    targetObjectName: string,
  ): Promise<any> {
    if (!protocol.supportsSymlink) {
      return Promise.reject(new Error('the provider does not support symlink'))
    }
    const headers = protocol.symlinkHeaders
      ? protocol.symlinkHeaders(targetObjectName)
      : { 'x-oss-symlink-target': encodeURI(targetObjectName) }
    return protocol.request(options, {
      verb: 'PUT',
      objectName,
      headers,
      subResource: { symlink: '' },
    })
  }
}
