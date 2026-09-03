import { encodeUtf8 } from '../utils/utf8'
import { fromUint8Array } from 'js-base64'
import type { ObjectCallback } from '../types'

/**
 * OBS upload-callback header, mirroring esdk-obs-browserjs
 * (src/utils.js): the Callback parameters are JSON-stringified with
 * lower-case-first keys (callbackUrl / callbackBody / callbackHost /
 * callbackBodyType), then base64-encoded into x-obs-callback. OBS has no
 * custom-value counterpart, so `customValue` is not serialized.
 */
export function obsCallbackHeaders(callback: ObjectCallback): Record<string, string> {
  const json: Record<string, string> = {
    callbackUrl: callback.url,
    callbackBody: callback.body,
  }
  if (callback.host) json.callbackHost = callback.host
  if (callback.contentType) json.callbackBodyType = callback.contentType
  return { 'x-obs-callback': fromUint8Array(encodeUtf8(JSON.stringify(json))) }
}
