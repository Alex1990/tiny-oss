export interface AjaxOptions {
  async?: boolean;
  data?: any;
  headers?: Record<string, any>;
  method?: string;
  timeout?: number;
  onprogress?: (this: XMLHttpRequest, ev: ProgressEvent) => any;
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
          resolve(xhr.response);
        } else {
          const err = new Error('the request is error');
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
