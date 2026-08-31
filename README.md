# tiny-oss

A tiny aliyun oss sdk for browser which focus on uploading. Less than 10kb (min+gzipped).

**English | [简体中文](README_zh-CN.md)**

## Installation

Npm

```sh
npm install tiny-oss
```

Yarn

```sh
yarn add tiny-oss
```

## Usage

Every operation is a standalone function taking the client options as the first argument. Import only what you use and bundlers tree-shake the rest, so a bundle that only calls `put` does not carry the multipart code.

### Basic

```js
import { put } from 'tiny-oss';

const blob = new Blob(['hello world'], { type: 'text/plain' });

// Upload
put(
  {
    accessKeyId: 'your accessKeyId',
    accessKeySecret: 'your accessKeySecret',
    // Recommend to use the stsToken option in browser
    stsToken: 'security token',
    region: 'oss-cn-beijing',
    bucket: 'your bucket'
  },
  'hello-world',
  blob
);
```

Available functions: `put`, `putSymlink`, `signatureUrl`, `initMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`, `listParts`, `listUploads`, `uploadPartCopy`, `multipartUpload`, `bindOptions`.

Types are available via named imports: `import { put, type TinyOSS } from 'tiny-oss'`.

### Binding options once

To avoid passing the credentials on every call, bind them once with `bindOptions`. It only references the operation you give it, so tree shaking is unaffected:

```js
import { put, bindOptions } from 'tiny-oss';

const upload = bindOptions(put, {
  accessKeyId: 'your accessKeyId',
  accessKeySecret: 'your accessKeySecret',
  stsToken: 'security token',
  region: 'oss-cn-beijing',
  bucket: 'your bucket'
});

upload('hello-world', new Blob(['hello world'], { type: 'text/plain' }));
```

### Upload progress

You can specify the last parameter to monitor the upload progress data:

```js
put(
  options,
  'hello-world',
  blob,
  {
    onprogress (e) {
      console.log('total: ', e.total, ', uploaded: ', e.loaded);
    }
  }
);
```

More options or methods see [API](#api).

## Compatibility

It should work in most browsers.

This package depends on some Web APIs, such as [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob), [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise). In browsers it uses `XMLHttpRequest` for network requests; other environments inject their own transport (see below).

## Non-browser environments

The network layer is injectable. Browsers use `XMLHttpRequest` by default; in
Service Workers or WeChat mini programs, pass your own transport with
`setTransport` once at startup. The input data types are environment
agnostic: `Blob`, `ArrayBuffer` and `Uint8Array` are all accepted (mini
programs don't have `Blob`, so pass `ArrayBuffer`).

### Service Worker

```js
import { setTransport } from 'tiny-oss';

setTransport(async (url, { method, headers, data, timeout }) => {
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
  const res = await fetch(url, { method, headers, body: data, signal: controller.signal });
  if (timer) clearTimeout(timer);
  return {
    data: await res.text(),
    headers: Object.fromEntries(res.headers.entries()),
    status: res.status,
    statusText: res.statusText,
  };
});
```

### WeChat mini program

```js
import { setTransport } from 'tiny-oss';

setTransport((url, { method, headers, data, timeout }) =>
  new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      header: headers,
      data: data instanceof Uint8Array ? data.buffer : data,
      timeout,
      success: (res) =>
        resolve({ data: res.data, headers: res.header, status: res.statusCode, statusText: '' }),
      fail: reject,
    });
  })
);
```

Then upload with `ArrayBuffer` instead of `Blob`:

```js
import { put, multipartUpload } from 'tiny-oss';

const arrayBuffer = getFileArrayBuffer(); // e.g. from FileSystemManager.readFile

put(options, 'photo.jpg', arrayBuffer);
multipartUpload(options, 'video.mp4', arrayBuffer, { partSize: 1024 * 1024 });
```

### Progress events

`onprogress` receives `{ loaded, total, lengthComputable }`. Browsers report
real upload progress (`lengthComputable: true`). `fetch` and `wx.request`
cannot report intermediate progress, so those adapters fire a `0%` event
before sending and a `100%` event after, with `lengthComputable: false` — use
them to toggle a loading state, not to render a percentage.

## API

### options

The first argument of every operation. Please check [Browser.js offical document](https://help.aliyun.com/document_detail/64095.html?spm=a2c4g.11186623.6.1122.27976928XhTpTr).

* accessKeyId
* accessKeySecret
* stsToken
* bucket
* endpoint
* region
* secure
* timeout

### put(options, objectName, blob, putOptions)

Upload the blob.

#### Arguments

* **options (Object)**: The client options, see above.
* **objectName (String)**: The object name.
* **blob (Blob|File)**: The object to be uploaded.
* **[putOptions (Object)]**
  + **[onprogress (Function)]**: The upload progress event listener receiving an [progress event](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/progress_event) object as an parameter.

#### Return

* **(Promise)**

### putSymlink(options, objectName, targetObjectName)

Create a symlink.

#### Arguments

* **options (Object)**: The client options, see above.
* **objectName (String)**: The symlink object name.
* **targetObjectName (String)**: The target object name.

#### Return

* **(Promise)**

### signatureUrl(options, objectName, urlOptions)

Get a signature url to download the file.

#### Arguments

* **options (Object)**: The client options, see above.
* **objectName (String)**: The object name.
* **[urlOptions (Object)]**:
  + **[expires (Number)]**: The url expires (unit: seconds).

#### Return

* **(String)**

## LICENSE

MIT
