export interface AjaxOptions {
  async?: boolean;
  data?: any;
  headers?: Record<string, any>;
  method?: string;
  timeout?: number;
  onprogress?: (this: XMLHttpRequest, ev: ProgressEvent) => any;
}

export interface AjaxResponse {
  data: any;
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

export default function ajax(url: string, options: AjaxOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const {
      async = true,
      data = null,
      headers = {},
      method = 'get',
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
    if (xhr.upload) {
      xhr.upload.onprogress = onprogress!;
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
            data: xhr.response,
            headers: responseHeaders,
            status: xhr.status,
            statusText: xhr.statusText,
          });
        } else {
          const err = new Error(`the request is error: ${xhr.status} ${xhr.statusText}`);
          reject(err);
        }
      }
    };
    xhr.open(method, url, async);
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
