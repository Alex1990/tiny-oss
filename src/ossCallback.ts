import { encodeUtf8 } from './utils/utf8'
import { fromUint8Array } from 'js-base64'
import type { ObjectCallback } from './types'

/**
 * OSS upload-callback headers, byte-identical to ali-oss
 * lib/common/callback.js: x-oss-callback carries the base64 JSON of
 * {callbackUrl, callbackBody, callbackHost?, callbackBodyType?} (the URL
 * is encodeURI'd, mirroring ali-oss) and x-oss-callback-var the base64
 * JSON of the x:-prefixed custom values.
 */
export function ossCallbackHeaders(callback: ObjectCallback): Record<string, string> {
  const json: Record<string, string> = {
    callbackUrl: encodeURI(callback.url),
    callbackBody: callback.body,
  }
  if (callback.host) json.callbackHost = callback.host
  if (callback.contentType) json.callbackBodyType = callback.contentType
  const headers: Record<string, string> = {
    'x-oss-callback': fromUint8Array(encodeUtf8(JSON.stringify(json))),
  }
  if (callback.customValue) {
    const callbackVar: Record<string, string> = {}
    Object.keys(callback.customValue).forEach((key) => {
      callbackVar[`x:${key}`] = String((callback.customValue as Record<string, unknown>)[key])
    })
    headers['x-oss-callback-var'] = fromUint8Array(encodeUtf8(JSON.stringify(callbackVar)))
  }
  return headers
}
