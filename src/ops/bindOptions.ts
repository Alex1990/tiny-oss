/**
 * Bind client options to an operation function, so callers don't have to
 * repeat the credentials on every call. The returned function keeps the
 * operation's original signature minus the leading options argument.
 *
 * Unlike a client object factory, this never references operations it
 * isn't given, so tree shaking keeps working: importing `put` plus
 * `bindOptions` still excludes the multipart code from the bundle.
 *
 * @example
 * import { put, bindOptions } from 'tiny-oss';
 * const upload = bindOptions(put, { accessKeyId, accessKeySecret, region, bucket });
 * upload('hello.txt', blob);
 */
export function bindOptions<O, A extends unknown[], R>(
  operation: (options: O, ...args: A) => R,
  options: O,
): (...args: A) => R {
  return (...args: A): R => operation(options, ...args)
}
