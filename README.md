# tiny-oss

A tiny aliyun oss sdk for browser which focus on uploading. Less than 10kb (min+gzipped). Also ships Tencent Cloud COS (`tiny-oss/cos`) and Huawei Cloud OBS (`tiny-oss/obs`) entry points with the same API — see [Tencent Cloud COS](#tencent-cloud-cos) and [Huawei Cloud OBS](#huawei-cloud-obs).

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

## Tencent Cloud COS

The same operations are available for Tencent Cloud COS through a separate entry point. The OSS entry never references COS code and vice versa, so importing only what you use keeps the OSS bundle free of COS signing code (and the other way around).

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/cos';

put(
  {
    accessKeyId: 'your SecretId',
    accessKeySecret: 'your SecretKey',
    // Recommend to use the stsToken option in browser
    stsToken: 'security token',
    region: 'ap-guangzhou',
    bucket: 'your-bucket-1250000000' // COS bucket names include the APPID suffix
  },
  'hello-world',
  blob
);
```

The COS entry exports everything the OSS entry does except `putSymlink` (COS has no symlink API). Options map as:

| option | OSS | COS |
|---|---|---|
| `accessKeyId` | Aliyun AccessKeyId | Tencent SecretId |
| `accessKeySecret` | Aliyun AccessKeySecret | Tencent SecretKey |
| `region` | `oss-cn-beijing` | e.g. `ap-guangzhou` |
| `bucket` | `my-bucket` | must include the APPID suffix, e.g. `examplebucket-1250000000` |
| `stsToken` | OSS STS token | COS temporary-credential SecurityToken (`x-cos-security-token`) |
| `endpoint` / `secure` / `timeout` | same | same |

Notes:

- Like OSS, browser uploads to COS require a CORS rule on the bucket, and temporary credentials (CAM STS) are recommended over permanent keys.
- Set the bucket CORS rule to expose the `ETag` response header for multipart uploads.
- COS signatures are time-sensitive; a skewed client clock yields 403 `RequestTimeTooSkewed`.

## Huawei Cloud OBS

The same operations are also available for Huawei Cloud OBS through a third entry point (`tiny-oss/obs`). Each entry is self-contained: importing only what you use keeps the OSS bundle free of COS/OBS signing code and vice versa.

```js
import { put, multipartUpload, signatureUrl } from 'tiny-oss/obs';

put(
  {
    accessKeyId: 'your Access Key Id',
    accessKeySecret: 'your Secret Access Key',
    // Recommend to use the stsToken option in browser
    stsToken: 'security token',
    region: 'cn-north-4',
    bucket: 'your-bucket' // OBS bucket names carry no suffix
  },
  'hello-world',
  blob
);
```

The OBS entry exports everything the OSS entry does except `putSymlink` (OBS has no symlink API). Options map as:

| option | OSS | OBS |
|---|---|---|
| `accessKeyId` | Aliyun AccessKeyId | Huawei Cloud Access Key Id |
| `accessKeySecret` | Aliyun AccessKeySecret | Huawei Cloud Secret Access Key |
| `region` | `oss-cn-beijing` | e.g. `cn-north-4`, `cn-east-3` |
| `bucket` | `my-bucket` | plain bucket name (no APPID suffix) |
| `stsToken` | OSS STS token | OBS temporary-credential SecurityToken (`x-obs-security-token`) |
| `endpoint` / `secure` / `timeout` | same | same |

Notes:

- Browser uploads to OBS require the bucket's CORS rule to allow your origin and expose the `ETag` response header for multipart uploads; temporary credentials (IAM agency) are recommended over permanent keys.
- OBS signatures are time-sensitive (the `x-obs-date` header); a skewed client clock yields `403 RequestTimeTooSkewed`.
- The OBS signer uses the OBS "obs" signature scheme, matching the official `esdk-obs-browserjs` byte for byte.

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

The network layer is injectable. Browsers use `XMLHttpRequest` by default;
Service Workers and WeChat mini programs have ready-made adapters:

```js
// Service Worker (or Node.js)
import { setTransport, fetchTransport } from 'tiny-oss';
setTransport(fetchTransport);

// WeChat mini program
import { setTransport, wxRequestTransport } from 'tiny-oss';
setTransport(wxRequestTransport);
```

The input data types are environment agnostic: `Blob`, `ArrayBuffer` and
`Uint8Array` are all accepted (mini programs don't have `Blob`, so pass
`ArrayBuffer`).

### WeChat mini program upload

```js
import { put, multipartUpload } from 'tiny-oss';

const arrayBuffer = getFileArrayBuffer(); // e.g. from FileSystemManager.readFile

put(options, 'photo.jpg', arrayBuffer);
multipartUpload(options, 'video.mp4', arrayBuffer, { partSize: 1024 * 1024 });
```

### Custom transport

For other environments, pass your own function to `setTransport`. It receives
`(url, { method, headers, data, timeout, onprogress, total })` and must
resolve with `{ data, headers, status, statusText }`, rejecting on failure:

```js
setTransport(async (url, { method, headers, data, timeout }) => {
  // adapt to your platform's request API
});
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
