import type { Progress } from './types';

export interface TransportOptions {
  method: string;
  headers: Record<string, string>;
  data?: any;
  timeout?: number;
  /**
   * Total payload size in bytes; transports without native progress
   * events use it to fire 0%/100% synthetic events.
   */
  total?: number;
  /**
   * Upload progress. lengthComputable is false when the environment
   * cannot report intermediate progress (fetch, wx.request); such
   * adapters fire a 0% event before sending and a 100% event after.
   */
  onprogress?: (e: Progress) => void;
}

export interface TransportResponse {
  data: string;
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

export type Transport = (url: string, options: TransportOptions) => Promise<TransportResponse>;

function xhrTransport(url: string, options: TransportOptions): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const {
      method = 'get',
      data = null,
      headers = {},
      timeout = 0,
      onprogress,
    } = options;
    const xhr = new XMLHttpRequest();
    let timerId: any;
    if (timeout) {
      timerId = setTimeout(() => {
        reject(new Error(`the request timeout ${timeout}ms`));
      }, timeout);
    }
    xhr.onerror = () => {
      reject(new Error('unknown error'));
    };
    if (xhr.upload && onprogress) {
      xhr.upload.onprogress = (ev) => {
        onprogress({ loaded: ev.loaded, total: ev.total, lengthComputable: ev.lengthComputable });
      };
    }
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (timeout) clearTimeout(timerId);
        if (xhr.status >= 200 && xhr.status < 300) {
          // Extract response headers
          const responseHeaders: Record<string, string> = {};
          const headerString = xhr.getAllResponseHeaders();
          if (headerString) {
            const headerPairs = headerString.trim().split(/[\r\n]+/);
            headerPairs.forEach((line) => {
              const parts = line.split(': ');
              const header = parts.shift();
              const value = parts.join(': ');
              if (header) {
                responseHeaders[header.toLowerCase()] = value;
              }
            });
          }
          resolve({
            data: xhr.responseText,
            headers: responseHeaders,
            status: xhr.status,
            statusText: xhr.statusText,
          });
        } else {
          const err = new Error(`the request is error: ${xhr.status} ${xhr.statusText} ${xhr.responseText || ''}`);
          reject(err);
        }
      }
    };
    xhr.open(method, url, true);
    Object.keys(headers).forEach((key) => {
      xhr.setRequestHeader(key, headers[key]);
    });
    try {
      xhr.send(data);
    } catch (err) {
      reject(err);
    }
  });
}

let current: Transport = xhrTransport;

/**
 * Replace the network layer. Defaults to XMLHttpRequest; pass a
 * fetch-based adapter in Service Workers or a wx.request-based adapter
 * in WeChat mini programs.
 */
export function setTransport(transport: Transport): void {
  current = transport;
}

export function getTransport(): Transport {
  return current;
}
