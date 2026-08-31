import type { TinyOSS } from '../types';
import type { Protocol } from '../protocol';

/**
 * Put a symlink. Only OSS supports symlinks; COS has no such API, so
 * the operation rejects on protocols that do not support it (and the
 * COS entry point does not export it).
 *
 * @param protocol provider protocol (OSS or COS)
 */
export function createPutSymlink(protocol: Protocol) {
  return function putSymlink(
    options: TinyOSS.TinyOSSOptions,
    objectName: string,
    targetObjectName: string
  ): Promise<any> {
    if (!protocol.supportsSymlink) {
      return Promise.reject(new Error('the provider does not support symlink'));
    }
    const headers: Record<string, any> = {
      'x-oss-symlink-target': encodeURI(targetObjectName),
    };
    return protocol.request(options, {
      verb: 'PUT',
      objectName,
      headers,
      subResource: { symlink: '' },
    });
  };
}
