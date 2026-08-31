import type { TransportOptions, TransportResponse } from '../transport';

/**
 * fetch-based transport for Service Workers and Node.js, where
 * XMLHttpRequest is unavailable. fetch cannot report intermediate
 * upload progress, so a synthetic 0% event fires before sending and a
 * 100% event after, with lengthComputable false.
 */
export function fetchTransport(url: string, options: TransportOptions): Promise<TransportResponse> {
  const { method, headers, data, timeout, onprogress, total } = options;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeout) {
    timer = setTimeout(() => controller.abort(), timeout);
  }
  if (onprogress && total) {
    onprogress({ loaded: 0, total, lengthComputable: false });
  }
  return fetch(url, {
    method,
    headers,
    body: data as BodyInit | null | undefined,
    signal: controller.signal,
  })
    .then(async (res) => {
      const text = await res.text();
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`the request is error: ${res.status} ${res.statusText} ${text}`);
      }
      if (onprogress && total) {
        onprogress({ loaded: total, total, lengthComputable: false });
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        data: text,
        headers,
        status: res.status,
        statusText: res.statusText,
      };
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}
