import type { Options } from '../types'

/**
 * Resolve the TOS host. TOS native endpoints are virtual-hosted only: the
 * bucket is always a subdomain of the endpoint, e.g.
 * `mybucket.tos-cn-beijing.volces.com`.
 *
 * Unlike OSS/COS/OBS (where `endpoint` is used verbatim as the full host),
 * the TOS `endpoint` option is the endpoint *domain* — the bucket is still
 * prefixed. This mirrors the official @volcengine/tos-sdk, whose `endpoint`
 * is `tos-<region>.volces.com` and whose host is `<bucket>.<endpoint>`, and
 * avoids the footgun of an endpoint that silently drops the bucket (TOS
 * rejects path-style addressing).
 *
 * `internal: true` selects the Volcengine internal network domain
 * (`tos-<region>.ivolces.com`).
 *
 * `region` is always required for signing: the TOS4 credential scope is
 * `<date>/<region>/tos/request`.
 */
export function resolveTosHost(options: Options): string {
  const { bucket, region, endpoint, internal } = options
  if (!bucket) throw new Error('options.bucket is required')
  if (!region) {
    throw new Error(
      'options.region is required (TOS signs the credential scope with it; options.endpoint alone is not enough)',
    )
  }
  const domain = endpoint || `tos-${region}.${internal ? 'ivolces.com' : 'volces.com'}`
  return `${bucket}.${domain}`
}
