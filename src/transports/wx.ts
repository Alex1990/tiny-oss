import type { TransportOptions, TransportResponse } from '../transport'

interface WxRequestResponse {
  data: string
  header: Record<string, string>
  statusCode: number
}

interface WxRequestOptions {
  url: string
  method: string
  header: Record<string, string>
  data?: ArrayBuffer | string
  timeout?: number
  success: (res: WxRequestResponse) => void
  fail: (err: unknown) => void
}

// The wx global only exists in the WeChat mini program runtime. The
// typeof guard keeps the module loadable elsewhere; calling this
// transport outside a mini program rejects.
declare const wx: {
  request: (options: WxRequestOptions) => void
}

/**
 * wx.request-based transport for WeChat mini programs. Mini programs
 * have no XMLHttpRequest and no Blob, so uploads must pass ArrayBuffer
 * (see README). wx.request cannot report intermediate upload progress,
 * so a synthetic 0% event fires before sending and a 100% event after,
 * with lengthComputable false.
 */
export function wxRequestTransport(
  url: string,
  options: TransportOptions,
): Promise<TransportResponse> {
  const { method, headers, data, timeout, onprogress, total } = options
  if (typeof wx === 'undefined') {
    return Promise.reject(new Error('wxRequestTransport requires the WeChat mini program runtime'))
  }
  if (onprogress && total) {
    onprogress({ loaded: 0, total, lengthComputable: false })
  }
  // wx.request accepts a string or an ArrayBuffer. TypedArrays must be
  // reduced to their buffer; instanceof is realm-bound, so views are
  // detected with the subarray duck-check (DataView has none and never
  // reaches here — upload data is Uint8Array or ArrayBuffer).
  const view = data as Uint8Array // structural stand-in; checked below
  const body =
    ArrayBuffer.isView(data) && typeof view.subarray === 'function'
      ? (view.buffer as ArrayBuffer)
      : (data as string | ArrayBuffer | undefined)
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      header: headers,
      data: body,
      timeout,
      success: (res) => {
        if (onprogress && total) {
          onprogress({ loaded: total, total, lengthComputable: false })
        }
        resolve({ data: res.data, headers: res.header, status: res.statusCode, statusText: '' })
      },
      fail: (err) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    })
  })
}
