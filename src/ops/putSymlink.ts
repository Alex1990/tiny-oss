import { request } from './request';
import type { TinyOSS } from '../types';

/**
 * Put a symlink.
 *
 * @param options client options
 * @param objectName object name
 * @param targetObjectName target object name
 */
export function putSymlink(
  options: TinyOSS.TinyOSSOptions,
  objectName: string,
  targetObjectName: string
): Promise<any> {
  const headers: Record<string, any> = {
    'x-oss-symlink-target': encodeURI(targetObjectName),
  };
  return request(options, {
    verb: 'PUT',
    objectName,
    headers,
    subResource: { symlink: '' },
  });
}
